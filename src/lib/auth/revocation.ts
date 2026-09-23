import { hasDatabase } from '@/lib/env';
import type { AdminSessionPayload } from './session';

/**
 * Server-side revocation boundary for the otherwise stateless admin session
 * cookie (src/lib/auth/session.ts).
 *
 * A signed token proves who issued it and when it expires, but by itself it
 * stays valid for the full 8h TTL — a changed password, a compromised laptop
 * or a deactivated account could not cut it short. Rather than storing a row
 * per session, each admin carries a `sessionVersion`: a token records the
 * version it was issued at, and any token behind the user's current version
 * is dead on its next authenticated request. One `UPDATE` therefore revokes
 * every session of that admin at once, everywhere.
 *
 * Node runtime only — it reads the database, so it can never be called from
 * src/middleware.ts (Edge). That split is deliberate: the middleware stays a
 * cheap redirect, and this is the check that actually gates access, run by
 * getCurrentAdmin() on every protected page and every admin API route.
 */

/** Why a token that passed its signature/expiry check is still not a session. */
export type SessionRevocationReason = 'no-database' | 'unknown-user' | 'inactive' | 'version-mismatch' | 'role-changed' | 'lookup-failed';

export interface SessionLivenessResult {
  live: boolean;
  reason?: SessionRevocationReason;
}

/**
 * Tokens minted before User.sessionVersion existed carry no `ver` at all.
 * They are read as version 0 — the column's default — so deploying
 * revocation does not sign every admin out. This is not a downgrade path: the
 * whole payload is HMAC-signed, so a client cannot strip or lower `ver`
 * without invalidating the signature.
 */
function tokenVersion(payload: AdminSessionPayload): number {
  return typeof payload.ver === 'number' ? payload.ver : 0;
}

/**
 * Fails closed in every uncertain case — an unreadable database means "not
 * authenticated", never "assume still valid".
 */
export async function checkSessionLiveness(payload: AdminSessionPayload): Promise<SessionLivenessResult> {
  // Admin is PostgreSQL-only in every environment (see assertAdminDatabaseConfigured):
  // with no database there is no user table to check against, and no way an
  // admin could have logged in in the first place.
  if (!hasDatabase) return { live: false, reason: 'no-database' };

  let user: { active: boolean; role: string; sessionVersion: number } | null;
  try {
    const { prisma } = await import('@/lib/db/client');
    user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true, role: true, sessionVersion: true },
    });
  } catch {
    return { live: false, reason: 'lookup-failed' };
  }

  if (!user) return { live: false, reason: 'unknown-user' };
  if (!user.active) return { live: false, reason: 'inactive' };
  if (user.sessionVersion !== tokenVersion(payload)) return { live: false, reason: 'version-mismatch' };
  // The role inside the token is what authorize.ts decides on, so a token
  // whose role no longer matches the database is stale by definition: it is
  // refused rather than silently used, which is what keeps a demoted admin
  // from carrying their old rights until expiry. Re-logging in issues a token
  // with the current role.
  if (user.role !== payload.role) return { live: false, reason: 'role-changed' };

  return { live: true };
}

/**
 * Invalidates every session currently issued to this admin, immediately.
 *
 * Call it from anywhere a credential stops being trustworthy: a password
 * change, a deactivation, a suspected cookie leak. Returns the new version so
 * a caller that is also re-issuing a session (e.g. a future "change my
 * password" flow) can mint the replacement token with it and not log the
 * acting admin out of their own browser.
 */
export async function revokeAdminSessions(userId: string): Promise<number> {
  const { prisma } = await import('@/lib/db/client');
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return updated.sessionVersion;
}
