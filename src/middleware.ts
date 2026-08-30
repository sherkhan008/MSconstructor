import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';

/**
 * Single centralized enforcement point for /admin/* route protection
 * (spec: "do not scatter checks"). Runs on the Edge runtime, so session
 * verification here only ever does an HMAC check (see src/lib/auth/session.ts)
 * — never a database lookup, never Node's `crypto` module. Every admin page
 * and mutation API route also re-checks the session itself server-side
 * (src/lib/auth/current-admin.ts) — this redirect is a fast first line of
 * defense, not the only one.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (pathname === '/admin/login') {
    if (session) return NextResponse.redirect(new URL('/admin/orders', request.url));
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
