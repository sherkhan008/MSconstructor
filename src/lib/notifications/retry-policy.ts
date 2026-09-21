/**
 * Automatic retry policy for FAILED notification deliveries (the outbox in
 * ./store.ts), run by the notifications worker (scripts/notification-retry-worker.ts).
 *
 * Pure functions of their input. A delivery is retried only when its error
 * code is transient, at most MAX_DELIVERY_ATTEMPTS attempts in total (the
 * first send included), with a growing delay between attempts. Anything else
 * — a permanent error, an unknown code, the attempt limit — ends automatic
 * retry: the row stays FAILED with no next attempt, visible for manual review.
 */

/** Total sends per delivery, the original attempt included. */
export const MAX_DELIVERY_ATTEMPTS = 6;

/** Delay before the next attempt, indexed by attempts already made (1-based):
 * 1 min, 5 min, 15 min, 1 h, 3 h — the last retry lands ~4 h 20 min after the order. */
export const RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

/** A claimed row is invisible to other workers for this long; if the worker
 * dies mid-send the row becomes due again after it, never in a tight loop. */
export const RETRY_CLAIM_LEASE_MS = 5 * 60_000;

/** A channel that is disabled/unconfigured at retry time is re-checked this
 * much later without spending an attempt. */
export const RETRY_UNAVAILABLE_POSTPONE_MS = 60 * 60_000;

/** A delivery older than this is never retried again: a "new order" alert
 * that arrives days late is noise, not information. */
export const RETRY_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * Meta Graph API error codes that are temporary even when the HTTP status is
 * 4xx: unknown/temporarily unavailable (1, 2), rate limits (4, 80007,
 * 130429, 131048, 131056), "something went wrong" (131000), service /
 * server temporarily unavailable (131016, 133004).
 */
const META_TRANSIENT_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/** Codes produced by the channel adapters (./channels.ts, ./providers/whatsapp.ts). */
export function isTransientDeliveryError(code: string): boolean {
  if (code === 'TIMEOUT' || code === 'NETWORK_ERROR' || code === 'ORDER_LOOKUP_FAILED' || code === 'ADAPTER_ERROR') {
    return true;
  }
  const http = /^HTTP_(\d{3})(?:_META_(\d+))?$/.exec(code);
  if (!http) return false;
  const status = Number(http[1]);
  if (status === 408 || status === 429 || status >= 500) return true;
  return http[2] !== undefined && META_TRANSIENT_CODES.has(Number(http[2]));
}

/** When to try again after `attemptsMade` sends that ended in `error`; null = never. */
export function nextRetryAt(attemptsMade: number, error: string, now: Date): Date | null {
  if (!isTransientDeliveryError(error) || attemptsMade >= MAX_DELIVERY_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attemptsMade, 1), RETRY_DELAYS_MS.length) - 1];
  return new Date(now.getTime() + delay);
}
