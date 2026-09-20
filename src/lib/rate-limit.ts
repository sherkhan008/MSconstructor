import { env } from '@/lib/env';
import { MinimalRedisClient, RedisReplyError, type RespValue } from '@/lib/redis/resp-client';
import { rateLimitIdentity, resolveClientIp } from '@/lib/security/client-ip';

/**
 * Fixed-window rate limiting, keyed by the trusted client identity from
 * src/lib/security/client-ip.ts (never by a raw request header).
 *
 * Storage:
 * - REDIS_URL set → one shared Redis counter per (limiter, client, window),
 *   so every app instance enforces the same limit. Each hit is a single
 *   atomic MULTI/EXEC: `SET key 0 PX window NX` + `INCR` + `PTTL`. The TTL is
 *   set only when the window opens, so every key expires on its own; nothing
 *   is ever bulk-deleted.
 * - REDIS_URL unset → per-process memory (correct for a single instance).
 *
 * Shared store failure policy (Redis configured but erroring/unreachable):
 * - public limiters (`local-fallback`) keep enforcing the SAME numbers from
 *   per-process memory — degraded to per-instance counting, never unlimited,
 *   and the storefront stays up.
 * - adminLogin and payments (`deny`) refuse the attempt: their protection is
 *   only as strong as the shared counter, so a Redis outage must not multiply
 *   the allowance by the instance count. Existing admin sessions are
 *   unaffected, and no order or payment record is touched by a refusal.
 */

export type SharedStoreFailurePolicy = 'local-fallback' | 'deny';

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
  readonly whenSharedStoreUnavailable: SharedStoreFailurePolicy;
}

export const RATE_LIMITS = {
  pricing: { limit: 60, windowMs: 60_000, whenSharedStoreUnavailable: 'local-fallback' },
  orders: { limit: 5, windowMs: 60_000, whenSharedStoreUnavailable: 'local-fallback' },
  contact: { limit: 5, windowMs: 60_000, whenSharedStoreUnavailable: 'local-fallback' },
  promoCode: { limit: 20, windowMs: 60_000, whenSharedStoreUnavailable: 'local-fallback' },
  // Starting a payment is idempotent per order (src/lib/payments/store.ts), so
  // the limit is about stopping an order-number sweep rather than protecting a
  // write. `deny` on a store outage: unlike the storefront, an unavailable
  // payment path costs a retry, not a lost visitor.
  payments: { limit: 10, windowMs: 60_000, whenSharedStoreUnavailable: 'deny' },
  adminLogin: { limit: 10, windowMs: 60_000, whenSharedStoreUnavailable: 'deny' },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Why the request was refused; absent when allowed. */
  reason?: 'limit-exceeded' | 'store-unavailable';
}

export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  /** Records one hit for `key` and returns the window's count including it. */
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

// --- Memory store -------------------------------------------------------------

/**
 * Per-process fixed windows. Bounded: when full it first drops expired
 * windows (a full scan, at most once per second so a store full of live
 * windows cannot make every request O(n)), then evicts only the single
 * oldest window (Map insertion order is window-start order) — never a global
 * clear that would reset every other client.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitHit>();
  private readonly maxKeys: number;
  private readonly now: () => number;
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  constructor(options: { maxKeys?: number; now?: () => number } = {}) {
    this.maxKeys = options.maxKeys ?? 50_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.buckets.size;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    return this.hitSync(key, windowMs);
  }

  hitSync(key: string, windowMs: number): RateLimitHit {
    const now = this.now();
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return { ...existing };
    }
    if (existing) this.buckets.delete(key);
    if (this.buckets.size >= this.maxKeys) this.makeRoom(now);
    const bucket = { count: 1, resetAt: now + windowMs };
    this.buckets.set(key, bucket);
    return { ...bucket };
  }

  private makeRoom(now: number): void {
    if (now - this.lastSweepAt >= 1_000) {
      this.lastSweepAt = now;
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }
    if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (!oldest.done) this.buckets.delete(oldest.value);
    }
  }
}

// --- Redis store ----------------------------------------------------------------

export interface RedisPipeline {
  pipeline(commands: readonly (readonly string[])[]): Promise<RespValue[]>;
}

export const REDIS_RATE_LIMIT_KEY_PREFIX = 'ms-shelving:rate-limit:v1:';

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisPipeline,
    private readonly options: { keyPrefix?: string; now?: () => number } = {},
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const redisKey = `${this.options.keyPrefix ?? REDIS_RATE_LIMIT_KEY_PREFIX}${key}`;
    const window = String(windowMs);
    const replies = await this.client.pipeline([
      ['MULTI'],
      ['SET', redisKey, '0', 'PX', window, 'NX'],
      ['INCR', redisKey],
      ['PTTL', redisKey],
      ['EXEC'],
    ]);
    const exec = replies[4];
    if (!Array.isArray(exec) || exec.length !== 3 || exec.some((r) => r instanceof RedisReplyError)) {
      throw new RedisReplyError('Rate-limit transaction failed');
    }
    const count = exec[1];
    let ttl = exec[2];
    if (typeof count !== 'number' || typeof ttl !== 'number' || !Number.isFinite(count)) {
      throw new RedisReplyError('Unexpected rate-limit reply');
    }
    if (ttl < 0) {
      // Defensive: a key without TTL (e.g. written by hand) must still expire.
      const [repair] = await this.client.pipeline([['PEXPIRE', redisKey, window]]);
      if (repair instanceof RedisReplyError) throw repair;
      ttl = windowMs;
    }
    return { count, resetAt: (this.options.now ?? Date.now)() + ttl };
  }
}

// --- Limiter ----------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Shared (Redis) store; null/undefined → memory only. */
  sharedStore?: RateLimitStore | null;
  now?: () => number;
  memoryMaxKeysPerLimiter?: number;
  /** After a shared-store failure, skip it for this long instead of paying
   * a timeout on every request. */
  sharedStoreRetryMs?: number;
  onSharedStoreError?: (error: unknown) => void;
}

