/**
 * Public-site locales and the URL scheme that carries them.
 *
 * Kazakh is the primary public language and lives at the unprefixed root
 * (`/`, `/catalog`, `/configurator` …). Russian lives under `/ru`
 * (`/ru`, `/ru/catalog` …). There is no `/kk` prefix and no English public
 * locale. The admin panel (`/admin`) and the API (`/api`) are not localized
 * routes and never get a prefix.
 *
 * This module is imported by the Edge middleware, server components and
 * client components alike, so it must stay dependency-free.
 */

export const LOCALES = ['kk', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

/** The unprefixed (root) locale. */
export const DEFAULT_LOCALE: Locale = 'kk';

/** URL prefix per locale — Kazakh has none. */
const PREFIX: Record<Locale, string> = { kk: '', ru: '/ru' };

/**
 * Explicit locale boundary for public API requests: the browser sends the
 * active page locale in this header, and customer-visible API messages are
 * rendered in it. Never inferred from message text or Accept-Language.
 */
export const LOCALE_HEADER = 'x-site-locale';

/** `<html lang>` value per locale. */
export const HTML_LANG: Record<Locale, string> = { kk: 'kk', ru: 'ru' };

/** Open Graph `og:locale` per locale. */
export const OG_LOCALE: Record<Locale, string> = { kk: 'kk_KZ', ru: 'ru_KZ' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Splits `/ru/catalog?x=1#y` into its pathname and the `?…#…` remainder. */
function splitHref(href: string): { pathname: string; rest: string } {
  const index = href.search(/[?#]/);
  return index === -1 ? { pathname: href, rest: '' } : { pathname: href.slice(0, index), rest: href.slice(index) };
}

/** True for an in-site absolute path (`/x`), false for `//host`, `https:`, `mailto:` … */
function isInternalPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/**
 * Locale-neutral path → the same page in `locale`.
 *   localizePath('/catalog', 'kk')       → '/catalog'
 *   localizePath('/catalog', 'ru')       → '/ru/catalog'
 *   localizePath('/', 'ru')              → '/ru'
 *   localizePath('/configurator?model=ms-standard', 'ru') → '/ru/configurator?model=ms-standard'
 * External URLs and non-page paths (/api, /admin) are returned unchanged.
 */
export function localizePath(href: string, locale: Locale): string {
  if (!isInternalPath(href)) return href;
  const { pathname, rest } = splitHref(href);
  if (isUnlocalizedPath(pathname)) return href;
  const prefix = PREFIX[locale];
  if (!prefix) return href;
  return `${pathname === '/' ? prefix : `${prefix}${pathname}`}${rest}`;
}

/** Paths that exist once, outside the public locale tree. */
export function isUnlocalizedPath(pathname: string): boolean {
  return /^\/(?:admin|api)(?:\/|$)/.test(pathname);
}

/**
 * A browser pathname → its locale and the locale-neutral page path.
 *   '/ru/catalog' → { locale: 'ru', path: '/catalog' }
 *   '/ru'         → { locale: 'ru', path: '/' }
 *   '/catalog'    → { locale: 'kk', path: '/catalog' }
 */
export function splitLocalePath(pathname: string): { locale: Locale; path: string } {
  if (pathname === PREFIX.ru || pathname.startsWith(`${PREFIX.ru}/`)) {
    return { locale: 'ru', path: pathname.slice(PREFIX.ru.length) || '/' };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || '/' };
}

/**
 * Query parameters that survive a language switch, per page. Everything else
 * (tracking ids, arbitrary or internal parameters) is dropped: the switcher
 * only carries state the destination page itself reads.
 *
 * `/configurator` keys mirror src/lib/configurator/url.ts (the configurator
 * share-link format, re-validated on load), `/catalog` keys are the catalog
 * filter form, `/order/success` carries the order number the page already
 * shows.
 */
export const SWITCHABLE_QUERY_KEYS: Record<string, readonly string[]> = {
  '/configurator': [
    // `v` is the share-link format version (v2: per-section height/shelves);
    // `height`/`shelves` are only read from unversioned V2.1 links.
    'v',
    'model',
    'height',
    'depth',
    'shelves',
    'sections',
    'load',
    'shelfType',
    'color',
    'assembly',
    'delivery',
    'qty',
    'acc',
    'promo',
    'metalFootPad',
    'shelfCornerBrackets',
  ],
  '/catalog': ['model', 'useCase', 'availability', 'sort'],
  '/order/success': ['number'],
};

const MAX_QUERY_VALUE_LENGTH = 500;

/** Keeps only the allow-listed, reasonably sized query parameters for `path`. */
export function safeSwitchQuery(path: string, search: string): string {
  const allowed = SWITCHABLE_QUERY_KEYS[path];
  if (!allowed || !search) return '';
  const source = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of allowed) {
    const value = source.get(key);
    if (value !== null && value.length <= MAX_QUERY_VALUE_LENGTH) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/**
 * The URL of the page currently shown at `pathname` + `search`, in `target`
 * locale — the equivalent page, never the homepage by default.
 */
export function switchLocaleHref(pathname: string, search: string, target: Locale): string {
  const { path } = splitLocalePath(pathname);
  return `${localizePath(path, target)}${safeSwitchQuery(path, search)}`;
}
