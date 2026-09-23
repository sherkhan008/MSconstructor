import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function requestFor(path: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `admin_session=${cookie}`;
  return new NextRequest(new URL(path, 'http://localhost'), { headers });
}

describe('admin route middleware', () => {
  it('redirects an unauthenticated visitor away from /admin/orders to /admin/login', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor('/admin/orders'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/admin/login');
  });

  it('lets an unauthenticated visitor reach /admin/login itself', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor('/admin/login'));
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets an authenticated admin reach /admin/orders', async () => {
    const { createSessionToken } = await import('@/lib/auth/session');
    const token = await createSessionToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' });
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor('/admin/orders', token));
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects an already-authenticated admin away from /admin/login to /admin/orders', async () => {
    const { createSessionToken } = await import('@/lib/auth/session');
    const token = await createSessionToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' });
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor('/admin/login', token));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/admin/orders');
  });

  it('does not bounce a revoked-session visitor back to /admin/orders, which would loop forever', async () => {
    // The Edge middleware cannot see revocation (src/lib/auth/revocation.ts
    // needs the database), so the protected layout is what catches it and
    // sends the visitor to LOGIN_PATH_SESSION_ENDED. If the middleware then
    // redirected that cookie back to /admin/orders, the layout would redirect
    // here again, and so on.
    const { createSessionToken, LOGIN_PATH_SESSION_ENDED } = await import('@/lib/auth/session');
    const token = await createSessionToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' });
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor(LOGIN_PATH_SESSION_ENDED, token));
    expect(response.headers.get('location')).toBeNull();
  });

  it('still redirects a live session away from /admin/login when the marker is not the expected one', async () => {
    const { createSessionToken } = await import('@/lib/auth/session');
    const token = await createSessionToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' });
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor('/admin/login?session=whatever', token));
    expect(response.headers.get('location')).toBe('http://localhost/admin/orders');
  });

  it('rejects a tampered session cookie the same as no session at all', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(requestFor('/admin/orders', 'garbage.notarealtoken'));
    expect(response.headers.get('location')).toBe('http://localhost/admin/login');
  });
});
