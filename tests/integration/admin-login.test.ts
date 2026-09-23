import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/auth/password';

const REAL_PASSWORD = 'CorrectHorseBattery1!';

function fakeCookieStore() {
  return { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
}

let ipCounter = 0;
function loginRequest(body: unknown): NextRequest {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.0.${ipCounter}` },
    body: JSON.stringify(body),
  });
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'admin@ms-stellazh.kz',
    name: 'Тест Админ',
    passwordHash: hashPassword(REAL_PASSWORD),
    role: 'SUPER_ADMIN',
    active: true,
    sessionVersion: 2,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function setupLoginRoute(userLookupResult: unknown) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  vi.stubEnv('NODE_ENV', 'test');

  const cookieStore = fakeCookieStore();
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

  const findUnique = vi.fn(async () => userLookupResult);
  const update = vi.fn(async () => userLookupResult);
  const auditLogCreate = vi.fn(async () => ({}));
  vi.doMock('@/lib/db/client', () => ({
    prisma: {
      user: { findUnique, update },
      auditLog: { create: auditLogCreate },
    },
  }));

  const { POST } = await import('@/app/api/admin/login/route');
  return { POST, cookieStore, findUnique, update, auditLogCreate };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

describe('POST /api/admin/login', () => {
  it('logs in with a valid email/password, sets the session cookie, and records success', async () => {
    const { POST, cookieStore, update, auditLogCreate } = await setupLoginRoute(activeUser());
    const response = await POST(loginRequest({ email: 'admin@ms-stellazh.kz', password: REAL_PASSWORD }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(cookieStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin_session', httpOnly: true, sameSite: 'lax' }),
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastLoginAt: expect.any(Date) } }));
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ADMIN_LOGIN_SUCCESS' }) }),
    );
  });

  it('stamps the current sessionVersion of the user into the issued token', async () => {
    // Without this, revocation (src/lib/auth/revocation.ts) has nothing to
    // compare against and every new login would be issued at version 0 — i.e.
    // already revoked for any admin whose sessions were ever rotated.
    const { POST, cookieStore } = await setupLoginRoute(activeUser({ sessionVersion: 7 }));
    await POST(loginRequest({ email: 'admin@ms-stellazh.kz', password: REAL_PASSWORD }));

    const [{ value: token }] = cookieStore.set.mock.calls[0] as [{ value: string }];
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(payload.ver).toBe(7);
    expect(payload.role).toBe('SUPER_ADMIN');
  });

  it('rejects an incorrect password without revealing the reason, and records the failure', async () => {
    const { POST, cookieStore, auditLogCreate } = await setupLoginRoute(activeUser());
    const response = await POST(loginRequest({ email: 'admin@ms-stellazh.kz', password: 'WrongPassword' }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.message).toBe('Неверный email или пароль');
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ADMIN_LOGIN_FAILED', newData: expect.objectContaining({ reason: 'bad_password' }) }),
      }),
    );
  });

  it('rejects an inactive account with the same generic message', async () => {
    const { POST, cookieStore, auditLogCreate } = await setupLoginRoute(activeUser({ active: false }));
    const response = await POST(loginRequest({ email: 'admin@ms-stellazh.kz', password: REAL_PASSWORD }));

    expect(response.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ADMIN_LOGIN_FAILED', newData: expect.objectContaining({ reason: 'inactive' }) }),
      }),
    );
  });

  it('rejects an unknown email with the same generic message', async () => {
    const { POST, cookieStore, auditLogCreate } = await setupLoginRoute(null);
    const response = await POST(loginRequest({ email: 'nobody@ms-stellazh.kz', password: REAL_PASSWORD }));

    expect(response.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ADMIN_LOGIN_FAILED', newData: expect.objectContaining({ reason: 'unknown_email' }) }),
      }),
    );
  });

  it('rejects a malformed request body', async () => {
    const { POST } = await setupLoginRoute(activeUser());
    const response = await POST(loginRequest({ email: 'not-an-email', password: '' }));
    expect(response.status).toBe(400);
  });

  it('never returns the password hash in the response', async () => {
    const { POST } = await setupLoginRoute(activeUser());
    const response = await POST(loginRequest({ email: 'admin@ms-stellazh.kz', password: REAL_PASSWORD }));
    const text = await response.text();
    expect(text).not.toContain('passwordHash');
  });

  it('rate-limits repeated login attempts from the same client', async () => {
    const { POST } = await setupLoginRoute(activeUser({ active: false }));
    const fixedRequest = () =>
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
        body: JSON.stringify({ email: 'admin@ms-stellazh.kz', password: 'x' }),
      });

    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const response = await POST(fixedRequest());
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('fails clearly (not with a stack trace) when no database is configured', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    vi.stubEnv('DATABASE_URL', '');
    vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => fakeCookieStore()) }));
    const { POST } = await import('@/app/api/admin/login/route');

    const response = await POST(loginRequest({ email: 'admin@ms-stellazh.kz', password: REAL_PASSWORD }));
    const json = await response.json();
    expect(response.status).toBe(503);
    expect(json.ok).toBe(false);
  });
});
