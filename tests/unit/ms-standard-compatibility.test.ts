import { describe, expect, it } from 'vitest';
import {
  getAllowedDepthsForSections,
  getAllowedDepthsForWidth,
  getAllowedHeightsForShelfCount,
  getAllowedWidthsForDepth,
  getMaxShelvesForHeight,
  isMsStandardHeight,
  isMsStandardWidth,
  isValidMsStandardConfiguration,
  isValidMsStandardWidthDepth,
  MS_STANDARD_ABSOLUTE_MAX_SHELVES,
  MS_STANDARD_DEPTHS,
  MS_STANDARD_HEIGHTS,
  MS_STANDARD_MIN_SHELVES,
  MS_STANDARD_WIDTHS,
  nearestValidMsStandardDepth,
  nearestValidMsStandardHeight,
  nearestValidMsStandardWidth,
  normalizeMsStandardConfiguration,
} from '@/lib/pricing/ms-standard-compatibility';
import type { ShelvingSection } from '@/lib/types/domain';

/**
 * Full-matrix coverage for the authoritative MS Standard compatibility
 * module — the user's supplied product matrix, expressed as parameterized
 * tests against the actual domain helpers (not UI strings, not a
 * hand-picked few cases).
 */

function section(width: number, overrides: Partial<ShelvingSection> = {}): ShelvingSection {
  return { id: `sec-${width}-${Math.random()}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
}

describe('the matrix constants', () => {
  it('exposes exactly the specified heights, widths, and depth union', () => {
    expect([...MS_STANDARD_HEIGHTS]).toEqual([1500, 1800, 2000, 2200, 2500, 3000]);
    expect([...MS_STANDARD_WIDTHS]).toEqual([700, 1000, 1200, 1500]);
    expect([...MS_STANDARD_DEPTHS]).toEqual([300, 400, 500, 600, 700, 800]);
    expect(MS_STANDARD_MIN_SHELVES).toBe(2);
    expect(MS_STANDARD_ABSOLUTE_MAX_SHELVES).toBe(8);
  });

  it('does not contain any obsolete height', () => {
    for (const obsolete of [500, 1000, 1200, 2300, 2400]) {
      expect((MS_STANDARD_HEIGHTS as readonly number[]).includes(obsolete)).toBe(false);
    }
  });
});

describe('getAllowedDepthsForWidth — exact width×depth matrix', () => {
  it('700mm: 300/400/500/600/800, NOT 700', () => {
    expect(getAllowedDepthsForWidth(700)).toEqual([300, 400, 500, 600, 800]);
  });
  it('1000mm: all six depths', () => {
    expect(getAllowedDepthsForWidth(1000)).toEqual([300, 400, 500, 600, 700, 800]);
  });
  it('1200mm: 300/400/500/600 only', () => {
    expect(getAllowedDepthsForWidth(1200)).toEqual([300, 400, 500, 600]);
  });
  it('1500mm: 300/400/500/600 only', () => {
    expect(getAllowedDepthsForWidth(1500)).toEqual([300, 400, 500, 600]);
  });
  it('an unrecognised width returns an empty array, never a guess', () => {
    expect(getAllowedDepthsForWidth(900)).toEqual([]);
  });
});

describe('getAllowedWidthsForDepth — the inverse lookup', () => {
  it.each([300, 400, 500, 600])('depth=%dmm: all four widths', (depth) => {
    expect(getAllowedWidthsForDepth(depth)).toEqual([700, 1000, 1200, 1500]);
  });
  it('depth=700mm: 1000 ONLY', () => {
    expect(getAllowedWidthsForDepth(700)).toEqual([1000]);
  });
  it('depth=800mm: 700 and 1000 only', () => {
    expect(getAllowedWidthsForDepth(800)).toEqual([700, 1000]);
  });
});

describe('isValidMsStandardWidthDepth', () => {
  it('700×600 = valid, 700×700 = INVALID, 700×800 = valid', () => {
    expect(isValidMsStandardWidthDepth(700, 600)).toBe(true);
    expect(isValidMsStandardWidthDepth(700, 700)).toBe(false);
    expect(isValidMsStandardWidthDepth(700, 800)).toBe(true);
  });
  it('1200/1500 reject 700 and 800', () => {
    for (const width of [1200, 1500]) {
      expect(isValidMsStandardWidthDepth(width, 700)).toBe(false);
      expect(isValidMsStandardWidthDepth(width, 800)).toBe(false);
    }
  });
});

describe('getAllowedDepthsForSections — multi-section intersection', () => {
  it('a single section reduces to getAllowedDepthsForWidth', () => {
    expect(getAllowedDepthsForSections([section(700)])).toEqual(getAllowedDepthsForWidth(700));
  });
  it('1000 + 1200 -> 300/400/500/600 (700/800 excluded by 1200)', () => {
    expect(getAllowedDepthsForSections([section(1000), section(1200)])).toEqual([300, 400, 500, 600]);
  });
  it('700 + 1000 -> 300/400/500/600/800 (700 excluded by the 700mm section, 800 stays)', () => {
    expect(getAllowedDepthsForSections([section(700), section(1000)])).toEqual([300, 400, 500, 600, 800]);
  });
  it('1200 + 1500 -> 300/400/500/600', () => {
    expect(getAllowedDepthsForSections([section(1200), section(1500)])).toEqual([300, 400, 500, 600]);
  });
  it('empty sections -> empty (nothing to intersect)', () => {
    expect(getAllowedDepthsForSections([])).toEqual([]);
  });
});

describe('getMaxShelvesForHeight / getAllowedHeightsForShelfCount', () => {
  it.each([1500, 1800])('height=%dmm -> max 6 shelves', (height) => {
    expect(getMaxShelvesForHeight(height)).toBe(6);
  });
  it.each([2000, 2200, 2500, 3000])('height=%dmm -> max 8 shelves', (height) => {
    expect(getMaxShelvesForHeight(height)).toBe(8);
  });
  it('an unrecognised height returns undefined, never a guessed ceiling', () => {
    expect(getMaxShelvesForHeight(2400)).toBeUndefined();
  });

  it.each([2, 3, 5, 6])('shelves=%d -> all six heights allowed', (shelves) => {
    expect(getAllowedHeightsForShelfCount(shelves)).toEqual([1500, 1800, 2000, 2200, 2500, 3000]);
  });
  it.each([7, 8])('shelves=%d -> only 2000/2200/2500/3000 (1500/1800 excluded)', (shelves) => {
    expect(getAllowedHeightsForShelfCount(shelves)).toEqual([2000, 2200, 2500, 3000]);
  });
});

describe('isMsStandardHeight / isMsStandardWidth', () => {
  it('recognises every valid value and rejects every obsolete/invalid one', () => {
    for (const h of MS_STANDARD_HEIGHTS) expect(isMsStandardHeight(h)).toBe(true);
    for (const h of [500, 1000, 1200, 2300, 2400]) expect(isMsStandardHeight(h)).toBe(false);
    for (const w of MS_STANDARD_WIDTHS) expect(isMsStandardWidth(w)).toBe(true);
    expect(isMsStandardWidth(900)).toBe(false);
  });
});

describe('isValidMsStandardConfiguration — valid combinations (task-supplied examples)', () => {
  const validCases: { height: number; depth: number; shelves: number; widths: number[] }[] = [
    { height: 1500, depth: 300, shelves: 6, widths: [700] },
    { height: 1800, depth: 800, shelves: 6, widths: [700] },
    { height: 2500, depth: 800, shelves: 8, widths: [700] },
    { height: 1500, depth: 700, shelves: 6, widths: [1000] },
    { height: 2000, depth: 800, shelves: 8, widths: [1000] },
    { height: 3000, depth: 700, shelves: 8, widths: [1000] },
    { height: 1500, depth: 600, shelves: 6, widths: [1200] },
    { height: 2500, depth: 600, shelves: 8, widths: [1200] },
    { height: 1800, depth: 600, shelves: 6, widths: [1500] },
    { height: 3000, depth: 600, shelves: 8, widths: [1500] },
    // §5 examples: height never restricts depth on its own.
    { height: 3000, depth: 800, shelves: 2, widths: [700] },
    { height: 1500, depth: 800, shelves: 2, widths: [700] },
  ];

  it.each(validCases)('$widths × $height × $depth, $shelves shelves is valid', ({ height, depth, shelves, widths }) => {
    const issues = isValidMsStandardConfiguration({ height, depth, shelves, sections: widths.map((w) => section(w)) });
    expect(issues).toEqual([]);
  });
});

describe('isValidMsStandardConfiguration — invalid combinations (task-supplied examples)', () => {
  const invalidCases: { name: string; height: number; depth: number; shelves: number; sections: ShelvingSection[] }[] = [
    { name: '700 width + 700 depth', height: 2000, depth: 700, shelves: 4, sections: [section(700)] },
    { name: '1200 width + 700 depth', height: 2000, depth: 700, shelves: 4, sections: [section(1200)] },
    { name: '1200 width + 800 depth', height: 2000, depth: 800, shelves: 4, sections: [section(1200)] },
    { name: '1500 width + 700 depth', height: 2000, depth: 700, shelves: 4, sections: [section(1500)] },
    { name: '1500 width + 800 depth', height: 2000, depth: 800, shelves: 4, sections: [section(1500)] },
    { name: '1500 height + 7 shelves', height: 1500, depth: 400, shelves: 7, sections: [section(1000)] },
    { name: '1500 height + 8 shelves', height: 1500, depth: 400, shelves: 8, sections: [section(1000)] },
    { name: '1800 height + 7 shelves', height: 1800, depth: 400, shelves: 7, sections: [section(1000)] },
    { name: '1800 height + 8 shelves', height: 1800, depth: 400, shelves: 8, sections: [section(1000)] },
    { name: 'old height 500', height: 500, depth: 400, shelves: 4, sections: [section(1000)] },
    { name: 'old height 1000', height: 1000, depth: 400, shelves: 4, sections: [section(1000)] },
    { name: 'old height 1200', height: 1200, depth: 400, shelves: 4, sections: [section(1000)] },
    { name: 'old height 2300', height: 2300, depth: 400, shelves: 4, sections: [section(1000)] },
    { name: 'old height 2400', height: 2400, depth: 400, shelves: 4, sections: [section(1000)] },
    { name: 'multi-section 1000+1200 at depth 800', height: 2000, depth: 800, shelves: 4, sections: [section(1000), section(1200)] },
    { name: 'multi-section 700+1000 at depth 700 (the 700 section rejects 700)', height: 2000, depth: 700, shelves: 4, sections: [section(700), section(1000)] },
  ];

  it.each(invalidCases)('$name is rejected', ({ height, depth, shelves, sections }) => {
    const issues = isValidMsStandardConfiguration({ height, depth, shelves, sections });
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('nearestValidMsStandardHeight', () => {
  it('an already-valid height is returned unchanged', () => {
    for (const h of MS_STANDARD_HEIGHTS) expect(nearestValidMsStandardHeight(h)).toBe(h);
  });
  it('2400 -> 2500 (closer than 2200, matches the task-supplied example exactly)', () => {
    expect(nearestValidMsStandardHeight(2400)).toBe(2500);
  });
  it('2300 -> 2200 (closer than 2500)', () => {
    expect(nearestValidMsStandardHeight(2300)).toBe(2200);
  });
  it('500 and 1000 and 1200 -> 1500 (the smallest valid height)', () => {
    expect(nearestValidMsStandardHeight(500)).toBe(1500);
    expect(nearestValidMsStandardHeight(1000)).toBe(1500);
    expect(nearestValidMsStandardHeight(1200)).toBe(1500);
  });
  it('on an exact tie, prefers the LARGER height', () => {
    expect(nearestValidMsStandardHeight(1900)).toBe(2000); // exactly between 1800 and 2000
    expect(nearestValidMsStandardHeight(2350)).toBe(2500); // exactly between 2200 and 2500
  });
});

describe('nearestValidMsStandardWidth', () => {
  it('an already-valid width is returned unchanged', () => {
    for (const w of MS_STANDARD_WIDTHS) expect(nearestValidMsStandardWidth(w)).toBe(w);
  });
  it('on an exact tie, prefers the LARGER width', () => {
    expect(nearestValidMsStandardWidth(850)).toBe(1000); // exactly between 700 and 1000
  });
});

describe('nearestValidMsStandardDepth', () => {
  it('width 1200, depth 800 -> preserves width, picks depth 600 (task-supplied example)', () => {
    expect(nearestValidMsStandardDepth(800, [section(1200)])).toBe(600);
  });
  it('width 700, depth 700 -> tie between 600 and 800, prefers the SMALLER (task-supplied example)', () => {
    expect(nearestValidMsStandardDepth(700, [section(700)])).toBe(600);
  });
  it('an already-allowed depth is returned unchanged', () => {
    expect(nearestValidMsStandardDepth(400, [section(1000)])).toBe(400);
  });
  it('returns undefined when there is nothing valid to pick from', () => {
    expect(nearestValidMsStandardDepth(400, [])).toBeUndefined();
  });
});

describe('normalizeMsStandardConfiguration — deterministic end-to-end repair', () => {
  it('old height 2400 normalizes to 2500 and clamps shelves to the new ceiling', () => {
    const result = normalizeMsStandardConfiguration({
      height: 2400,
      depth: 400,
      shelves: 8,
      sections: [section(1000)],
    });
    expect(result.height).toBe(2500);
    expect(result.shelves).toBe(8); // 2500's ceiling is 8, so 8 stays valid
  });

  it('old height 2400 normalized down to a 6-ceiling height also clamps shelves', () => {
    // Force the nearest-height result into the low-ceiling tier by asking
    // for a value that resolves to 1800 (nearest to 1900 is a tie -> 2000
    // per the tie-break, so use a value unambiguously nearest to 1800).
    const result = normalizeMsStandardConfiguration({
      height: 1700,
      depth: 400,
      shelves: 8,
      sections: [section(1000)],
    });
    expect(result.height).toBe(1800);
    expect(result.shelves).toBe(6);
  });

  it('width 1200 + depth 800 preserves width 1200, changes depth to 600', () => {
    const result = normalizeMsStandardConfiguration({
      height: 2000,
      depth: 800,
      shelves: 4,
      sections: [section(1200)],
    });
    expect(result.sections[0].width).toBe(1200);
    expect(result.depth).toBe(600);
  });

  it('width 700 + depth 700 preserves width 700, changes depth to 600 (tie-break smaller)', () => {
    const result = normalizeMsStandardConfiguration({
      height: 2000,
      depth: 700,
      shelves: 4,
      sections: [section(700)],
    });
    expect(result.sections[0].width).toBe(700);
    expect(result.depth).toBe(600);
  });

  it('multi-section 1000+1200 at depth 800 normalizes depth to the intersection (600)', () => {
    const result = normalizeMsStandardConfiguration({
      height: 2000,
      depth: 800,
      shelves: 4,
      sections: [section(1000), section(1200)],
    });
    expect(result.sections.map((s) => s.width)).toEqual([1000, 1200]);
    expect(result.depth).toBe(600);
  });

  it('an already-fully-valid configuration is returned unchanged in value', () => {
    const input = { height: 2000, depth: 400, shelves: 5, sections: [section(1000)] };
    const result = normalizeMsStandardConfiguration(input);
    expect(result.height).toBe(2000);
    expect(result.depth).toBe(400);
    expect(result.shelves).toBe(5);
    expect(result.sections[0].width).toBe(1000);
    expect(result.sections[0].id).toBe(input.sections[0].id); // section identity preserved when nothing changes
  });

  it('the result always satisfies isValidMsStandardConfiguration, across a spread of obsolete/invalid inputs', () => {
    const messyInputs = [
      { height: 2400, depth: 700, shelves: 8, sections: [section(1200)] },
      { height: 500, depth: 800, shelves: 8, sections: [section(1500)] },
      { height: 1200, depth: 300, shelves: 8, sections: [section(700), section(1500)] },
      { height: 2300, depth: 700, shelves: 6, sections: [section(700)] },
    ];
    for (const input of messyInputs) {
      const result = normalizeMsStandardConfiguration(input);
      expect(isValidMsStandardConfiguration(result), JSON.stringify({ input, result })).toEqual([]);
    }
  });
});
