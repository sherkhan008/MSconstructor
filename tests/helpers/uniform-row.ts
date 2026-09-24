import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/** A section that may leave its height/shelves to the row default. */
export type LooseSection = Omit<ShelvingSection, 'height' | 'shelves'> & Partial<Pick<ShelvingSection, 'height' | 'shelves'>>;

/** A uniform row described with one height/shelf count for every section. */
export type UniformRowInput = Omit<ShelvingConfiguration, 'sections'> & {
  height: number;
  shelves: number;
  sections: LooseSection[];
};

/**
 * Test helper. Most pricing/UI tests describe a UNIFORM row (every section
 * the same height and shelf count — the only kind V2.2A prices). This lets
 * them keep stating that one height/shelf count, and returns the real V2.2A
 * domain shape: the value copied into every section that does not set its
 * own, and no row-level height/shelves left on the configuration.
 */
export function uniformRow({ height, shelves, sections, ...rest }: UniformRowInput): ShelvingConfiguration {
  return { ...rest, sections: sections.map((section) => ({ height, shelves, ...section }) as ShelvingSection) };
}
