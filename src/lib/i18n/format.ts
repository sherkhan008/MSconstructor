import type { Locale } from './locales';

/** One owner-reviewed CSV row as generated into src/lib/i18n/strings. */
export interface Entry {
  readonly ru: string;
  readonly kk: string;
}

/**
 * CSV placeholders are written in each language's own words and not always
 * in the same order ("{H} … «{модель}»" vs "«{Модель}» … {H}"). Callers pass
 * values under one canonical key; this map resolves both spellings to it, so
 * the CSV text stays byte for byte what the owner approved.
 */
export const PLACEHOLDER_KEYS: Readonly<Record<string, string>> = {
  N: 'N',
  W: 'W',
  H: 'H',
  D: 'D',
  V: 'V',
  P: 'P',
  min: 'min',
  max: 'max',
  url: 'url',
  email: 'email',
  номер: 'number',
  компания: 'company',
  цена: 'price',
  баға: 'price',
  модель: 'model',
  Модель: 'model',
  высота: 'height',
  биіктік: 'height',
  ширины: 'width',
  ені: 'width',
  глубина: 'depth',
  тереңдік: 'depth',
  вес: 'weight',
  салмақ: 'weight',
  перечень: 'list',
  тізім: 'list',
  сумма: 'amount',
  сома: 'amount',
  адрес: 'address',
  мекенжай: 'address',
  причина: 'reason',
  себеп: 'reason',
  код: 'code',
  Код: 'code',
  аксессуар: 'accessory',
  Аксессуар: 'accessory',
  бренд: 'brand',
  Бренд: 'brand',
};

export type Vars = Readonly<Record<string, string | number>>;

/**
 * The entry's text in `locale`, with `{placeholder}`s filled from `vars`
 * (canonical keys, see PLACEHOLDER_KEYS). A placeholder without a value is
 * left as written rather than silently dropped.
 */
export function t(entry: Entry, locale: Locale, vars?: Vars): string {
  const text = entry[locale];
  if (!vars) return text;
  return text.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const key = PLACEHOLDER_KEYS[name] ?? name;
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

/**
 * Catalog data (Prisma *Kk columns → LocalizedText) in `locale`.
 *
 * Fallback is explicit and one-way: a Kazakh page shows the Russian value only
 * when the Kazakh one is missing or blank (e.g. a catalog row added in the
 * admin/database without a Kazakh translation yet). A Russian page never
 * falls back to Kazakh.
 */
export function pick(text: { ru: string; kk?: string | null }, locale: Locale): string {
  if (locale === 'kk' && text.kk && text.kk.trim() !== '') return text.kk;
  return text.ru;
}
