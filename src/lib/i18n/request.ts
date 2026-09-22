import { LOCALE_HEADER, isLocale, type Locale } from './locales';

/**
 * The locale boundary of public JSON APIs. The browser declares the active
 * page locale explicitly in the LOCALE_HEADER request header; the server
 * renders customer-visible messages (validation, pricing, delivery errors)
 * in it. Nothing is inferred from message text or Accept-Language.
 *
 * A request without a valid header — an API client or a cached page bundle
 * from before this header existed — gets Russian, the language these APIs
 * have always answered in. Every page of this site sends the header.
 */
export const API_DEFAULT_LOCALE: Locale = 'ru';

/** JSON request headers for a public API call made from a page in `locale`. */
export function apiHeaders(locale: Locale): Record<string, string> {
  return { 'Content-Type': 'application/json', [LOCALE_HEADER]: locale };
}

/** Server side: the locale a public API request declared. */
export function requestLocale(headers: Headers): Locale {
  const value = headers.get(LOCALE_HEADER);
  return isLocale(value) ? value : API_DEFAULT_LOCALE;
}
