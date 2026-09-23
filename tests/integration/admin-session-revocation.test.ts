import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminRole } from '@/lib/types/domain';

/**
 * Admin sessions are signed, stateless cookies with an 8h TTL. On their own
 * they cannot be cut short — a changed password or a revoked account would
 * leave every already-issued cookie usable until it expired. The revocation
 * boundary (src/lib/auth/revocation.ts) closes that window: a token records
 * the User.sessionVersion it was issued at, and getCurrentAdmin() refuses any
 * token behind the current one.
 *
 * These tests drive the real modules with Prisma and next/headers mocked, the
 * same pattern as tests/integration/admin-login.test.ts.
 */

const USER = { id: 'user-1', email: 'admin@ms-stellazh.kz', name: 'Тест Админ', role: 'SUPER_ADMIN' as AdminRole };

interface DbUser {
  active: boolean;
  role: string;
  sessionVersion: number;
}

/**
 * Builds a fresh module graph with AUTH_SECRET/DATABASE_URL stubbed (both are
 * read once at import time), a cookie store holding `token`, and a User row
 * the revocation lookup will find.
 */
async function setup(options: { token?: string; dbUser?: DbUser | null; findUnique?: () => Promise<unknown> } = {}) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  vi.stubEnv('NODE_ENV', 'test');

  const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  if (options.token) cookieStore.get.mockReturnValue({ value: options.token });
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

  const findUnique = vi.fn(options.findUnique ?? (async () => options.dbUser ?? null));
  vi.doMock('@/lib/db/client', () => ({ prisma: { user: { findUnique, update: vi.fn() } } }));

  const { getCurrentAdmin } = await import('@/lib/auth/current-admin');
  const { checkSessionLiveness } = await import('@/lib/auth/revocation');
  const { createSessionToken, verifySessionToken } = await import('@/lib/auth/session');
  return { getCurrentAdmin, checkSessionLiveness, createSessionToken, verifySessionToken, cookieStore, findUnique };
}

