/**
 * Pure math for the drag-to-resize preview: mm <-> px scaling and
 * nearest-allowed-value snapping. No pricing or compatibility logic lives
 * here — this module only ever answers "what does N millimetres look like"
 * and "which of these discrete catalog values is N millimetres closest to".
 * The actual set of allowed values always comes from the caller (ultimately
 * from ProductModel.heights/widths/depths in the catalog), never invented
 * here.
 */

export type DimensionAxis = 'height' | 'width' | 'depth';

export interface Range {
  min: number;
  max: number;
}

/** ShelvingPreview's viewBox — kept 4:3 so it matches the preview container's
 * `aspect-[4/3]` class exactly, which lets the resize overlay be positioned
 * with plain percentages instead of a getScreenCTM() conversion. */
export const VIEWBOX_W = 640;
export const VIEWBOX_H = 480;

/** Visual normalisation ranges — mirrors the constants ShelvingPreview used
 * before drag support existed, now shared so the drag math and the static
 * render agree on the same mm-to-px curve. */
export const HEIGHT_MM_RANGE: Range = { min: 500, max: 3000 };
export const HEIGHT_PX_RANGE: Range = { min: 140, max: 320 };

/** Width is stored per-section; the total row width is sectionPx * sections. */
export const WIDTH_MM_RANGE: Range = { min: 600, max: 1600 };
export const WIDTH_PX_RANGE: Range = { min: 90, max: 170 };

/** Depth has no on-screen footprint in a front elevation — it is drawn as a
 * short receding diagonal, so its "px" is the diagonal's length. */
export const DEPTH_MM_RANGE: Range = { min: 300, max: 800 };
export const DEPTH_PX_RANGE: Range = { min: 35, max: 90 };
export const DEPTH_ANGLE_DEG = 40;

/** Top/plan view draws depth as a real rectangle dimension, not a diagonal's
 * length — a separate, wider output range sharing the same mm input domain
 * (DEPTH_MM_RANGE stays the single source of truth for "what's possible"). */
export const TOP_DEPTH_PX_RANGE: Range = { min: 70, max: 170 };
export function depthMmToTopPx(mm: number): number {
  return map(mm, DEPTH_MM_RANGE.min, DEPTH_MM_RANGE.max, TOP_DEPTH_PX_RANGE.min, TOP_DEPTH_PX_RANGE.max);
}

const RANGES: Record<DimensionAxis, { mm: Range; px: Range }> = {
  height: { mm: HEIGHT_MM_RANGE, px: HEIGHT_PX_RANGE },
  width: { mm: WIDTH_MM_RANGE, px: WIDTH_PX_RANGE },
  depth: { mm: DEPTH_MM_RANGE, px: DEPTH_PX_RANGE },
};

export function clamp(value: number, min: number, max: number): number {
  if (min > max) return value;
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation from one range to another, clamped to the output range. */
export function map(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  const ratio = (value - inMin) / (inMax - inMin);
  return clamp(outMin + ratio * (outMax - outMin), Math.min(outMin, outMax), Math.max(outMin, outMax));
}

export function mmToPx(axis: DimensionAxis, mm: number): number {
  const { mm: mmRange, px: pxRange } = RANGES[axis];
  return map(mm, mmRange.min, mmRange.max, pxRange.min, pxRange.max);
}

export function pxToMm(axis: DimensionAxis, px: number): number {
  const { mm: mmRange, px: pxRange } = RANGES[axis];
  return map(px, pxRange.min, pxRange.max, mmRange.min, mmRange.max);
}

/**
 * Finds the nearest value in `allowed` to `value`. Falls back to `value`
 * unchanged when `allowed` is empty (nothing to snap to), and never
 * produces a result outside the min/max of `allowed` otherwise.
 */
export function findNearestAllowed(value: number, allowed: readonly number[]): number {
  if (allowed.length === 0) return value;
  let nearest = allowed[0];
  let bestDelta = Math.abs(value - nearest);
  for (let i = 1; i < allowed.length; i += 1) {
    const candidate = allowed[i];
    const delta = Math.abs(value - candidate);
    if (delta < bestDelta) {
      nearest = candidate;
      bestDelta = delta;
    }
  }
  return nearest;
}

/** Sorted copy of `allowed` — snapping and keyboard stepping both need this. */
function sortedAllowed(allowed: readonly number[]): number[] {
  return [...allowed].sort((a, b) => a - b);
}

/**
 * Steps to the next/previous allowed value relative to `current` (keyboard
 * ArrowUp/ArrowRight/ArrowDown/ArrowLeft). `current` need not itself be a
 * member of `allowed` — stepping "forward" from a value between two allowed
 * entries moves to the next one above it.
 */
export function stepAllowed(current: number, allowed: readonly number[], direction: 1 | -1): number {
  const sorted = sortedAllowed(allowed);
  if (sorted.length === 0) return current;

  if (direction === 1) {
    const next = sorted.find((v) => v > current);
    return next ?? sorted[sorted.length - 1];
  }
  const prev = [...sorted].reverse().find((v) => v < current);
  return prev ?? sorted[0];
}

export function minAllowed(allowed: readonly number[]): number | undefined {
  return sortedAllowed(allowed)[0];
}

export function maxAllowed(allowed: readonly number[]): number | undefined {
  const sorted = sortedAllowed(allowed);
  return sorted[sorted.length - 1];
}

const AXIS_LABEL_RU: Record<DimensionAxis, string> = {
  height: 'высоту',
  width: 'ширину',
  depth: 'глубину',
};

export function axisAccusativeRu(axis: DimensionAxis): string {
  return AXIS_LABEL_RU[axis];
}
