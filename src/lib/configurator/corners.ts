import type { SectionCorner, ShelvingSection } from '@/lib/types/domain';

/**
 * Corner placement rules (Configurator V2.6) — the single source shared by
 * the server-side schema (src/lib/pricing/schema.ts, the authority), the
 * configurator store, the persisted-state readers, the share-link parser and
 * the section UI.
 *
 *   - LEFT only on the first section, RIGHT only on the last one;
 *   - a middle section is always straight;
 *   - at most MAX_CORNERS corners (LEFT and RIGHT may both exist);
 *   - a single section is both first and last, so it may be LEFT or RIGHT
 *     (never both — one section has one orientation).
 *
 * The section-count limit is independent and unchanged (limits.ts).
 */

export const SECTION_CORNERS = ['NONE', 'LEFT', 'RIGHT'] as const satisfies readonly SectionCorner[];

export const MAX_CORNERS = 2;

export function isSectionCorner(value: unknown): value is SectionCorner {
  return typeof value === 'string' && (SECTION_CORNERS as readonly string[]).includes(value);
}

/** The orientations a section at `index` of a `count`-section row may take. */
export function allowedCornersAt(index: number, count: number): SectionCorner[] {
  const first = index === 0;
  const last = index === count - 1;
  const allowed: SectionCorner[] = ['NONE'];
  if (first) allowed.push('LEFT');
  if (last) allowed.push('RIGHT');
  return allowed;
}

export type CornerIssue = 'LEFT_NOT_FIRST' | 'RIGHT_NOT_LAST' | 'TOO_MANY_CORNERS';

/** Every way `sections` breaks the placement rules; empty when valid. */
export function findCornerIssues(sections: readonly Pick<ShelvingSection, 'corner'>[]): CornerIssue[] {
  const issues = new Set<CornerIssue>();
  sections.forEach((section, index) => {
    if (section.corner === 'LEFT' && index !== 0) issues.add('LEFT_NOT_FIRST');
    if (section.corner === 'RIGHT' && index !== sections.length - 1) issues.add('RIGHT_NOT_LAST');
  });
  if (countCorners(sections) > MAX_CORNERS) issues.add('TOO_MANY_CORNERS');
  return [...issues];
}

export function areSectionCornersValid(sections: readonly Pick<ShelvingSection, 'corner'>[]): boolean {
  return findCornerIssues(sections).length === 0;
}

export function countCorners(sections: readonly Pick<ShelvingSection, 'corner'>[]): number {
  return sections.filter((s) => s.corner !== 'NONE').length;
}

export function hasCorners(sections: readonly Pick<ShelvingSection, 'corner'>[]): boolean {
  return sections.some((s) => s.corner !== 'NONE');
}
