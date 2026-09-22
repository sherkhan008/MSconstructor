'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_LOCALE, localizePath, type Locale } from '@/lib/i18n/locales';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Carries the page locale (from the `[locale]` route segment, resolved on the
 * server) to client components. Server components read it from route params
 * directly and never need this.
 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** `href('/cart')` → '/cart' on Kazakh pages, '/ru/cart' on Russian ones. */
export function useLocalizedHref(): (path: string) => string {
  const locale = useLocale();
  return (path: string) => localizePath(path, locale);
}
