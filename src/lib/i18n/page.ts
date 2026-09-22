import { notFound } from 'next/navigation';
import { isLocale, type Locale } from './locales';

/** Route params of every page under src/app/[locale]. */
export type LocaleParams = Promise<{ locale: string }>;

/** The page locale from route params; anything else is a 404. */
export async function resolveLocale(params: LocaleParams): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
