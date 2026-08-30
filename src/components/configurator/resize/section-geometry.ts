import type { ShelvingSection } from '@/lib/types/domain';
import { mmToPx } from './dimension-scale';

/**
 * Proportional per-section horizontal layout, auto-fit so the row never
 * overflows `maxRowWidthPx`. Pure function of section widths only — shared by
 * both ShelvingPreview (front view) and TopShelvingPreview (plan view) so the
 * two views always agree on where each section sits along the x-axis and
 * section-width math never needs to be duplicated.
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

/** N sections share N+1 upright/post positions — the boundary x-coordinates. */
export function computeBoundaryXs(layout: SectionLayout[]): number[] {
  if (layout.length === 0) return [];
  return [layout[0].x, ...layout.map((s) => s.x + s.width)];
}

/**
 * Applies a live width-drag to one committed layout, the same way height
 * drag already behaves (one fixed anchor, only the dragged edge moves):
 * sections before the active one are untouched, the active section keeps
 * its own left edge fixed and only its width changes, and sections after it
 * translate by the resulting width delta so the row stays contiguous — no
 * gaps, no overlap, and no other section's own pixel width is touched.
 *
 * `liveActiveWidthPx` must already be computed with the *live* auto-fit
 * scale for what the row would be if committed right now (see
 * ShelvingPreview, which derives it from `computeRowScale` applied to the
 * live section widths) — not the scale frozen from whatever the row looked
 * like when the drag started. `computeRowScale`'s auto-fit is a function of
 * the row's total width, so a scale frozen at drag-start does not
 * necessarily match the scale a release will actually render with; using
 * the live scale for this one width is what makes a value pixel-match
 * between "still being dragged" and "just committed".
 */
export function applyLiveActiveWidth(committedLayout: SectionLayout[], activeSectionId: string, liveActiveWidthPx: number): SectionLayout[] {
  const activeIndex = committedLayout.findIndex((s) => s.id === activeSectionId);
  if (activeIndex === -1) return committedLayout;
  const deltaPx = liveActiveWidthPx - committedLayout[activeIndex].width;
  return committedLayout.map((s, i) => {
    if (i < activeIndex) return s;
    if (i === activeIndex) return { ...s, width: liveActiveWidthPx };
    return { ...s, x: s.x + deltaPx };
  });
}
