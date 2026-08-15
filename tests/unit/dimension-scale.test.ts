import { describe, expect, it } from 'vitest';
import {
  clamp,
  findNearestAllowed,
  maxAllowed,
  minAllowed,
  mmToPx,
  pxToMm,
  stepAllowed,
} from '@/components/configurator/resize/dimension-scale';

const HEIGHTS = [1600, 1850, 2000, 2200, 2400, 3000];
const WIDTHS = [700, 1000, 1200, 1500];
const DEPTHS = [300, 400, 500, 600];

// Mirrors src/lib/data/seed-data.ts model.heights for archive-ms, which
// deliberately excludes the top two global heights.
const ARCHIVE_HEIGHTS = [1600, 1850, 2000, 2200];

describe('findNearestAllowed', () => {
  it('returns an exact match unchanged', () => {
    expect(findNearestAllowed(1200, WIDTHS)).toBe(1200);
  });

  it('picks the nearer of two straddling values', () => {
    expect(findNearestAllowed(1050, WIDTHS)).toBe(1000); // closer to 1000 than 1200
    expect(findNearestAllowed(1150, WIDTHS)).toBe(1200); // closer to 1200 than 1000
  });

  it('breaks an exact-midpoint tie deterministically', () => {
    // Midpoint of 1000 and 1200 is 1100 — whichever side wins, repeated calls must agree.
    const result = findNearestAllowed(1100, WIDTHS);
    expect([1000, 1200]).toContain(result);
    expect(findNearestAllowed(1100, WIDTHS)).toBe(result);
  });

  it('clamps below the minimum to the smallest allowed value', () => {
    expect(findNearestAllowed(100, HEIGHTS)).toBe(1600);
    expect(findNearestAllowed(-500, DEPTHS)).toBe(300);
  });

  it('clamps above the maximum to the largest allowed value', () => {
    expect(findNearestAllowed(5000, HEIGHTS)).toBe(3000);
    expect(findNearestAllowed(999, DEPTHS)).toBe(600);
  });

  it('respects model-specific allowed dimensions instead of the global set', () => {
    // 2500mm is between the global 2400 and 3000, but archive-ms stops at 2200.
    expect(findNearestAllowed(2500, ARCHIVE_HEIGHTS)).toBe(2200);
    expect(findNearestAllowed(2500, HEIGHTS)).toBe(2400);
  });

  it('returns the input unchanged when the allowed list is empty', () => {
    expect(findNearestAllowed(1234, [])).toBe(1234);
  });
});

describe('stepAllowed (keyboard next/previous)', () => {
  it('moves to the next allowed value', () => {
    expect(stepAllowed(1000, WIDTHS, 1)).toBe(1200);
    expect(stepAllowed(700, WIDTHS, 1)).toBe(1000);
  });

  it('moves to the previous allowed value', () => {
    expect(stepAllowed(1200, WIDTHS, -1)).toBe(1000);
    expect(stepAllowed(1500, WIDTHS, -1)).toBe(1200);
  });

  it('clamps at the top end instead of overflowing', () => {
    expect(stepAllowed(1500, WIDTHS, 1)).toBe(1500);
  });

  it('clamps at the bottom end instead of underflowing', () => {
    expect(stepAllowed(700, WIDTHS, -1)).toBe(700);
  });

  it('steps from a value that is not itself an allowed member', () => {
    expect(stepAllowed(1100, WIDTHS, 1)).toBe(1200);
    expect(stepAllowed(1100, WIDTHS, -1)).toBe(1000);
  });

  it('returns the input unchanged for an empty allowed list', () => {
    expect(stepAllowed(1234, [], 1)).toBe(1234);
    expect(stepAllowed(1234, [], -1)).toBe(1234);
  });

  it('is restricted to model-specific values (archive-ms never reaches 2400 or 3000)', () => {
    expect(stepAllowed(2200, ARCHIVE_HEIGHTS, 1)).toBe(2200);
  });
});

describe('minAllowed / maxAllowed (Home/End)', () => {
  it('returns the smallest and largest allowed values', () => {
    expect(minAllowed(HEIGHTS)).toBe(1600);
    expect(maxAllowed(HEIGHTS)).toBe(3000);
  });

  it('is independent of input order', () => {
    expect(minAllowed([1200, 700, 1500, 1000])).toBe(700);
    expect(maxAllowed([1200, 700, 1500, 1000])).toBe(1500);
  });

  it('returns undefined for an empty list rather than throwing', () => {
    expect(minAllowed([])).toBeUndefined();
    expect(maxAllowed([])).toBeUndefined();
  });

  it('reflects model-specific ranges', () => {
    expect(maxAllowed(ARCHIVE_HEIGHTS)).toBe(2200);
  });
});

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('mmToPx / pxToMm', () => {
  it('round-trips within a small tolerance', () => {
    const px = mmToPx('height', 2200);
    const mm = pxToMm('height', px);
    expect(Math.abs(mm - 2200)).toBeLessThan(1);
  });

  it('clamps px output within the configured range for extreme mm input', () => {
    const pxLow = mmToPx('width', -10_000);
    const pxHigh = mmToPx('width', 10_000);
    expect(pxLow).toBeGreaterThanOrEqual(90);
    expect(pxHigh).toBeLessThanOrEqual(170);
  });
});
