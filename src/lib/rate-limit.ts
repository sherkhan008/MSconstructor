import { env } from '@/lib/env';

/**
 * Fixed-window in-memory rate limiter. Good enough for a single Node
 * process; when REDIS_URL is configured this is the seam where a shared
 * Redis-backed limiter would replace the in-memory Map without changing any
 * call site — every caller only sees `checkRateLimit(key, opts)`.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Prevent unbounded growth in a long-running dev/prod process.
const MAX_TRACKED_KEYS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Best-effort client identifier for rate limiting behind a proxy/CDN. */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

export const RATE_LIMITS = {
  pricing: { limit: 60, windowMs: 60_000 },
  orders: { limit: 5, windowMs: 60_000 },
  contact: { limit: 5, windowMs: 60_000 },
  promoCode: { limit: 20, windowMs: 60_000 },
  adminLogin: { limit: 10, windowMs: 60_000 },
} as const;

export const isRedisConfigured = Boolean(env.REDIS_URL);
