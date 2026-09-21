import type { OrderEventPayload } from './events';
import { defaultChannels, type NotificationChannel } from './channels';
import {
  claimDelivery,
  hasSentDelivery,
  listDueDeliveries,
  markDeliveryResult,
  recordDelivery,
  rescheduleDelivery,
} from './store';
import {
  RETRY_CLAIM_LEASE_MS,
  RETRY_MAX_AGE_MS,
  RETRY_UNAVAILABLE_POSTPONE_MS,
  nextRetryAt,
} from './retry-policy';

/**
 * The notification boundary. Order and payment code calls `emitOrderEvent`
 * AFTER its own state is committed and never depends on its outcome: this
 * function cannot throw, so no channel, database or configuration problem can
 * reach the caller.
 *
 * Outcomes are observable, never faked:
 *  - channel unavailable -> one structured warn line, nothing recorded;
 *  - channel attempted   -> SENT or FAILED row (short code) in the outbox,
 *    plus a warn line on failure.
 * Retry: a FAILED row with a transient error gets a `nextAttemptAt`
 * (./retry-policy.ts). `retryFailedDeliveries()` re-sends due rows; it runs
 * ONLY in the separate notifications worker (scripts/notification-retry-worker.ts,
 * the `notifications-worker` compose service) — never inside a request, so
 * order creation never waits for a retry.
 *
 * Logs carry event, channel, order number and a code only. The order number is
 * a business reference, not customer PII.
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

async function deliverOne(channel: NotificationChannel, payload: OrderEventPayload, deps: NotificationDeps): Promise<void> {
  if (channel.events && !channel.events.includes(payload.event)) return;
  const availability = channel.availability();
  if (!availability.ok) {
    logNotification('warn', 'skipped', {
      event: payload.event,
      channel: channel.id,
      reason: availability.reason,
      order: payload.orderNumber,
    });
    return;
  }
  if (channel.oncePerOrder && (await hasSentDelivery(payload.event, channel.id, payload.orderNumber))) {
    logNotification('warn', 'skipped', {
      event: payload.event,
      channel: channel.id,
      reason: 'ALREADY_SENT',
      order: payload.orderNumber,
    });
    return;
  }
  const result = await channel.send(payload);
  if (!result.ok) {
    logNotification('warn', 'delivery failed', {
      event: payload.event,
      channel: channel.id,
      error: result.error,
      order: payload.orderNumber,
    });
  }
  await recordDelivery({
    event: payload.event,
    channel: channel.id,
    status: result.ok ? 'SENT' : 'FAILED',
    orderNumber: payload.orderNumber,
    payload,
    lastError: result.ok ? undefined : result.error,
    nextAttemptAt: result.ok ? null : nextRetryAt(1, result.error, clock(deps)),
    createdAt: clock(deps),
  });
}

export async function emitOrderEvent(
  payload: OrderEventPayload,
  deps: NotificationDeps = defaultDeps,
): Promise<void> {
  try {
    await Promise.all(
      deps.channels().map((channel) =>
        deliverOne(channel, payload, deps).catch(() => {
          // A throwing adapter or a failed outbox write. Code only — the error
          // object could carry a request URL containing a bot token.
          logNotification('error', 'internal error', {
            event: payload.event,
            channel: channel.id,
            order: payload.orderNumber,
          });
        }),
      ),
    );
  } catch {
    logNotification('error', 'internal error', { event: payload.event, order: payload.orderNumber });
  }
}

/** Fire-and-forget wrapper for call sites: returns immediately, never rejects. */
export function emitOrderEventInBackground(payload: OrderEventPayload): void {
  void emitOrderEvent(payload);
}

/**
 * One worker pass: re-sends FAILED deliveries whose `nextAttemptAt` is due,
 * at most `limit` of them. Returns how many succeeded. Never resends a SENT
 * row (only FAILED rows are listed and claimed), claims each row before
 * sending so a second worker cannot send it too, and always leaves a row
 * either SENT, scheduled in the future, or final — never due again at once.
 */
export async function retryFailedDeliveries(deps: NotificationDeps = defaultDeps, limit = 50): Promise<number> {
  const channels = deps.channels();
  let sent = 0;
  for (const row of await listDueDeliveries(clock(deps), limit)) {
    const now = clock(deps);
    if (!row.nextAttemptAt || !(await claimDelivery(row.id, row.nextAttemptAt, new Date(now.getTime() + RETRY_CLAIM_LEASE_MS)))) {
      continue;
    }
    const fields = { event: row.event, channel: row.channel, order: row.orderNumber };
    if (now.getTime() - row.createdAt.getTime() > RETRY_MAX_AGE_MS) {
      await rescheduleDelivery(row.id, null);
      logNotification('warn', 'retry abandoned', { ...fields, reason: 'EXPIRED' });
      continue;
    }
    const channel = channels.find((c) => c.id === row.channel);
    if (!channel || !channel.availability().ok) {
      await rescheduleDelivery(row.id, new Date(now.getTime() + RETRY_UNAVAILABLE_POSTPONE_MS));
      logNotification('warn', 'retry postponed', { ...fields, reason: 'CHANNEL_UNAVAILABLE' });
      continue;
    }
    // Not this channel's event, or a duplicate FAILED row for an event this
    // channel already delivered: nothing left to do for this row.
    if (
      (channel.events && !channel.events.includes(row.payload.event)) ||
      (channel.oncePerOrder && (await hasSentDelivery(row.event, row.channel, row.orderNumber)))
    ) {
      await rescheduleDelivery(row.id, null);
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