/** Mints a token in its own module graph, so the caller can then set up a different database state. */
async function issueToken(sessionVersion: number, role: AdminRole = USER.role): Promise<string> {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  const { createSessionToken } = await import('@/lib/auth/session');
  return createSessionToken({ ...USER, role, sessionVersion });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

describe('admin session revocation', () => {
  it('accepts a session whose version matches the user row', async () => {
    const token = await issueToken(3);
    const { getCurrentAdmin, findUnique } = await setup({
      token,
      dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 3 },
    });

    const admin = await getCurrentAdmin();
    expect(admin).not.toBeNull();
    expect(admin?.sub).toBe(USER.id);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER.id } }),
    );
  });

  it('preserves the role of a valid session', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONTENT_MANAGER'] as AdminRole[]) {
      const token = await issueToken(0, role);
      const { getCurrentAdmin } = await setup({ token, dbUser: { active: true, role, sessionVersion: 0 } });
      const admin = await getCurrentAdmin();
      expect(admin?.role).toBe(role);
    }
  });

  it('rejects a session whose version is behind the user row (revoked)', async () => {
    const token = await issueToken(3);
    const { getCurrentAdmin } = await setup({
      token,
      dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 4 },
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('rejects a session whose version is ahead of the user row', async () => {
    const token = await issueToken(9);
    const { getCurrentAdmin } = await setup({
      token,
      dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 0 },
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('rejects a session belonging to a deactivated admin', async () => {
    const token = await issueToken(0);
    const { getCurrentAdmin } = await setup({
      token,
      dbUser: { active: false, role: 'SUPER_ADMIN', sessionVersion: 0 },
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('rejects a session whose user no longer exists', async () => {
    const token = await issueToken(0);
    const { getCurrentAdmin } = await setup({ token, dbUser: null });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('rejects a session whose role no longer matches the database (no stale privileges)', async () => {
    const token = await issueToken(0, 'SUPER_ADMIN');
    const { getCurrentAdmin } = await setup({
      token,
      dbUser: { active: true, role: 'CONTENT_MANAGER', sessionVersion: 0 },
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('fails closed when the user lookup throws', async () => {
    const token = await issueToken(0);
    const { getCurrentAdmin } = await setup({
      token,
      findUnique: async () => {
        throw new Error('db unreachable');
      },
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('accepts a legacy token issued before sessionVersion existed, as version 0', async () => {
    // Such a token carries no `ver` at all — the same shape createSessionToken
    // produced before this change. Read as 0, so deploying revocation does not
    // sign every admin out.
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const legacy = await import('@/lib/auth/session');
    const token = await legacy.createSessionToken(USER);
    const [payloadPart] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    expect(decoded.ver).toBe(0);

    const { getCurrentAdmin } = await setup({ token, dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 0 } });
    expect(await getCurrentAdmin()).not.toBeNull();
  });

  it('treats a payload with no ver field as version 0', async () => {
    const { checkSessionLiveness } = await setup({ dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 0 } });
    const now = Math.floor(Date.now() / 1000);
    const result = await checkSessionLiveness({ ...USER, sub: USER.id, iat: now, exp: now + 60 });
    expect(result.live).toBe(true);
  });

  it('still rejects an expired session, before any database lookup', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const { createSessionToken, SESSION_TTL_SECONDS } = await import('@/lib/auth/session');
    // Mint it as of one hour past the TTL, so it is already expired now.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - (SESSION_TTL_SECONDS + 3600) * 1000);
    const token = await createSessionToken({ ...USER, sessionVersion: 0 });
    clock.mockRestore();

    const { getCurrentAdmin, findUnique } = await setup({
      token,
      dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 0 },
    });
    expect(await getCurrentAdmin()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('still rejects a tampered session, before any database lookup', async () => {
    const token = await issueToken(0);
    const [, signaturePart] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'attacker', email: 'x@y.z', name: 'X', role: 'SUPER_ADMIN', ver: 0, iat: 0, exp: 9999999999 }),
    ).toString('base64url');

    const { getCurrentAdmin, findUnique } = await setup({
      token: `${forged}.${signaturePart}`,
      dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 0 },
    });
    expect(await getCurrentAdmin()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a version raised by hand inside the cookie (the payload is signed)', async () => {
    const token = await issueToken(0);
    const [payloadPart, signaturePart] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, ver: 99 })).toString('base64url');

    const { getCurrentAdmin } = await setup({
      token: `${forged}.${signaturePart}`,
      dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 99 },
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('fails closed with no database configured, since admin has no other user store', async () => {
    const token = await issueToken(0);
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    vi.stubEnv('DATABASE_URL', '');
    const cookieStore = { get: vi.fn(() => ({ value: token })), set: vi.fn(), delete: vi.fn() };
    vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

    const { getCurrentAdmin } = await import('@/lib/auth/current-admin');
    expect(await getCurrentAdmin()).toBeNull();
  });

  it('returns null when there is no cookie at all', async () => {
    const { getCurrentAdmin, findUnique } = await setup({});
    expect(await getCurrentAdmin()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('revokeAdminSessions', () => {
  it('increments the stored version, invalidating every token already issued', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
    const update = vi.fn(async () => ({ sessionVersion: 4 }));
    vi.doMock('@/lib/db/client', () => ({ prisma: { user: { findUnique: vi.fn(), update } } }));

    const { revokeAdminSessions } = await import('@/lib/auth/revocation');
    await expect(revokeAdminSessions(USER.id)).resolves.toBe(4);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER.id },
        data: { sessionVersion: { increment: 1 } },
      }),
    );
  });

  it('makes a session issued at the previous version stop verifying', async () => {
    const token = await issueToken(3);
    const before = await setup({ token, dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 3 } });
    expect(await before.getCurrentAdmin()).not.toBeNull();

    // …one revocation later, the very same cookie is dead.
    const after = await setup({ token, dbUser: { active: true, role: 'SUPER_ADMIN', sessionVersion: 4 } });
    expect(await after.getCurrentAdmin()).toBeNull();
  });
});
