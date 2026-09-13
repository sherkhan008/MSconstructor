import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MinimalRedisClient } from '@/lib/redis/resp-client';
import { createRateLimiter, REDIS_RATE_LIMIT_KEY_PREFIX, RedisRateLimitStore } from '@/lib/rate-limit';
import { startFakeRedisServer, type FakeRedisServer } from './helpers/fake-redis-server';

/**
 * Redis-backed limiter over a real socket. Each "app instance" is its own
 * MinimalRedisClient connection + limiter, exactly as separate Node processes
 * would be. Runs against the in-process RESP server always, and additionally
 * against a real Redis when RATE_LIMIT_TEST_REDIS_URL is set.
 */

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function instance(url: string, now?: () => number) {
  const client = new MinimalRedisClient({ url, connectTimeoutMs: 500, commandTimeoutMs: 300 });
  cleanup.push(() => client.close());
  const store = new RedisRateLimitStore(client, { now });
  return { client, store, limiter: createRateLimiter({ sharedStore: store, now }) };
}

async function fake(options?: { password?: string }): Promise<FakeRedisServer> {
  const server = await startFakeRedisServer(options);
  cleanup.push(() => server.close());
  return server;
}

async function allowedCount(check: () => Promise<{ allowed: boolean }>, attempts: number): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < attempts; i += 1) if ((await check()).allowed) allowed += 1;
  return allowed;
}

