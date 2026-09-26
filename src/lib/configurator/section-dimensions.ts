import type { ShelvingSection } from '@/lib/types/domain';

/**
 * Readers for the per-section height and shelf count (Configurator V2.2A).
 * Every section owns its own `height` and `shelves`; there is no row-level
 * value. Anything that needs a kit-level reading goes through one of these
 * helpers, each with an explicit meaning — never an arbitrary `sections[0]`.
 *
 *   uniform…   the one value every section shares, or `undefined` when they
 *              differ (summaries only; no control edits every section at
 *              once since V2.4, and pricing never needs it — V2.2B prices
 *              every section from its own BOM);
 *   max…       the tallest section / most shelves — the row's overall
 *              envelope (e.g. the overall В×Ш×Г, the preview frame);
 *   …Summary   a display string that states one value when all sections
 *              agree and every section's own value, in row order, when they
 *              do not ("1500 / 2500 / 1000").
 */

type SectionDimensions = Pick<ShelvingSection, 'height' | 'shelves'>;
type SectionHeight = Pick<ShelvingSection, 'height'>;
type SectionShelves = Pick<ShelvingSection, 'shelves'>;

function uniformValue(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const [first] = values;
  return values.every((value) => value === first) ? first : undefined;
}

/** The height every section shares, or `undefined` when they differ. */
export function getUniformSectionHeight(sections: readonly SectionHeight[]): number | undefined {
  return uniformValue(sections.map((s) => s.height));
}

/** The shelf count every section shares, or `undefined` when they differ. */
export function getUniformSectionShelves(sections: readonly SectionShelves[]): number | undefined {
  return uniformValue(sections.map((s) => s.shelves));
}

/** True when every section has the same height AND the same shelf count. */
export function hasUniformSectionDimensions(sections: readonly SectionDimensions[]): boolean {
  return getUniformSectionHeight(sections) !== undefined && getUniformSectionShelves(sections) !== undefined;
}

/** The tallest section's height (the row's overall height); 0 for no sections. */
export function getMaxSectionHeight(sections: readonly SectionHeight[]): number {
  return sections.reduce((max, s) => Math.max(max, s.height), 0);
}

/** The largest shelf count of any section; 0 for no sections. */
export function getMaxSectionShelves(sections: readonly SectionShelves[]): number {
  return sections.reduce((max, s) => Math.max(max, s.shelves), 0);
}

/** Total shelves across the whole row — each section counts its own. */
export function getTotalSectionShelves(sections: readonly SectionShelves[]): number {
  return sections.reduce((sum, s) => sum + s.shelves, 0);
}

function summarize(values: readonly number[]): string {
  const uniform = uniformValue(values);
  return uniform !== undefined ? String(uniform) : values.join(' / ');
}

/** "1000" when every section is 1000 mm wide, else "1000 / 1200". */
export function sectionWidthsSummary(sections: readonly Pick<ShelvingSection, 'width'>[]): string {
  return summarize(sections.map((s) => s.width));
}

/** "2000" when every section is 2000 mm tall, else "1500 / 2500 / 1000". */
export function sectionHeightsSummary(sections: readonly SectionHeight[]): string {
  return summarize(sections.map((s) => s.height));
}

/** "5" when every section has 5 shelves, else "4 / 6 / 3". */
export function sectionShelvesSummary(sections: readonly SectionShelves[]): string {
  return summarize(sections.map((s) => s.shelves));
}
