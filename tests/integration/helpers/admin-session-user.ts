import { vi } from 'vitest';

/**
 * Prisma `user` delegate stub for tests that drive an admin route with a
 * session cookie.
 *
 * Since src/lib/auth/revocation.ts, getCurrentAdmin() no longer trusts a
 * signed cookie on its own: it also reads the admin's row to confirm the
 * session has not been revoked (active, matching sessionVersion, matching
 * role). Route tests mock `@/lib/db/client`, so that lookup has to be mocked
 * too — otherwise every authenticated route test gets a 401.
 *
 * The row is derived from the token the test actually minted, so a test that
 * signs in as MANAGER still gets MANAGER and nothing has to be kept in sync
 * by hand. Tests that want to assert revocation behaviour should use the
 * dedicated tests/integration/admin-session-revocation.test.ts instead.
 */
export function adminUserLookupFor(token?: string) {
  const payload = decodeSessionPayload(token);
  const findUnique = vi.fn(async () =>
    payload ? { active: true, role: payload.role, sessionVersion: payload.ver ?? 0 } : null,
  );
  return { findUnique, update: vi.fn(async () => ({ sessionVersion: (payload?.ver ?? 0) + 1 })) };
}

function decodeSessionPayload(token?: string): { role: string; ver?: number } | null {
  if (!token) return null;
  const [payloadPart] = token.split('.');
  if (!payloadPart) return null;
  try {
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
  } catch {
    return null;
  }
}
