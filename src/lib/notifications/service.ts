import type { OrderEventPayload } from './events';
import { defaultChannels, type NotificationChannel } from './channels';
import { listFailedDeliveries, markDeliveryResult, recordDelivery } from './store';

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
 * Retry: `retryFailedDeliveries()` re-sends stored FAILED rows. There is no
 * scheduler in this repo, so it is intentionally not on a timer — call it from
 * an ops script or cron once real credentials exist.
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
}

const defaultDeps: NotificationDeps = { channels: defaultChannels };

async function deliverOne(channel: NotificationChannel, payload: OrderEventPayload): Promise<void> {
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
  });
}

export async function emitOrderEvent(
  payload: OrderEventPayload,
  deps: NotificationDeps = defaultDeps,
): Promise<void> {
  try {
    await Promise.all(
      deps.channels().map((channel) =>
        deliverOne(channel, payload).catch(() => {
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

/** Re-sends stored FAILED deliveries. Returns how many succeeded. */
export async function retryFailedDeliveries(deps: NotificationDeps = defaultDeps, limit = 50): Promise<number> {
  const channels = deps.channels();
  let sent = 0;
  for (const row of await listFailedDeliveries(limit)) {
    const channel = channels.find((c) => c.id === row.channel);
    if (!channel || !channel.availability().ok) continue;
    const result = await channel.send(row.payload).catch(() => ({ ok: false as const, error: 'ADAPTER_ERROR' }));
    await markDeliveryResult(row.id, result);
    if (result.ok) sent += 1;
  }
  return sent;
}
