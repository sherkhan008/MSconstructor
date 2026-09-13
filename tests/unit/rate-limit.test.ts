import { describe, expect, it, vi } from 'vitest';
import {
  createRateLimiter,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitName,
  type RateLimitStore,
} from '@/lib/rate-limit';

/**
 * Limiter semantics independent of storage: the numbers, window recovery,
 * namespace separation, bounded memory without global resets, and the
 * shared-store failure policy (public fallback vs adminLogin deny).
 */

function clock(start = 1_000_000) {
  const state = { value: start };
  return { now: () => state.value, advance: (ms: number) => (state.value += ms) };
}

async function allowedCount(check: () => Promise<{ allowed: boolean }>, attempts: number): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < attempts; i += 1) if ((await check()).allowed) allowed += 1;
  return allowed;
}

describe('configured limits are unchanged', () => {
  it.each([
    ['pricing', 60],
    ['orders', 5],
    ['contact', 5],
    ['promoCode', 20],
    ['adminLogin', 10],
  ] as [RateLimitName, number][])('%s allows exactly %i per 60s', async (name, limit) => {
    expect(RATE_LIMITS[name]).toMatchObject({ limit, windowMs: 60_000 });
    const limiter = createRateLimiter();
    expect(await allowedCount(() => limiter.check(name, 'ip4:198.51.100.1'), limit + 10)).toBe(limit);
    const denied = await limiter.check(name, 'ip4:198.51.100.1');
    expect(denied).toMatchObject({ allowed: false, remaining: 0, reason: 'limit-exceeded' });
  });

  it('adminLogin is the only limiter that fails closed when the shared store is down', () => {
    expect(RATE_LIMITS.adminLogin.whenSharedStoreUnavailable).toBe('deny');
    for (const name of ['pricing', 'orders', 'contact', 'promoCode'] as const) {
      expect(RATE_LIMITS[name].whenSharedStoreUnavailable).toBe('local-fallback');
    }
  });
});

describe('buckets', () => {
  it('independent clients get independent buckets', async () => {
    const limiter = createRateLimiter();
    expect(await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.1'), 8)).toBe(5);
    expect(await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.2'), 8)).toBe(5);
  });

  it('limiters are separate namespaces', async () => {
    const limiter = createRateLimiter();
    await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.1'), 5);
    expect((await limiter.check('orders', 'ip4:198.51.100.1')).allowed).toBe(false);
    expect((await limiter.check('contact', 'ip4:198.51.100.1')).allowed).toBe(true);
    expect((await limiter.check('adminLogin', 'ip4:198.51.100.1')).allowed).toBe(true);
  });

  it('an expired window recovers, a live one does not', async () => {
    const time = clock();
    const limiter = createRateLimiter({ now: time.now });
    await allowedCount(() => limiter.check('adminLogin', 'ip4:198.51.100.1'), 10);
    expect((await limiter.check('adminLogin', 'ip4:198.51.100.1')).allowed).toBe(false);
    time.advance(59_999);
    expect((await limiter.check('adminLogin', 'ip4:198.51.100.1')).allowed).toBe(false);
    time.advance(1);
    const recovered = await limiter.check('adminLogin', 'ip4:198.51.100.1');
    expect(recovered).toMatchObject({ allowed: true, remaining: 9 });
  });
});

describe('bounded memory store', () => {
  it('never resets unrelated clients when full (no global clear)', async () => {
    const time = clock();
    const store = new MemoryRateLimitStore({ maxKeys: 100, now: time.now });
    // The oldest client, whose window is closest to expiring.
    for (let i = 0; i < 5; i += 1) store.hitSync('orders:oldest', 60_000);
    time.advance(1);
    // Fill the store past capacity with other clients.
    for (let i = 0; i < 99; i += 1) store.hitSync(`orders:filler-${i}`, 60_000);
    time.advance(1);
    store.hitSync('orders:newcomer', 60_000);
    expect(store.size).toBeLessThanOrEqual(100);
    // Only the single oldest window was evicted; every newer client keeps its count.
    for (let i = 0; i < 99; i += 1) expect(store.hitSync(`orders:filler-${i}`, 60_000).count).toBe(2);
    expect(store.hitSync('orders:newcomer', 60_000).count).toBe(2);
  });

  it('drops expired windows before evicting any live one', () => {
    const time = clock();
    const store = new MemoryRateLimitStore({ maxKeys: 3, now: time.now });
    // "live" is the OLDEST entry, so oldest-first eviction alone would drop it.
    for (let i = 0; i < 4; i += 1) store.hitSync('live', 60_000);
    store.hitSync('a', 1_000);
    store.hitSync('b', 1_000);
    time.advance(1_100); // a and b expired, "live" has not
    store.hitSync('new-1', 60_000);
    store.hitSync('new-2', 60_000);
    expect(store.hitSync('live', 60_000).count).toBe(5);
  });

  it('the app-wide limiter keeps one memory store per limiter', async () => {
    const limiter = createRateLimiter({ memoryMaxKeysPerLimiter: 2 });
    for (let i = 0; i < 5; i += 1) await limiter.check('adminLogin', 'ip4:198.51.100.1');
    // Flooding a different limiter with many identities cannot evict adminLogin state.
    for (let i = 0; i < 50; i += 1) await limiter.check('pricing', `ip4:10.0.0.${i}`);
    expect(await allowedCount(() => limiter.check('adminLogin', 'ip4:198.51.100.1'), 10)).toBe(5);
  });
});

describe('shared store failure policy', () => {
  const failingStore = (): RateLimitStore => ({ hit: vi.fn(() => Promise.reject(new Error('down'))) });

  it('public limiters keep enforcing the same limit from local memory — never unlimited', async () => {
    const onSharedStoreError = vi.fn();
    const limiter = createRateLimiter({ sharedStore: failingStore(), onSharedStoreError });
    expect(await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.1'), 20)).toBe(5);
    expect(await allowedCount(() => limiter.check('pricing', 'ip4:198.51.100.1'), 100)).toBe(60);
    expect(await allowedCount(() => limiter.check('contact', 'ip4:198.51.100.1'), 20)).toBe(5);
    expect(onSharedStoreError).toHaveBeenCalled();
  });

  it('adminLogin is denied with reason store-unavailable', async () => {
    const limiter = createRateLimiter({ sharedStore: failingStore() });
    for (let i = 0; i < 20; i += 1) {
      expect(await limiter.check('adminLogin', `ip4:198.51.100.${i}`)).toMatchObject({
        allowed: false,
        reason: 'store-unavailable',
      });
    }
  });

  it('backs off the failing store, then uses it again once it recovers', async () => {
    const time = clock();
    let healthy = false;
    const hit = vi.fn(async () => {
      if (!healthy) throw new Error('down');
      return { count: 1, resetAt: time.now() + 60_000 };
    });
    const limiter = createRateLimiter({ sharedStore: { hit }, now: time.now, sharedStoreRetryMs: 5_000 });
    await limiter.check('adminLogin', 'ip4:198.51.100.1');
    await limiter.check('adminLogin', 'ip4:198.51.100.1');
    expect(hit).toHaveBeenCalledTimes(1);
    healthy = true;
    time.advance(5_000);
    expect((await limiter.check('adminLogin', 'ip4:198.51.100.1')).allowed).toBe(true);
    expect(hit).toHaveBeenCalledTimes(2);
  });
});
