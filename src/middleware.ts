import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';
import { DEFAULT_LOCALE, LOCALES, localizePath, type Locale } from '@/lib/i18n/locales';

/**
 * Single centralized enforcement point for /admin/* route protection
 * (spec: "do not scatter checks"). Runs on the Edge runtime, so session
 * verification here only ever does an HMAC check (see src/lib/auth/session.ts)
 * — never a database lookup, never Node's `crypto` module. Every admin page
 * and mutation API route also re-checks the session itself server-side
 * (src/lib/auth/current-admin.ts) — this redirect is a fast first line of
 * defense, not the only one.
 */
async function adminMiddleware(request: NextRequest) {
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

/** Page aliases: the checkout page is /order; /checkout is accepted as a name for it. */
const PATH_ALIASES: Record<string, string> = { '/checkout': '/order' };

function redirectTo(request: NextRequest, path: string) {
  const url = request.nextUrl.clone();
  url.pathname = path.split('?')[0];
  return NextResponse.redirect(url, 308);
}

/**
 * Public locale routing (see src/lib/i18n/locales.ts):
 *   /catalog        → rewritten internally to /kk/catalog (Kazakh, URL unchanged)
 *   /ru/catalog     → served as is (Russian)
 *   /kk, /kk/…      → 308 to the unprefixed URL: Kazakh has exactly one
 *                     indexable address, the root one
 *   /ru/ru/…, /ru/kk/…, /kk/ru/… → 308 to a single prefix; the FIRST locale
 *                     segment decides the language. Every redirect target
 *                     has at most one prefix, so no redirect loops.
 */
function localeMiddleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean);

  const leading: Locale[] = [];
  while (segments.length > 0 && (LOCALES as readonly string[]).includes(segments[0])) {
    leading.push(segments.shift() as Locale);
  }

  const locale: Locale = leading[0] ?? DEFAULT_LOCALE;
  const rest = `/${segments.join('/')}`;
  const page = PATH_ALIASES[rest] ?? rest;
  const canonicalPath = localizePath(page, locale);

  const alreadyCanonical = (locale === 'ru' ? leading.length === 1 : leading.length === 0) && page === rest;
  if (!alreadyCanonical) return redirectTo(request, canonicalPath);

  if (locale === 'ru') return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return adminMiddleware(request);
  return localeMiddleware(request);
}

export const config = {
  // Everything except API routes, Next internals and files with an extension
  // (static assets, /sitemap.xml, /robots.txt).
  matcher: ['/((?!api/|api$|_next/|.*\\..*).*)'],
};
