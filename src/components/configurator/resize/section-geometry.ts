import type { ShelvingSection } from '@/lib/types/domain';
import { getMaxSectionHeight } from '@/lib/configurator/section-dimensions';
import { mmToPx, type RackEnvelopeMm } from './dimension-scale';

/* ---------------------------------------------------------------------------
   V2.3 physical front-view geometry. Every section is laid out in world
   millimetres at one uniform `pxPerMm` (see dimension-scale.ts's
   `fitPxPerMm`): its own width, its own height standing on the shared floor,
   and its own shelf planes. Nothing here reads another section's height or
   shelf count, and there is no row-level height or shelf value.
   --------------------------------------------------------------------------- */

/** The largest width, height and depth the product offers, in mm — from the
 * catalog model, never invented here. */
export interface DimensionCapacityMm {
  width: number;
  height: number;
  depth: number;
}

/**
 * The envelope the preview's scale is fitted to.
 *
 * Without `capacity` it is the configuration itself: the row's real total
 * width, its tallest section and its depth — a static drawing fills its frame.
 *
 * With `capacity` (the interactive configurator) it is the largest rack this
 * section COUNT can become: every section at the model's widest width, the
 * model's tallest height and deepest depth. No width or height drag, and no
 * commit of one, can change that envelope, so the scale — and with it the
 * pointer-to-millimetre mapping — stays fixed for the gesture and after it.
 * Only adding or removing a section (a discrete button press) refits. A
 * committed value beyond the catalog maximum still widens the envelope, so
 * the rack can never be drawn outside its frame.
 */
export function rackEnvelopeMm(sections: readonly ShelvingSection[], depthMm: number, capacity?: DimensionCapacityMm): RackEnvelopeMm {
  const rowWidth = sections.reduce((sum, s) => sum + s.width, 0);
  const height = getMaxSectionHeight(sections);
  if (!capacity) return { rowWidth, height, depth: depthMm };
  const widest = sections.reduce((max, s) => Math.max(max, s.width), capacity.width);
  return {
    rowWidth: sections.length * widest,
    height: Math.max(capacity.height, height),
    depth: Math.max(capacity.depth, depthMm),
  };
}

// A shelf's upper face (its front lip's top edge and the front corners of its
// receding top surface) is drawn SHELF_FACE_OFFSET_PX above its y. The top
// shelf's y is placed exactly that far below its section's `top`, so its
// upper face lies on the section's physical top — the same `top` that
// section's uprights and wall panels start from — and nothing protrudes above
// it. Drawing only: the configured height, the price and the BOM never read
// these coordinates. The bottom shelf keeps its clearance above the floor.
export const SHELF_FACE_OFFSET_PX = 2;
const BOTTOM_SHELF_CLEARANCE_PX = 14;

/** One section's own shelf planes, top → bottom, from ITS OWN top, height
 * and shelf count. */
export function computeShelfYs(top: number, heightPx: number, shelves: number): number[] {
  const shelfCount = Math.max(1, shelves);
  const firstY = top + SHELF_FACE_OFFSET_PX;
  const lastY = top + heightPx - BOTTOM_SHELF_CLEARANCE_PX;
  return Array.from({ length: shelfCount }, (_, i) => {
    // A single shelf is the top shelf: the uprights end flush with it too.
    const ratio = shelfCount === 1 ? 0 : i / (shelfCount - 1);
    return firstY + ratio * (lastY - firstY);
  });
}

/** One section's world geometry in viewBox units. */
export interface SectionFrame extends SectionLayout {
  /** The section's own height (section.height × pxPerMm). */
  height: number;
  /** Its own top plane: floorY − height. Its uprights end exactly here. */
  top: number;
  /** Its own shelf planes, from its own height and shelf count. */
  shelfYs: number[];
}

