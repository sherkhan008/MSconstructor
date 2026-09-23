import { cookies } from 'next/headers';
import { checkSessionLiveness } from './revocation';
import { SESSION_COOKIE_NAME, verifySessionToken, type AdminSessionPayload } from './session';

/**
 * Reads and verifies the admin session cookie for Server Components and
 * Route Handlers (uses `next/headers`, unavailable in `src/middleware.ts` —
 * that reads `request.cookies` directly instead, see there). Returns null
 * for "not logged in" rather than throwing, since that's an expected state
 * every protected page/route must handle, not an error.
 *
 * Two checks, in this order:
 *   1. the signature and expiry of the cookie itself (offline, Edge-safe);
 *   2. whether that session has since been revoked — the database lookup in
 *      src/lib/auth/revocation.ts, which the Edge middleware cannot do.
 *
 * This is THE authorization entry point: every protected page and every
 * admin API route already calls it, so revocation takes effect on the very
 * next authenticated request. The middleware redirect stays a fast first
 * pass, deliberately not the thing that grants access.
 */
export async function getCurrentAdmin(): Promise<AdminSessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const liveness = await checkSessionLiveness(payload);
  return liveness.live ? payload : null;
}
