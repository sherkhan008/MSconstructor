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

/* ---------------------------------------------------------------------------
   V2.3 true physical scale (front view). One uniform `pxPerMm` — viewBox
   units per millimetre — draws every section's width and height and the
   shared depth, so a 700 mm section is exactly 700/1500 as wide as a 1500 mm
   one and a 1500 mm section exactly 3/5 as tall as a 2500 mm one. The scale
   is chosen once per envelope (see `fitPxPerMm`) and never per section or
   per axis.
   --------------------------------------------------------------------------- */

/** The rack's physical extent the scale is fitted to: the front row's total
 * width, the tallest section and the shared depth, all in millimetres. */
export interface RackEnvelopeMm {
  rowWidth: number;
  height: number;
  depth: number;
}

/** viewBox room for the row plus its depth projection, horizontally… */
export const RACK_ROW_BUDGET_PX = 460;
/** …and for the tallest section plus its depth projection, vertically. The
 * height budget keeps the largest catalog rack (3000 mm + 800 mm depth) at
 * the size the preview has always drawn its tallest rack. */
export const RACK_HEIGHT_BUDGET_PX = 225;

/** A depth of `depthMm`, projected along the receding DEPTH_ANGLE_DEG
 * diagonal at the same `pxPerMm` as width and height (cavalier oblique: the
 * receding axis is not foreshortened). */
export function depthVectorPx(depthMm: number, pxPerMm: number): { dx: number; dy: number } {
  const angleRad = (DEPTH_ANGLE_DEG * Math.PI) / 180;
  const length = depthMm * pxPerMm;
  return { dx: length * Math.cos(angleRad), dy: -length * Math.sin(angleRad) };
}

/**
 * The single uniform scale at which `envelope` — row plus depth projection
 * horizontally, tallest section plus depth projection vertically — just fits
 * the rack budget. Whichever direction is tighter decides; the other simply
 * has room to spare. Proportions are never traded for fill.
 */
export function fitPxPerMm(envelope: RackEnvelopeMm): number {
  const { dx, dy } = depthVectorPx(envelope.depth, 1);
  const widthMm = envelope.rowWidth + dx;
  const heightMm = envelope.height - dy;
  if (!(widthMm > 0) || !(heightMm > 0)) return RACK_HEIGHT_BUDGET_PX / 3000;
  return Math.min(RACK_ROW_BUDGET_PX / widthMm, RACK_HEIGHT_BUDGET_PX / heightMm);
}

/* ---------------------------------------------------------------------------
   Legacy, non-physical curves. The front view and the drag math no longer use
   them (V2.3); they remain only for the top view's depth band and the
   server-rendered catalog illustration, which keep their own framing.
   --------------------------------------------------------------------------- */

/** Visual normalisation ranges of the pre-V2.3 drawing. */
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
