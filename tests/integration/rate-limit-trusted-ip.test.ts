import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/auth/password';

/**
 * End-to-end through the real route handlers under the PRODUCTION trust
 * model (NODE_ENV=production, TRUSTED_PROXY_CLIENT_IP_HEADER=x-real-ip):
 * the reverse proxy's canonical X-Real-IP is the identity, and nothing a
 * client can put in X-Forwarded-For (or similar) rotates it. Requests carry
 * a malformed body so each counted attempt returns 400 before any database
 * work — 429 appears only once the limiter refuses.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in ORIGINAL_ENV)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

function productionEnv(extra: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  vi.stubEnv('TRUSTED_PROXY_CLIENT_IP_HEADER', 'x-real-ip');
  delete process.env.NEXT_PHASE;
  delete process.env.REDIS_URL;
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
}

const ROUTES = {
  adminLogin: { module: '@/app/api/admin/login/route', path: '/api/admin/login', limit: 10 },
  orders: { module: '@/app/api/orders/route', path: '/api/orders', limit: 5 },
  contact: { module: '@/app/api/contact/route', path: '/api/contact', limit: 5 },
  pricing: { module: '@/app/api/pricing/calculate/route', path: '/api/pricing/calculate', limit: 60 },
} as const;

type RouteName = keyof typeof ROUTES;

async function loadRoute(name: RouteName): Promise<Post> {
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })) }));
  const mod = await import(ROUTES[name].module);
  const post: Post = (req) => mod.POST(req);
  post.routeName = name;
  return post;
}

function request(name: RouteName, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${ROUTES[name].path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{not json',
  });
}

/** Headers a client fully controls; rotated on every attempt. */
function spoofedHeaders(i: number): Record<string, string> {
  return {
    'x-forwarded-for': `10.${i % 250}.${(i * 7) % 250}.${(i % 253) + 1}, 172.16.0.${i % 250}`,
    forwarded: `for=192.0.2.${i % 250}`,
    'cf-connecting-ip': `198.18.0.${i % 250}`,
    'true-client-ip': `198.18.1.${i % 250}`,
    'x-client-ip': `198.18.2.${i % 250}`,
  };
}

type Post = ((req: NextRequest) => Promise<Response>) & { routeName?: RouteName };

async function statuses(post: Post, count: number, headersFor: (i: number) => Record<string, string>) {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push((await post(request(post.routeName!, headersFor(i)))).status);
  return out;
}

describe('production trust model through the real routes', () => {
  it.each(Object.keys(ROUTES) as RouteName[])(
    '%s: rotating client-controlled forwarding headers cannot bypass the limit',
    async (name) => {
      productionEnv();
      const post = await loadRoute(name);
      const limit = ROUTES[name].limit;
      const results = await statuses(post, limit + 5, (i) => ({ 'x-real-ip': '203.0.113.50', ...spoofedHeaders(i) }));
      expect(results.slice(0, limit).every((s) => s !== 429)).toBe(true);
      expect(results.slice(limit)).toEqual(new Array(5).fill(429));
    },
  );

  it('adminLogin: exactly 10 attempts per minute per real client, whatever else is rotated', async () => {
    productionEnv();
    const post = await loadRoute('adminLogin');
    const results = await statuses(post, 25, (i) => ({ 'x-real-ip': '203.0.113.51', ...spoofedHeaders(i), 'user-agent': `bot-${i}` }));
    expect(results.filter((s) => s !== 429)).toHaveLength(10);
  });

  it('independent real clients (distinct proxy-written IPs) get independent buckets', async () => {
    productionEnv();
    const post = await loadRoute('orders');
    const first = await statuses(post, 6, () => ({ 'x-real-ip': '203.0.113.60' }));
    const second = await statuses(post, 6, () => ({ 'x-real-ip': '203.0.113.61' }));
    expect(first.filter((s) => s === 429)).toHaveLength(1);
    expect(second.filter((s) => s === 429)).toHaveLength(1);
  });

  it('a spoofed chain in the canonical header (proxy appended) resolves to one shared bucket, not new identities', async () => {
    productionEnv();
    const post = await loadRoute('contact');
    const results = await statuses(post, 10, (i) => ({ 'x-real-ip': `10.0.0.${i + 1}, 203.0.113.70` }));
    expect(results.filter((s) => s !== 429)).toHaveLength(5);
  });

  it('with no trusted proxy configured, X-Forwarded-For is ignored and limits fail closed', async () => {
    productionEnv();
    delete process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const post = await loadRoute('adminLogin');
    const results = await statuses(post, 15, (i) => spoofedHeaders(i));
    expect(results.filter((s) => s !== 429)).toHaveLength(10);
    errorSpy.mockRestore();
  });

  it('adminLogin returns 503 (never unlimited) when the configured Redis is unreachable', async () => {
    const net = await import('node:net');
    const dropper = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => dropper.listen(0, '127.0.0.1', resolve));
    try {
      productionEnv({ REDIS_URL: `redis://127.0.0.1:${(dropper.address() as import('node:net').AddressInfo).port}` });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const post = await loadRoute('adminLogin');
      const results = await statuses(post, 12, () => ({ 'x-real-ip': '203.0.113.80' }));
      expect(results).toEqual(new Array(12).fill(503));

      vi.resetModules();
      const pricing = await loadRoute('pricing');
      const pricingResults = await statuses(pricing, 65, () => ({ 'x-real-ip': '203.0.113.80' }));
      expect(pricingResults.filter((s) => s !== 429)).toHaveLength(60);
      errorSpy.mockRestore();
    } finally {
      await new Promise((resolve) => dropper.close(resolve));
    }
  });
});

describe('audit log uses the same canonical client IP as rate limiting', () => {
  it('requestMeta and the rate-limit identity agree, and both ignore client X-Forwarded-For', async () => {
    productionEnv();
    const { requestMeta } = await import('@/lib/admin/audit');
    const { resolveClientIp, rateLimitIdentity } = await import('@/lib/security/client-ip');
    const headers = new Headers({ 'x-real-ip': '203.0.113.90', 'x-forwarded-for': '6.6.6.6', 'user-agent': 'UA' });
    expect(requestMeta(headers)).toEqual({ ipAddress: '203.0.113.90', userAgent: 'UA' });
    expect(rateLimitIdentity(resolveClientIp(headers))).toBe('ip4:203.0.113.90');
  });

  it('a failed admin login audit row records the proxy-written IP, not the forged one', async () => {
    productionEnv();
    const auditLogCreate = vi.fn(async () => ({}));
    vi.doMock('@/lib/db/client', () => ({
      prisma: {
        user: {
          findUnique: vi.fn(async () => ({
            id: 'user-1',
            email: 'admin@ms-stellazh.kz',
            name: 'Админ',
            passwordHash: hashPassword('CorrectHorseBattery1!'),
            role: 'SUPER_ADMIN',
            active: true,
          })),
          update: vi.fn(),
        },
        auditLog: { create: auditLogCreate },
      },
    }));
    const post = await loadRoute('adminLogin');
    const response = await post(
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.91', 'x-forwarded-for': '6.6.6.6' },
        body: JSON.stringify({ email: 'admin@ms-stellazh.kz', password: 'wrong-password' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ADMIN_LOGIN_FAILED', ipAddress: '203.0.113.91' }),
    });
  });

  it('with no trusted proxy configured, audit rows record no IP rather than a forged one', async () => {
    productionEnv();
    delete process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { requestMeta } = await import('@/lib/admin/audit');
    expect(requestMeta(new Headers({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' })).ipAddress).toBeUndefined();
    errorSpy.mockRestore();
  });
});
