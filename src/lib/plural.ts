import type { Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { G } from '@/lib/i18n/strings';
import type { ShelvingSection } from '@/lib/types/domain';
import { getUniformSectionShelves } from '@/lib/configurator/section-dimensions';

/**
 * Shelf count as customer-facing text. Shelf counts appear in several places
 * (catalog cards, cart lines), so the rule lives here once instead of a
 * hardcoded "полок" next to every number.
 *
 *   ru — Russian count agreement: 1 полка, 2–4 полки, 5–20 полок, 21 полка…
 *        (the three forms of CSV G-011, "{N} полка / {N} полки / {N} полок")
 *   kk — Kazakh does not inflect a noun after a numeral: "{N} сөре" for every
 *        N (CSV G-011). Russian plural rules are never applied to Kazakh.
 */
export function shelvesLabel(count: number, locale: Locale = 'ru'): string {
  if (locale === 'kk') return t(G['G-011'], 'kk', { N: count });

  const [one, few, many] = G['G-011'].ru.split(' / ');
  const abs = Math.abs(count) % 100;
  const last = abs % 10;

  let form = many;
  if (abs > 10 && abs < 20) form = many;
  else if (last === 1) form = one;
  else if (last >= 2 && last <= 4) form = few;
  return form.replace('{N}', String(count));
}

/**
 * A kit's shelf count as customer-facing text. Every section owns its own
 * shelf count: when all sections agree this is shelvesLabel of that one
 * count ("5 полок"); otherwise each section's own count in row order
 * ("4 полки / 6 полок").
 */
export function sectionShelvesLabel(sections: readonly Pick<ShelvingSection, 'shelves'>[], locale: Locale = 'ru'): string {
  const uniform = getUniformSectionShelves(sections);
  if (uniform !== undefined) return shelvesLabel(uniform, locale);
  return sections.map((s) => shelvesLabel(s.shelves, locale)).join(' / ');
}
