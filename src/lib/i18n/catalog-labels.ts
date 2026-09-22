import type { DimensionOption, LoadCapacityOption } from '@/lib/types/domain';
import type { Locale } from './locales';
import { t, type Entry } from './format';
import { CF } from './strings';

/**
 * Option labels of the configurator selects. The catalog's `label` columns
 * (HeightOption/WidthOption/DepthOption/LoadCapacityOption.label) are
 * Russian-only strings; Russian pages keep showing them unchanged, Kazakh
 * pages render the owner-reviewed CSV text for the same value.
 */

/** "2000 мм" (CF-073). */
export function dimensionOptionLabel(option: Pick<DimensionOption, 'value' | 'label'>, locale: Locale): string {
  return locale === 'ru' ? option.label : t(CF['CF-073'], locale, { N: option.value });
}

/** Kazakh load labels by capacity (kg per shelf) — CF-074, CF-075. */
const KAZAKH_LOAD_LABEL: Record<number, Entry> = {
  100: CF['CF-074'],
  150: CF['CF-075'],
};

/**
 * "150 кг на полку" / "Сөреге 150 кг". A capacity without a reviewed Kazakh
 * label (none is offered by a public model today) falls back to the catalog
 * label rather than to invented text.
 */
export function loadCapacityOptionLabel(option: Pick<LoadCapacityOption, 'value' | 'label'>, locale: Locale): string {
  if (locale === 'ru') return option.label;
  const entry = KAZAKH_LOAD_LABEL[option.value];
  return entry ? t(entry, locale) : option.label;
}
