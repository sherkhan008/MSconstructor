import {
  eventSubject,
  subjectLogFields,
  type ContactLeadEventPayload,
  type NotificationEventPayload,
  type NotificationEventType,
  type OrderEventPayload,
} from './events';
import { defaultChannels, type NotificationChannel } from './channels';
import {
  claimDelivery,
  hasSentDelivery,
  insertPendingDeliveries,
  listDueDeliveries,
  markDeliveryResult,
  rescheduleDelivery,
  type PendingDeliveryRow,
} from './store';
import {
  RETRY_CLAIM_LEASE_MS,
  RETRY_MAX_AGE_MS,
  RETRY_UNAVAILABLE_POSTPONE_MS,
  nextRetryAt,
} from './retry-policy';

/**
 * The notification boundary. Nothing here can throw into its caller, so no
 * channel, database or configuration problem can fail an order, a payment or
 * a contact form.
 *
 * Two ways in:
 *  - `createOutbox(event)` — for a NEW order or contact lead. It builds the
 *    event's PENDING outbox rows (one per available channel) BEFORE the
 *    business write; the order / lead store writes them in the SAME database
 *    transaction as the record. After commit, `dispatchInBackground()` makes
 *    the first attempt on exactly those rows, outside any transaction. A crash
 *    at any point after commit leaves PENDING rows the worker sends once their
 *    lease runs out: a committed order/lead can never be without its event.
 *  - `emitNotificationEvent(payload)` — for events with no business write of
 *    their own to join (order.status_changed / order.paid, emitted after the
 *    admin update): the rows are written on their own, then attempted.
 *
 * Outcomes are observable, never faked:
 *  - channel unavailable -> one structured warn line, nothing recorded;
 *  - channel attempted   -> the PENDING row turns into SENT or FAILED (short
 *    code), plus a warn line on failure.
 * Retry: a FAILED row with a transient error gets a `nextAttemptAt`
 * (./retry-policy.ts). `retryFailedDeliveries()` re-sends due rows; it runs
 * ONLY in the separate notifications worker (scripts/notification-retry-worker.ts,
 * the `notifications-worker` compose service) — never inside a request, so
 * order creation or a contact form never waits for a retry.
 *
 * Logs carry event, channel, the subject (order number or opaque lead id) and
 * a code only — never a customer's name, phone or message.
 */

function logNotification(level: 'warn' | 'error', message: string, fields: Record<string, string>): void {
  const details = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  (level === 'warn' ? console.warn : console.error)(`[notifications] ${message} ${details}`);
}

export interface NotificationDeps {
  channels: () => NotificationChannel[];
  /** Clock, injectable for tests. */
  now?: () => Date;
}

const defaultDeps: NotificationDeps = { channels: defaultChannels };

const clock = (deps: NotificationDeps): Date => (deps.now ? deps.now() : new Date());

interface ChannelPlan {
  /** Channels that handle this event and can send now: each gets a row. */
  ready: NotificationChannel[];
  /** Channels that handle this event but are unavailable: logged, no row. */
  skipped: { id: string; reason: string }[];
}

function planChannels(event: NotificationEventType, deps: NotificationDeps): ChannelPlan {
  const plan: ChannelPlan = { ready: [], skipped: [] };
  for (const channel of deps.channels()) {
    if (channel.events && !channel.events.includes(event)) continue;
    const availability = channel.availability();
    if (availability.ok) plan.ready.push(channel);
    else plan.skipped.push({ id: channel.id, reason: availability.reason });
  }
  return plan;
}

function buildRows(payload: NotificationEventPayload, channels: readonly NotificationChannel[], now: Date): PendingDeliveryRow[] {
  const subject = eventSubject(payload);
  const leaseUntil = new Date(now.getTime() + RETRY_CLAIM_LEASE_MS);
  return channels.map((channel) => ({
    id: crypto.randomUUID(),
    event: payload.event,
    channel: channel.id,
    subject,
    payload,
    leaseUntil,
    createdAt: now,
  }));
}

function logSkipped(payload: NotificationEventPayload, skipped: ChannelPlan['skipped']): void {
  for (const { id, reason } of skipped) {
    logNotification('warn', 'skipped', { event: payload.event, channel: id, ...subjectLogFields(eventSubject(payload)), reason });
  }
}

/** First attempt on already-written PENDING rows: send, then SENT / FAILED. */
async function dispatchRows(
  rows: readonly PendingDeliveryRow[],
  channels: readonly NotificationChannel[],
  deps: NotificationDeps,
): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      const fields = { event: row.event, channel: row.channel, ...subjectLogFields(row.subject) };
      try {
        const channel = channels.find((c) => c.id === row.channel);
        if (!channel) return;
        const result = await channel.send(row.payload).catch(() => ({ ok: false as const, error: 'ADAPTER_ERROR' }));
        if (!result.ok) logNotification('warn', 'delivery failed', { ...fields, error: result.error });
        await markDeliveryResult(row.id, result, result.ok ? null : nextRetryAt(1, result.error, clock(deps)));
      } catch {
        // A failed outbox update: the row stays PENDING and the worker sends it
        // after its lease. Code only — the error could carry a connection string.
        logNotification('error', 'internal error', fields);
      }
    }),
  );
}

/**
 * The outbox for one NEW order / contact lead (see the module comment).
 *
 *   const outbox = createOutbox('order.created');
 *   const saved = await saveOrder(order, { outbox: (o) => outbox.rowsFor(event(o)) });
 *   outbox.dispatchInBackground();
 *
 * `rowsFor` is pure and may run more than once (the order store retries a
 * colliding order number); only the rows of its LAST call — the committed
 * write — are dispatched. Nothing is sent unless dispatch is called, so a
 * failed business write sends nothing.
 */
