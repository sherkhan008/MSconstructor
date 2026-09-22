import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Route props for a page under src/app/[locale]: the `[locale]` segment plus
 * any other dynamic params, and search params — the shape Next.js passes.
 */
export function localeProps<P extends Record<string, string> = Record<never, string>>(
  locale: Locale,
  params: P = {} as P,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return { params: Promise.resolve({ ...params, locale }), searchParams: Promise.resolve(searchParams) };
}

/**
 * Static markup of a rendered page (or any element) inside the locale
 * provider, exactly as src/app/[locale]/layout.tsx wraps every public page —
 * client components read the locale from it.
 *
 * The provider is imported at call time, so it is the same module instance
 * the rendered components use even in tests that call vi.resetModules().
 */
export async function renderInLocale(element: ReactNode, locale: Locale): Promise<string> {
  const { LocaleProvider } = await import('@/components/i18n/LocaleProvider');
  const Provider = LocaleProvider as ComponentType<{ locale: Locale; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Provider, { locale }, element));
}
