import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySessionToken, type AdminSessionPayload } from './session';

/**
 * Reads and verifies the admin session cookie for Server Components and
 * Route Handlers (uses `next/headers`, unavailable in `src/middleware.ts` —
 * that reads `request.cookies` directly instead, see there). Returns null
 * for "not logged in" rather than throwing, since that's an expected state
 * every protected page/route must handle, not an error.
 */
export async function getCurrentAdmin(): Promise<AdminSessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}
