/**
 * Adaptive front-view depth projection: caps how far a shelf's receding top
 * surface (and its side lips, which share the same rear-plane offset) rises
 * vertically, so consecutive shelf levels never visually collide — the
 * "solid grey staircase" bug at high shelf counts / large depths. Never
 * touches the configuration's dimensions or shelf counts — this only adjusts
 * how the existing depth vector is *drawn*.
 *
 * The horizontal component is deliberately left untouched (see
 * computeRenderDepthVec): a bigger configured depth must always still read
 * as visually deeper, and that cue lives entirely in the horizontal offset,
 * not the vertical one.
 */

export interface DepthVec {
  dx: number;
  dy: number;
}

/** Front lip and side lips both extend this far (in SVG px) from the
 * shelf's own centreline toward the front/floor — see ShelvingPreview's
 * shelf-corner rendering (`c.frontLeft.y + 5`, the front-lip rect's
 * `height={5}`). Named once here so the collision math and the render code
 * can never silently drift apart. */
export const SHELF_LIP_HEIGHT_PX = 5;

/** Smallest clearly-visible background sliver we want left between two
 * consecutive shelf levels' rendered bands. ~4-7px reads as a clean gap at
 * this preview's scale without looking exaggerated; 5px is the chosen
 * default. */
export const MIN_SHELF_AIR_GAP_PX = 5;

/**
 * The smallest gap between consecutive shelf Y-positions, computed from the
 * actual rendered `shelfYs` (not re-derived from height/shelf-count
 * theoretically — `computeShelfYs` is the one source of truth for where
 * shelves really land). Returns `Infinity` when there are fewer than two
 * levels: with zero or one shelf there is nothing adjacent to collide with,
 * so no compression should ever apply.
 */
export function minShelfSpacingPx(shelfYs: readonly number[]): number {
  if (shelfYs.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 1; i < shelfYs.length; i += 1) {
    const gap = Math.abs(shelfYs[i] - shelfYs[i - 1]);
    if (gap < min) min = gap;
  }
  return min;
}

/**
 * Caps `rawDepthVec`'s vertical component so a shelf's receding top surface
 * never reaches far enough up to paint into the shelf directly above it,
 * leaving at least `minAirGapPx` of visible background between their
 * rendered bands.
 *
 * Geometry this is derived from (see ShelvingPreview's shelf-corner
 * rendering): for consecutive shelves at Y and Y+spacing, the lower
 * shelf's own visible top extends up to `spacing - SHELF_LIP_HEIGHT_PX`
 * above the upper shelf's front-lip bottom edge, once `|dy|` is added on
 * top of that. Requiring a gap `G` between them means
 * `|dy| <= spacing - SHELF_LIP_HEIGHT_PX - G` — below, `maxVerticalRise`.
 *
 * The horizontal component (`dx`) is always returned unchanged: it is the
 * customer's actual visual cue for "how deep is this rack", and reducing it
 * would make a genuinely deep configuration look shallow. Only `dy` — the
 * purely stylistic "how steep does the perspective rise" amount — is ever
 * reduced, and only exactly as much as shelf density requires.
 *
 * With fewer than two shelf levels (`minShelfSpacingPx` returns `Infinity`)
 * this is a no-op: `rawDepthVec` is returned unchanged, since there is
 * nothing adjacent to collide with.
 */
export function computeRenderDepthVec(
  rawDepthVec: DepthVec,
  shelfYs: readonly number[],
  options: { lipHeightPx?: number; minAirGapPx?: number } = {},
): DepthVec {
  const lipHeightPx = options.lipHeightPx ?? SHELF_LIP_HEIGHT_PX;
  const minAirGapPx = options.minAirGapPx ?? MIN_SHELF_AIR_GAP_PX;

  const spacing = minShelfSpacingPx(shelfYs);
  if (!Number.isFinite(spacing)) return rawDepthVec;

  // Never negative — an extremely dense configuration that can't even fit
  // the bare minimum still gets a valid (if fully flattened) vector rather
  // than an inverted/degenerate polygon.
  const maxVerticalRise = Math.max(0, spacing - lipHeightPx - minAirGapPx);

  const rawRise = Math.abs(rawDepthVec.dy);
  if (rawRise <= maxVerticalRise) return rawDepthVec;

  const sign = Math.sign(rawDepthVec.dy);
  return { dx: rawDepthVec.dx, dy: sign * maxVerticalRise };
}