export interface RateLimiter {
  check(name: RateLimitName, identity: string): Promise<RateLimitResult>;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const retryMs = options.sharedStoreRetryMs ?? 5_000;
  // One memory store per limiter so a flood on one endpoint can never evict
  // another endpoint's buckets.
  const memoryStores = new Map<RateLimitName, MemoryRateLimitStore>();
  let sharedStoreDownUntil = 0;

  const memoryFor = (name: RateLimitName) => {
    let store = memoryStores.get(name);
    if (!store) {
      store = new MemoryRateLimitStore({ maxKeys: options.memoryMaxKeysPerLimiter, now });
      memoryStores.set(name, store);
    }
    return store;
  };

  const toResult = (rule: RateLimitRule, hit: RateLimitHit): RateLimitResult =>
    hit.count <= rule.limit
      ? { allowed: true, remaining: rule.limit - hit.count, resetAt: hit.resetAt }
      : { allowed: false, remaining: 0, resetAt: hit.resetAt, reason: 'limit-exceeded' };

  return {
    async check(name, identity) {
      const rule: RateLimitRule = RATE_LIMITS[name];
      const key = `${name}:${identity}`;
      const shared = options.sharedStore;

      if (!shared) return toResult(rule, memoryFor(name).hitSync(key, rule.windowMs));

      if (now() >= sharedStoreDownUntil) {
        try {
          return toResult(rule, await shared.hit(key, rule.windowMs));
        } catch (error) {
          sharedStoreDownUntil = now() + retryMs;
          options.onSharedStoreError?.(error);
        }
      }

      if (rule.whenSharedStoreUnavailable === 'deny') {
        return { allowed: false, remaining: 0, resetAt: now() + retryMs, reason: 'store-unavailable' };
      }
      return toResult(rule, memoryFor(name).hitSync(key, rule.windowMs));
    },
  };
}

// --- App-wide instance ----------------------------------------------------------------

export const isRedisConfigured = Boolean(env.REDIS_URL);

let defaultLimiter: RateLimiter | null = null;
let lastRedisErrorLogAt = 0;

function getDefaultLimiter(): RateLimiter {
  if (defaultLimiter) return defaultLimiter;
  let sharedStore: RateLimitStore | null = null;
  if (env.REDIS_URL) {
    try {
      sharedStore = new RedisRateLimitStore(new MinimalRedisClient({ url: env.REDIS_URL }));
    } catch (error) {
      // Invalid REDIS_URL: treat exactly like an unreachable Redis (fallback
      // for public limiters, deny for adminLogin) rather than silently
      // running without a shared store.
      const message = error instanceof Error ? error.message : 'invalid REDIS_URL';
      sharedStore = {
        hit: () => Promise.reject(new Error(message)),
      };
    }
  }
  defaultLimiter = createRateLimiter({
    sharedStore,
    onSharedStoreError: (error) => {
      const at = Date.now();
      if (at - lastRedisErrorLogAt < 60_000) return;
      lastRedisErrorLogAt = at;
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error(`[rate-limit] Redis unavailable (${message}); public limits use per-instance memory, admin login is refused.`);
    },
  });
  return defaultLimiter;
}

/** Counts this request against `name` for its trusted client identity. */
export function enforceRateLimit(name: RateLimitName, headers: Headers): Promise<RateLimitResult> {
  return getDefaultLimiter().check(name, rateLimitIdentity(resolveClientIp(headers)));
}
