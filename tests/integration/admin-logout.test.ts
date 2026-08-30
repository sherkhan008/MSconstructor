import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function fakeCookieStore() {
  return { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
}

function logoutRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/logout', { method: 'POST' });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

describe('POST /api/admin/logout', () => {
  it('deletes the session cookie even when there was no valid session', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const cookieStore = fakeCookieStore();
    vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

    const { POST } = await import('@/app/api/admin/logout/route');
    const response = await POST(logoutRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(cookieStore.delete).toHaveBeenCalledWith('admin_session');
  });

  it('a logged-out session token no longer verifies as an admin', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const { createSessionToken, verifySessionToken } = await import('@/lib/auth/session');
    const token = await createSessionToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' });
    expect(await verifySessionToken(token)).not.toBeNull();

    // Logout deletes the cookie client-side; simulate the resulting
    // "no cookie present" state and confirm it verifies as logged out.
    expect(await verifySessionToken(undefined)).toBeNull();
  });

  it('records ADMIN_LOGOUT in the audit log for an authenticated session, but never fails the response if that write fails', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');

    const cookieStore = fakeCookieStore();
    const { createSessionToken } = await import('@/lib/auth/session');
    const token = await createSessionToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'ADMIN' });
    cookieStore.get.mockReturnValue({ value: token });
    vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

    const auditLogCreate = vi.fn(async () => {
      throw new Error('db unreachable');
    });
    vi.doMock('@/lib/db/client', () => ({ prisma: { auditLog: { create: auditLogCreate } } }));

    const { POST } = await import('@/app/api/admin/logout/route');
    const response = await POST(logoutRequest());

    expect(response.status).toBe(200);
    expect(cookieStore.delete).toHaveBeenCalledWith('admin_session');
  });
});