/**
 * Lays sections out left to right from `leftX`, contiguous, each at
 * `width × pxPerMm` wide and `height × pxPerMm` tall, all standing on
 * `floorY`. A section's x depends only on the widths before it, so changing
 * one section's width moves only the sections after it — the section itself
 * keeps its left edge, earlier sections are untouched.
 */
export function layoutSectionFrames(sections: readonly ShelvingSection[], pxPerMm: number, leftX: number, floorY: number): SectionFrame[] {
  let cursor = leftX;
  return sections.map((section) => {
    const x = cursor;
    const width = section.width * pxPerMm;
    const height = section.height * pxPerMm;
    const top = floorY - height;
    cursor += width;
    return { id: section.id, x, width, section, height, top, shelfYs: computeShelfYs(top, height, section.shelves) };
  });
}

/**
 * Proportional per-section horizontal layout, auto-fit so the row never
 * overflows `maxRowWidthPx` — the pre-V2.3 curve, kept for the top view and
 * the catalog illustration only; the front view uses `layoutSectionFrames`.
 */
export interface SectionLayout {
  id: string;
  x: number;
  width: number;
  section: ShelvingSection;
}

/** Never upscale a small row by more than this — keeps a lone narrow section
 * from being stretched into an unnaturally huge, distorted-looking block. */
const MAX_UPSCALE = 2.2;

/**
 * The auto-fit multiplier alone — factored out so a caller can compute it
 * once from a *stable* set of sections (e.g. the committed config) and reuse
 * it across renders where the widths themselves are changing (e.g. a live
 * width drag). Renormalizing this ratio from a row total that is itself
 * changing every frame is what makes a single section's on-screen size stop
 * tracking its own live value — see `layoutSectionsWithScale`.
 */
export function computeRowScale(sections: ShelvingSection[], maxRowWidthPx: number, targetFillPx?: number): number {
  const rawTotal = sections.reduce((sum, s) => sum + mmToPx('width', s.width), 0);
  if (rawTotal > maxRowWidthPx) {
    return maxRowWidthPx / rawTotal;
  }
  if (targetFillPx && rawTotal < targetFillPx) {
    return Math.min(targetFillPx / rawTotal, maxRowWidthPx / rawTotal, MAX_UPSCALE);
  }
  return 1;
}

/** Lays out sections left-to-right, centred in `viewboxW`, using an
 * already-known `scale` (see `computeRowScale`) instead of deriving one from
 * `sections` itself — this is what lets a caller hold the row's scale fixed
 * while one section's mm width is changing continuously during a drag. */
export function layoutSectionsWithScale(sections: ShelvingSection[], scale: number, viewboxW: number): SectionLayout[] {
  const widths = sections.map((s) => mmToPx('width', s.width) * scale);
  const totalWidthPx = widths.reduce((a, b) => a + b, 0);
  const startX = (viewboxW - totalWidthPx) / 2;

  let cursor = startX;
  return sections.map((section, i) => {
    const width = widths[i];
    const x = cursor;
    cursor += width;
    return { id: section.id, x, width, section };
  });
}

export function computeSectionLayout(
  sections: ShelvingSection[],
  maxRowWidthPx: number,
  viewboxW: number,
  /** When the row is narrower than this, scale it *up* to approach this
   * width instead of leaving it small — only ShelvingPreview (front view)
   * opts into this; omitting it (as TopShelvingPreview does) preserves the
   * original cap-only-when-too-wide behavior exactly. */
  targetFillPx?: number,
): SectionLayout[] {
  const scale = computeRowScale(sections, maxRowWidthPx, targetFillPx);
  return layoutSectionsWithScale(sections, scale, viewboxW);
}

/** The boundary x-coordinates between sections — used by the top view's
 * seams and the catalog illustration. (The front view draws each section's
 * own two uprights instead: V2.2B sections never share an upright.) */
export function computeBoundaryXs(layout: SectionLayout[]): number[] {
  if (layout.length === 0) return [];
  return [layout[0].x, ...layout.map((s) => s.x + s.width)];
}
