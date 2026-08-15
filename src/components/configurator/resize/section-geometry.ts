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
  const rawWidths = sections.map((s) => mmToPx('width', s.width));
  const rawTotal = rawWidths.reduce((a, b) => a + b, 0);
  let scale = 1;
  if (rawTotal > maxRowWidthPx) {
    scale = maxRowWidthPx / rawTotal;
  } else if (targetFillPx && rawTotal < targetFillPx) {
    scale = Math.min(targetFillPx / rawTotal, maxRowWidthPx / rawTotal, MAX_UPSCALE);
  }
  const widths = rawWidths.map((w) => w * scale);
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

/** N sections share N+1 upright/post positions — the boundary x-coordinates. */
export function computeBoundaryXs(layout: SectionLayout[]): number[] {
  if (layout.length === 0) return [];
  return [layout[0].x, ...layout.map((s) => s.x + s.width)];
}
