import type { ShelvingSection } from '@/lib/types/domain';
import type { Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { ER } from '@/lib/i18n/strings';

/**
 * The single authoritative MS Standard configuration matrix. Every place
 * that needs to know "what's a valid MS Standard configuration" — the
 * customer UI's dimension selects, width/height drag's allowed values,
 * editable-state normalization (persisted store, share links), and the
 * server's authoritative compatibility validation — imports from here.
 * There must never be a second, independently-maintained copy of these
 * rules anywhere else.
 *
 * This module is deliberately specific to the `ms-standard` model slug —
 * ms-strong and archive-ms keep using their own flat
 * ProductModel.heights/widths/depths lists (they have no cross-dimensional
 * restrictions of this kind today), so nothing here is invoked for them.
 *
 * Width, height and shelf count are per-section (V2.2A); depth is shared by
 * the whole kit (see ShelvingConfiguration). The matrix has exactly two kinds
 * of cross-dimensional rule, both evaluated for each section on its own:
 *   - depth compatibility depends on section WIDTH (never on height);
 *   - maximum shelf count depends on the section's own HEIGHT (never on
 *     depth, width, or any other section's height).
 * There is no rule between neighbouring sections' heights.
 * Nothing here invents a rule connecting height and depth directly — the
 * task this module was built for is explicit that no such rule exists.
 */

export const MS_STANDARD_HEIGHTS = [1000, 1500, 1800, 2000, 2200, 2500, 3000] as const;
export const MS_STANDARD_WIDTHS = [700, 1000, 1200, 1500] as const;
/** Union of every depth valid for at least one width — the flat
 * ProductModel.depths list. Which of these are valid for a *specific*
 * width or section combination is decided by WIDTH_DEPTH_MATRIX /
 * getAllowedDepthsForWidth / getAllowedDepthsForSections below, never by
 * this union alone. */
export const MS_STANDARD_DEPTHS = [300, 400, 500, 600, 700, 800] as const;

/** Absolute ceiling regardless of height — the per-height ceiling
 * (getMaxShelvesForHeight) is always <= this. */
export const MS_STANDARD_ABSOLUTE_MAX_SHELVES = 8;
/** The project's existing minimum shelf count — unchanged by this matrix. */
export const MS_STANDARD_MIN_SHELVES = 2;

/** Exactly which depths each section width supports. 700mm depth is
 * intentionally absent for width 700 — not an oversight (see the module
 * this was specified from). Widths 1200/1500 stop at 600mm; only 1000mm
 * supports the full depth range. */
const WIDTH_DEPTH_MATRIX: Record<(typeof MS_STANDARD_WIDTHS)[number], readonly number[]> = {
  700: [300, 400, 500, 600, 800],
  1000: [300, 400, 500, 600, 700, 800],
  1200: [300, 400, 500, 600],
  1500: [300, 400, 500, 600],
};

/** The shelf ceiling for each valid height, stated explicitly per height.
 * Deliberately NOT a formula: the ceilings are not a smooth (or even
 * monotonic-in-steps) function of height — 1000mm allows 4, 1500/1800 allow
 * 6, and everything from 2000mm up allows 8 — so a threshold expression
 * such as `height <= 1800 ? 6 : 8` would silently give 1000mm the wrong
 * ceiling. Every height in MS_STANDARD_HEIGHTS must have an entry here;
 * the Record type makes a missing one a compile error. */
const HEIGHT_MAX_SHELVES: Record<(typeof MS_STANDARD_HEIGHTS)[number], number> = {
  1000: 4,
  1500: 6,
  1800: 6,
  2000: 8,
  2200: 8,
  2500: 8,
  3000: 8,
};

export function isMsStandardWidth(width: number): width is (typeof MS_STANDARD_WIDTHS)[number] {
  return (MS_STANDARD_WIDTHS as readonly number[]).includes(width);
}

export function isMsStandardHeight(height: number): height is (typeof MS_STANDARD_HEIGHTS)[number] {
  return (MS_STANDARD_HEIGHTS as readonly number[]).includes(height);
}

/** Every depth valid for a single section width. Returns an empty array
 * for a width outside MS_STANDARD_WIDTHS — never guesses. */
export function getAllowedDepthsForWidth(width: number): number[] {
  return isMsStandardWidth(width) ? [...WIDTH_DEPTH_MATRIX[width]] : [];
}

/** Every width that supports a given depth — the inverse of
 * getAllowedDepthsForWidth. */
export function getAllowedWidthsForDepth(depth: number): number[] {
  return MS_STANDARD_WIDTHS.filter((w) => WIDTH_DEPTH_MATRIX[w].includes(depth));
}

/**
 * Depth is global to the whole row, so the depths actually offered to the
 * customer (and the only ones a server-submitted config may use) are the
 * INTERSECTION of every current section's own allowed depths — a depth
 * that only some sections support is not a valid selection for the row.
 * Returns an empty array for zero sections (nothing to intersect).
 */
export function getAllowedDepthsForSections(sections: readonly Pick<ShelvingSection, 'width'>[]): number[] {
  if (sections.length === 0) return [];
  return sections.reduce<number[]>((allowed, section, index) => {
    const depthsForThisWidth = getAllowedDepthsForWidth(section.width);
    return index === 0 ? depthsForThisWidth : allowed.filter((d) => depthsForThisWidth.includes(d));
  }, []);
}

/** The shelf-count ceiling for one height. Returns `undefined` for a
 * height outside MS_STANDARD_HEIGHTS — never guesses a ceiling for an
 * unrecognised value. */
export function getMaxShelvesForHeight(height: number): number | undefined {
  return isMsStandardHeight(height) ? HEIGHT_MAX_SHELVES[height] : undefined;
}

/** Every height whose own shelf ceiling can accommodate the given shelf
 * count (e.g. 8 shelves excludes 1500/1800, whose ceiling is 6). */
export function getAllowedHeightsForShelfCount(shelves: number): number[] {
  return MS_STANDARD_HEIGHTS.filter((h) => HEIGHT_MAX_SHELVES[h] >= shelves);
}

/** True only when this exact width/depth pair is a real MS Standard
 * combination — the single-section building block
 * isValidMsStandardConfiguration and the UI filtering helpers are all
 * built from. */
export function isValidMsStandardWidthDepth(width: number, depth: number): boolean {
  return getAllowedDepthsForWidth(width).includes(depth);
}

export interface MsStandardCompatibilityIssue {
  /** Height and shelf problems belong to a section (each section owns its
   * height/shelves), so they are reported on `sections`, like width. */
  field: 'depth' | 'sections';
  message: string;
}

type MsStandardSectionDimensions = Pick<ShelvingSection, 'width' | 'height' | 'shelves'>;

/**
 * The authoritative cross-dimensional check for one MS Standard
 * configuration. Deliberately narrow: it only ever reports the rules this
 * module owns (each section's height validity and that height's own shelf
 * ceiling, each section's width validity, and width×depth compatibility
 * against the shared depth). Anything else about a configuration (model
 * existence, load capacity, accessories, colour, ...) is
 * validateCompatibility's job, not this module's — see compatibility.ts,
 * which calls this for the ms-standard-specific rules and keeps running its
 * own checks for everything else.
 *
 * Every section is checked independently: a 1000 mm section is held to the
 * 1000 mm shelf ceiling even when its neighbour is 3000 mm tall. Identical
 * height/shelf problems shared by several sections are reported once.
 */
export function isValidMsStandardConfiguration(
  config: {
    depth: number;
    sections: readonly MsStandardSectionDimensions[];
  },
  /** Language of the customer-facing messages; the rules never depend on it. */
  locale: Locale = 'ru',
): MsStandardCompatibilityIssue[] {
  const issues: MsStandardCompatibilityIssue[] = [];

  const checkedHeightShelves = new Set<string>();
  for (const section of config.sections) {
    const key = `${section.height}:${section.shelves}`;
    if (checkedHeightShelves.has(key)) continue;
    checkedHeightShelves.add(key);

    // 1. this section's own height; 2. that height's own shelf ceiling.
    if (!isMsStandardHeight(section.height)) {
      issues.push({ field: 'sections', message: t(ER['ER-054'], locale, { H: section.height }) });
    } else {
      const maxShelves = HEIGHT_MAX_SHELVES[section.height];
      if (section.shelves > maxShelves) {
        issues.push({
          field: 'sections',
          message: t(ER['ER-055'], locale, { H: section.height, N: maxShelves }),
        });
      }
    }

    if (section.shelves < MS_STANDARD_MIN_SHELVES || section.shelves > MS_STANDARD_ABSOLUTE_MAX_SHELVES) {
      issues.push({
        field: 'sections',
        message: t(ER['ER-042'], locale, { min: MS_STANDARD_MIN_SHELVES, max: MS_STANDARD_ABSOLUTE_MAX_SHELVES }),
      });
    }
  }

  // 3. each section's width against the kit's shared depth.
  for (const section of config.sections) {
    if (!isMsStandardWidth(section.width)) {
      issues.push({ field: 'sections', message: t(ER['ER-056'], locale, { W: section.width }) });
      continue;
    }
    if (!isValidMsStandardWidthDepth(section.width, config.depth)) {
      issues.push({
        field: 'depth',
        message: t(ER['ER-057'], locale, { D: config.depth, W: section.width }),
      });
    }
  }

  return issues;
}

/**
 * Picks the nearest valid MS Standard height to an arbitrary (possibly
 * obsolete) value — used to normalize old persisted state / share links,
 * never applied to historical order records. On an exact tie, prefers the
 * LARGER height.
 */
export function nearestValidMsStandardHeight(height: number): number {
  if (isMsStandardHeight(height)) return height;
  let best: number = MS_STANDARD_HEIGHTS[0];
  let bestDistance = Math.abs(height - best);
  for (const candidate of MS_STANDARD_HEIGHTS) {
    const distance = Math.abs(height - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Picks the nearest depth that's valid for every one of `sections`, to an
 * arbitrary (possibly now-incompatible) target depth. On an exact tie,
 * prefers the SMALLER depth. Returns `undefined` only when `sections` is
 * empty or contains a width outside MS_STANDARD_WIDTHS (nothing valid to
 * pick from) — callers should treat that as "cannot normalize, fall back
 * to a safe default" rather than crash.
 */
export function nearestValidMsStandardDepth(targetDepth: number, sections: readonly Pick<ShelvingSection, 'width'>[]): number | undefined {
  const allowed = getAllowedDepthsForSections(sections);
  if (allowed.length === 0) return undefined;
  if (allowed.includes(targetDepth)) return targetDepth;

  let best = allowed[0];
  let bestDistance = Math.abs(targetDepth - best);
  for (const candidate of allowed) {
    const distance = Math.abs(targetDepth - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Picks the nearest valid MS Standard width to an arbitrary (possibly
 * invalid — e.g. a hand-crafted share link) value. On an exact tie,
 * prefers the LARGER width, matching nearestValidMsStandardHeight's
 * tie-break for consistency. In normal use this only ever fires for a
 * width that was never one of MS_STANDARD_WIDTHS at all — an
 * already-valid width that's merely incompatible with the current depth
 * is deliberately left untouched (depth adapts to width, not the reverse
 * — see normalizeMsStandardConfiguration).
 */
export function nearestValidMsStandardWidth(width: number): number {
  if (isMsStandardWidth(width)) return width;
  let best: number = MS_STANDARD_WIDTHS[0];
  let bestDistance = Math.abs(width - best);
  for (const candidate of MS_STANDARD_WIDTHS) {
    const distance = Math.abs(width - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export interface NormalizableMsStandardConfig {
  depth: number;
  sections: readonly ShelvingSection[];
}

/**
 * Repairs one section's own dimensions, using only that section's values:
 * height first (the shelf ceiling depends on it), then the shelf count
 * clamped to THAT height's ceiling, then the width (only ever touched when
 * it is not a real MS Standard width at all). Returns the same object when
 * nothing changed.
 */
export function normalizeMsStandardSection<T extends MsStandardSectionDimensions>(section: T): T {
  const height = nearestValidMsStandardHeight(section.height);
  const maxShelves = getMaxShelvesForHeight(height) ?? MS_STANDARD_ABSOLUTE_MAX_SHELVES;
  const shelves = Math.min(Math.max(section.shelves, MS_STANDARD_MIN_SHELVES), maxShelves);
  const width = isMsStandardWidth(section.width) ? section.width : nearestValidMsStandardWidth(section.width);
  if (height === section.height && shelves === section.shelves && width === section.width) return section;
  return { ...section, height, shelves, width };
}

/**
 * Deterministically repairs an arbitrary (possibly obsolete/invalid) MS
 * Standard configuration into a fully valid one — the single normalization
 * pass every editable-state entry point (persisted store hydration, share
 * links) runs a possibly-stale configuration through. Never applied to
 * historical order/snapshot records, which must keep displaying exactly
 * what was actually ordered.
 *
 * Section by section (normalizeMsStandardSection — never using another
 * section's values): height, then that height's shelf ceiling, then the
 * shelf count, then the width. Only then is the kit's shared depth
 * re-picked to fit every resulting width (width is preserved; depth is what
 * adapts).
 */
export function normalizeMsStandardConfiguration<T extends NormalizableMsStandardConfig>(config: T): T {
  const sections = config.sections.map((section) => normalizeMsStandardSection(section));
  const depth = getAllowedDepthsForSections(sections).includes(config.depth)
    ? config.depth
    : (nearestValidMsStandardDepth(config.depth, sections) ?? config.depth);

  return { ...config, depth, sections };
}

/**
 * @deprecated V2.2A transitional adapter, no longer used by the customer UI:
 * since V2.4 every section has its own height and shelf controls, whose
 * ranges come from that section alone (see src/lib/configurator/
 * section-limits.ts). Kept only for its existing unit coverage; nothing may
 * start depending on a shared range again.
 *
 * It gave the old single height select / shelf stepper (which applied one
 * value to every section at once) a range valid for every section:
 *
 *   - heights offered: those whose own ceiling fits every section's current
 *     shelf count;
 *   - shelf maximum: the lowest of the sections' own ceilings, so applying
 *     one count to all sections never breaks any section's limit.
 *
 * With uniform sections (the only state the current UI produces) both are
 * exactly the V2.1 values for the shared height/shelves.
 */
export function getAllowedHeightsForSections(sections: readonly Pick<ShelvingSection, 'shelves'>[]): number[] {
  const mostShelves = sections.reduce((max, s) => Math.max(max, s.shelves), 0);
  return getAllowedHeightsForShelfCount(mostShelves);
}

/** See getAllowedHeightsForSections. `undefined` when any section's height
 * is not a real MS Standard height (never guesses a ceiling). */
export function getSharedMaxShelvesForSections(sections: readonly Pick<ShelvingSection, 'height'>[]): number | undefined {
  if (sections.length === 0) return undefined;
  let lowest = Number.POSITIVE_INFINITY;
  for (const section of sections) {
    const ceiling = getMaxShelvesForHeight(section.height);
    if (ceiling === undefined) return undefined;
    lowest = Math.min(lowest, ceiling);
  }
  return lowest;
}