export interface Outbox {
  rowsFor(payload: NotificationEventPayload): PendingDeliveryRow[];
  /** First attempt after commit; resolves when done, never rejects. */
  dispatch(): Promise<void>;
  /** Same, fire-and-forget: the response never waits for a provider. */
  dispatchInBackground(): void;
}

export function createOutbox(event: NotificationEventType, deps: NotificationDeps = defaultDeps): Outbox {
  let plan: ChannelPlan;
  try {
    plan = planChannels(event, deps);
  } catch {
    plan = { ready: [], skipped: [] };
    logNotification('error', 'internal error', { event });
  }
  let committed: { payload: NotificationEventPayload; rows: PendingDeliveryRow[] } | null = null;

  const dispatch = async (): Promise<void> => {
    if (!committed) return;
    logSkipped(committed.payload, plan.skipped);
    await dispatchRows(committed.rows, plan.ready, deps);
  };

  return {
    rowsFor(payload) {
      const rows = buildRows(payload, plan.ready, clock(deps));
      committed = { payload, rows };
      return rows;
    },
    dispatch,
    dispatchInBackground() {
      void dispatch();
    },
  };
}

/** An event with no business transaction to join: rows written on their own, then attempted. */
export async function emitNotificationEvent(
  payload: NotificationEventPayload,
  deps: NotificationDeps = defaultDeps,
): Promise<void> {
  try {
    const plan = planChannels(payload.event, deps);
    logSkipped(payload, plan.skipped);
    const subject = eventSubject(payload);
    const channels: NotificationChannel[] = [];
    for (const channel of plan.ready) {
      if (channel.oncePerSubject && (await hasSentDelivery(payload.event, channel.id, subject))) {
        logNotification('warn', 'skipped', {
          event: payload.event,
          channel: channel.id,
          ...subjectLogFields(subject),
          reason: 'ALREADY_SENT',
        });
        continue;
      }
      channels.push(channel);
    }
    const rows = buildRows(payload, channels, clock(deps));
    await insertPendingDeliveries(rows);
    await dispatchRows(rows, channels, deps);
  } catch {
    // A failed outbox write. Code only — the error object could carry a
    // connection string or a request URL containing a bot token.
    logNotification('error', 'internal error', { event: payload.event, ...subjectLogFields(eventSubject(payload)) });
  }
}

/** Order events (order.created, order.status_changed, order.paid). */
export function emitOrderEvent(payload: OrderEventPayload, deps: NotificationDeps = defaultDeps): Promise<void> {
  return emitNotificationEvent(payload, deps);
}

/** A contact.created event on its own (the contact API uses createOutbox instead). */
export function emitContactLeadEvent(payload: ContactLeadEventPayload, deps: NotificationDeps = defaultDeps): Promise<void> {
  return emitNotificationEvent(payload, deps);
}

/** Fire-and-forget wrapper for call sites: returns immediately, never rejects. */
export function emitOrderEventInBackground(payload: OrderEventPayload): void {
  void emitOrderEvent(payload);
}

/**
 * One worker pass: re-sends PENDING rows whose lease ran out (the sending
 * process died) and FAILED rows whose `nextAttemptAt` is due, at most `limit`
 * of them. Returns how many succeeded. Never resends a SENT row (only
 * PENDING/FAILED rows are listed and claimed), claims each row before sending
 * so a second worker cannot send it too, and always leaves a row either SENT,
 * scheduled in the future, or final — never due again at once.
 */
export async function retryFailedDeliveries(deps: NotificationDeps = defaultDeps, limit = 50): Promise<number> {
  const channels = deps.channels();
  let sent = 0;
  for (const row of await listDueDeliveries(clock(deps), limit)) {
    const now = clock(deps);
    if (!row.nextAttemptAt || !(await claimDelivery(row.id, row.nextAttemptAt, new Date(now.getTime() + RETRY_CLAIM_LEASE_MS)))) {
      continue;
    }
    const subject = eventSubject(row.payload);
    const fields = { event: row.event, channel: row.channel, ...subjectLogFields(subject) };
    if (now.getTime() - row.createdAt.getTime() > RETRY_MAX_AGE_MS) {
      await rescheduleDelivery(row.id, null, 'EXPIRED');
      logNotification('warn', 'retry abandoned', { ...fields, reason: 'EXPIRED' });
      continue;
    }
    const channel = channels.find((c) => c.id === row.channel);
    if (!channel || !channel.availability().ok) {
      await rescheduleDelivery(row.id, new Date(now.getTime() + RETRY_UNAVAILABLE_POSTPONE_MS));
      logNotification('warn', 'retry postponed', { ...fields, reason: 'CHANNEL_UNAVAILABLE' });
      continue;
    }
    // Not this channel's event, or a duplicate row for an event this channel
    // already delivered: nothing left to do for this row.
    if (channel.events && !channel.events.includes(row.payload.event)) {
      await rescheduleDelivery(row.id, null, 'UNSUPPORTED_EVENT');
      continue;
    }
    if (channel.oncePerSubject && (await hasSentDelivery(row.event, row.channel, subject))) {
      await rescheduleDelivery(row.id, null, 'ALREADY_SENT');
      continue;
    }
    const result = await channel.send(row.payload).catch(() => ({ ok: false as const, error: 'ADAPTER_ERROR' }));
    const attempts = row.attempts + 1;
    const next = result.ok ? null : nextRetryAt(attempts, result.error, clock(deps));
    await markDeliveryResult(row.id, result, next);
    if (result.ok) {
      sent += 1;
    } else {
      logNotification('warn', next ? 'retry failed' : 'retry gave up', {
        ...fields,
        error: result.error,
        attempt: String(attempts),
      });
    }
  }
  return sent;
}
