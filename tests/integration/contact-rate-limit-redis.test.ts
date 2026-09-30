import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { REDIS_RATE_LIMIT_KEY_PREFIX } from '@/lib/rate-limit';
import { startFakeRedisServer, type FakeRedisServer } from './helpers/fake-redis-server';

/**
 * The contact endpoint's abuse protection through the REAL route and the
 * app-wide limiter (src/lib/rate-limit.ts, `contact`: 5 per minute per
 * client, `local-fallback` when Redis fails):
 *
 *  - Redis configured → the counter lives in Redis and is shared by every
 *    app instance (two separately loaded route modules here);
 *  - Redis unreachable → the same limit from per-process memory, never
 *    unlimited, and the form keeps working.
 *
 * The real-Redis block runs only when RATE_LIMIT_TEST_REDIS_URL is set; the
 * rest uses an in-process RESP server or a closed port.
 */

/** Reserved fixture phone: when DATABASE_URL is set the route stores real
 * leads, and afterAll deletes exactly the ones with this number. */
const BODY = { name: 'Тест Лимит', phone: '+79070001122', message: 'Проверка лимита' };

afterAll(async () => {
  if (!process.env.DATABASE_URL?.startsWith('postgres')) return;
  const { prisma } = await import('@/lib/db/client');
  const ids = (await prisma.contactLead.findMany({ where: { phone: BODY.phone }, select: { id: true } })).map((l) => l.id);
  await prisma.notificationDelivery.deleteMany({ where: { contactLeadId: { in: ids } } });
  await prisma.contactLead.deleteMany({ where: { id: { in: ids } } });
});

function request(ip: string, n: number) {
  return new NextRequest('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ ...BODY, message: `${BODY.message} ${n}` }),
  });
}

/** A fresh copy of the route with its own module graph — a separate app instance. */
async function appInstance(redisUrl: string) {
  vi.resetModules();
  vi.stubEnv('REDIS_URL', redisUrl);
  return (await import('@/app/api/contact/route')).POST;
}

describe('contact rate limit — Redis and fallback', () => {
  let fake: FakeRedisServer | undefined;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fake?.close();
    fake = undefined;
  });

  it('Redis configured: the contact counter is a Redis key with a TTL, shared by two app instances', async () => {
    fake = await startFakeRedisServer();
    const a = await appInstance(fake.url);
    const b = await appInstance(fake.url);
    const ip = '10.55.0.1';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await (i % 2 ? a : b)(request(ip, i))).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    const key = `${REDIS_RATE_LIMIT_KEY_PREFIX}contact:ip4:${ip}`;
    expect(fake.data.get(key)?.value).toBe('6');
    expect(fake.data.get(key)?.expiresAt).not.toBeNull();
  });

  it('Redis unreachable: the same 5/min limit from memory — never unlimited, the form keeps working', async () => {
    const POST = await appInstance('redis://127.0.0.1:1/0');
    const ip = '10.55.0.2';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await POST(request(ip, i))).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429]);
  });

  it('invalid REDIS_URL behaves like an unreachable Redis (fallback, still limited)', async () => {
    const POST = await appInstance('not-a-redis-url');
    const ip = '10.55.0.3';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await POST(request(ip, i))).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

const realRedisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL;

describe.skipIf(!realRedisUrl)('contact rate limit (real Redis)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('two app instances share one contact counter in Redis', async () => {
    const a = await appInstance(realRedisUrl!);
    const b = await appInstance(realRedisUrl!);
    // A unique client per run, so reruns inside the same minute never collide.
    const ip = `10.56.${Math.floor(Math.random() * 250)}.${(Date.now() % 250) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await (i % 2 ? a : b)(request(ip, i))).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});