describe('Redis-backed rate limiting (in-process RESP server)', () => {
  it('multiple app instances share one counter', async () => {
    const server = await fake();
    const instances = [instance(server.url), instance(server.url), instance(server.url)];
    let allowed = 0;
    // Round-robin 30 login attempts across 3 instances — still 10 total, not 30.
    for (let i = 0; i < 30; i += 1) {
      if ((await instances[i % 3].limiter.check('adminLogin', 'ip4:203.0.113.9')).allowed) allowed += 1;
    }
    expect(allowed).toBe(10);
    expect(server.data.get(`${REDIS_RATE_LIMIT_KEY_PREFIX}adminLogin:ip4:203.0.113.9`)?.value).toBe('30');
  });

  it('keeps orders 5/min, contact 5/min and pricing 60/min across instances', async () => {
    const server = await fake();
    const a = instance(server.url);
    const b = instance(server.url);
    const alternate = (name: 'orders' | 'contact' | 'pricing') => {
      let i = 0;
      return () => (i++ % 2 ? a : b).limiter.check(name, 'ip4:198.51.100.5');
    };
    expect(await allowedCount(alternate('orders'), 12)).toBe(5);
    expect(await allowedCount(alternate('contact'), 12)).toBe(5);
    expect(await allowedCount(alternate('pricing'), 80)).toBe(60);
  });

  it('every key gets a bounded TTL equal to the window, set once when the window opens', async () => {
    const server = await fake();
    const { limiter } = instance(server.url, () => server.now.value);
    await limiter.check('orders', 'ip4:198.51.100.7');
    const key = `${REDIS_RATE_LIMIT_KEY_PREFIX}orders:ip4:198.51.100.7`;
    expect(server.data.get(key)?.expiresAt).toBe(server.now.value + 60_000);
    server.now.value += 30_000;
    await limiter.check('orders', 'ip4:198.51.100.7');
    // A later hit must not extend the window.
    expect(server.data.get(key)?.expiresAt).toBe(server.now.value + 30_000);
    for (const entry of server.data.values()) expect(entry.expiresAt).not.toBeNull();
  });

  it('an expired window recovers', async () => {
    const server = await fake();
    const { limiter } = instance(server.url, () => server.now.value);
    expect(await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.8'), 6)).toBe(5);
    server.now.value += 60_000;
    expect(await limiter.check('orders', 'ip4:198.51.100.8')).toMatchObject({ allowed: true, remaining: 4 });
  });

  it('namespaces are separate and unrelated clients are never reset', async () => {
    const server = await fake();
    const { limiter } = instance(server.url);
    await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.1'), 5);
    for (let i = 0; i < 200; i += 1) await limiter.check('pricing', `ip4:10.0.${Math.floor(i / 250)}.${i}`);
    expect((await limiter.check('orders', 'ip4:198.51.100.1')).allowed).toBe(false);
    expect((await limiter.check('contact', 'ip4:198.51.100.1')).allowed).toBe(true);
    const commands = new Set(server.commandLog.map((c) => c[0].toUpperCase()));
    for (const destructive of ['DEL', 'UNLINK', 'FLUSHDB', 'FLUSHALL', 'KEYS', 'SCAN']) {
      expect(commands.has(destructive)).toBe(false);
    }
  });

  it('repairs a key that somehow has no TTL instead of letting it live forever', async () => {
    const server = await fake();
    const key = `${REDIS_RATE_LIMIT_KEY_PREFIX}contact:ip4:198.51.100.3`;
    server.data.set(key, { value: '2', expiresAt: null });
    const { limiter } = instance(server.url, () => server.now.value);
    expect(await limiter.check('contact', 'ip4:198.51.100.3')).toMatchObject({ allowed: true, remaining: 2 });
    expect(server.data.get(key)?.expiresAt).toBe(server.now.value + 60_000);
  });

  it('authenticates with the password from REDIS_URL', async () => {
    const server = await fake({ password: 's3cr3t/+' });
    const { limiter } = instance(server.url);
    expect((await limiter.check('orders', 'ip4:198.51.100.4')).allowed).toBe(true);
    const wrong = instance(server.url.replace('s3cr3t', 'wrong'));
    // adminLogin fails closed when Redis rejects the connection.
    expect(await wrong.limiter.check('adminLogin', 'ip4:198.51.100.4')).toMatchObject({
      allowed: false,
      reason: 'store-unavailable',
    });
  });

  it('Redis errors: public limiters fall back to memory with the same limit, adminLogin is denied', async () => {
    const server = await fake();
    server.mode.value = 'error';
    const { limiter } = instance(server.url);
    expect(await allowedCount(() => limiter.check('orders', 'ip4:198.51.100.2'), 10)).toBe(5);
    expect(await limiter.check('adminLogin', 'ip4:198.51.100.2')).toMatchObject({ allowed: false, reason: 'store-unavailable' });
  });

  it('a hung Redis times out instead of hanging the request, and adminLogin is denied', async () => {
    const server = await fake();
    server.mode.value = 'hang';
    const { limiter } = instance(server.url);
    const started = Date.now();
    expect(await limiter.check('adminLogin', 'ip4:198.51.100.2')).toMatchObject({ allowed: false, reason: 'store-unavailable' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('unreachable Redis: adminLogin denied, public limits still enforced', async () => {
    // A port that accepts and immediately drops connections.
    const dropper = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => dropper.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise((resolve) => dropper.close(resolve)));
    const url = `redis://127.0.0.1:${(dropper.address() as net.AddressInfo).port}`;
    const { limiter } = instance(url);
    expect(await limiter.check('adminLogin', 'ip4:198.51.100.2')).toMatchObject({ allowed: false, reason: 'store-unavailable' });
    expect(await allowedCount(() => limiter.check('contact', 'ip4:198.51.100.2'), 10)).toBe(5);
  });
});

const realRedisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL;

describe.skipIf(!realRedisUrl)('Redis-backed rate limiting (real Redis)', () => {
  const unique = `test-${process.pid}-${Date.now()}`;

  it('multiple instances share one atomic counter under concurrency', async () => {
    const a = instance(realRedisUrl!);
    const b = instance(realRedisUrl!);
    const identity = `ip4:${unique}-concurrency`;
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).limiter.check('adminLogin', identity)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it('keys carry a TTL no longer than the window and expire on their own', async () => {
    const { client, store } = instance(realRedisUrl!);
    const key = `${unique}:ttl`;
    const first = await store.hit(key, 400);
    expect(first.count).toBe(1);
    const [ttl] = await client.pipeline([['PTTL', `${REDIS_RATE_LIMIT_KEY_PREFIX}${key}`]]);
    expect(typeof ttl === 'number' && ttl > 0 && ttl <= 400).toBe(true);
    expect((await store.hit(key, 400)).count).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect((await store.hit(key, 400)).count).toBe(1);
  });

  it('one client expiring does not reset another', async () => {
    const { store } = instance(realRedisUrl!);
    await store.hit(`${unique}:short`, 200);
    for (let i = 0; i < 3; i += 1) await store.hit(`${unique}:long`, 60_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await store.hit(`${unique}:short`, 200)).count).toBe(1);
    expect((await store.hit(`${unique}:long`, 60_000)).count).toBe(4);
  });
});
