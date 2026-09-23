'use client';

import { useMemo } from 'react';
import type { ColorOption, ShelvingConfiguration } from '@/lib/types/domain';
import { VIEWBOX_W, depthMmToTopPx } from './resize/dimension-scale';
import { computeSectionLayout, computeBoundaryXs } from './resize/section-geometry';
import {
  CROP_LEFT,
  framedCropWidth,
  DimensionTag,
  DRAW_INK,
  DRAW_INK_SOFT,
  DRAW_LINE,
  MAX_ROW_WIDTH_PX,
  RACK_LEFT_MARGIN,
  SectionWidthLabel,
  TARGET_FILL_PX,
  WIDE_FRAME,
} from './ShelvingPreview';
import { resolveRackFill } from './rack-colors';
import { t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Plan/top view — a bird's-eye footprint of the current shelving row,
 * following the same reference used for the front view. Reuses the exact
 * same per-section x-layout as ShelvingPreview (computeSectionLayout with
 * the front view's own MAX_ROW_WIDTH_PX/TARGET_FILL_PX, then the same
 * RACK_LEFT_MARGIN anchor) so every section sits at the identical x in both
 * modes and switching view never makes the row jump or change size;
 * horizontal axis is section width, vertical axis is the global depth.
 *
 * Framing matches the front view too: the same CROP_LEFT/CROP_MIN_W window
 * of the shared 640-wide coordinate space, at the same 4:3 ratio the
 * workspace frame uses, so dimension text renders at the same size in both
 * views. Framing only — no geometry, selection or configuration semantics
 * change here.
 *
 * View/select only for this iteration — no drag here. Section selection is
 * wired straight to the same `activeSectionId`/`onSelectSection` the front
 * view and the section table already share; there is no separate top-view
 * selection state.
 */

const TOP_Y = 26;
/** Distance from the footprint's front edge down to the total-width line.
 * Wide enough that the per-section values sit clearly between the two rather
 * than crowding the line. */
const TOTAL_LINE_Y_OFFSET = 34;
/** Section seams and the footprint's own edges. A step darker than the rack
 * fill so each section reads as a separate bay, a step lighter than the
 * graphite perimeter so the outline still leads. */
const SEAM = 'var(--color-steel-soft)';

interface Props {
  config: ShelvingConfiguration;
  color?: ColorOption;
  className?: string;
  interactive?: boolean;
  activeSectionId?: string;
  onSelectSection?: (id: string) => void;
}

export function TopShelvingPreview({ config, color, className = '', interactive = false, activeSectionId, onSelectSection }: Props) {
  const locale = useLocale();
  const layout = useMemo(() => {
    const centered = computeSectionLayout(config.sections, MAX_ROW_WIDTH_PX, VIEWBOX_W, TARGET_FILL_PX);
    const shift = RACK_LEFT_MARGIN - centered[0].x;
    return centered.map((s) => ({ ...s, x: s.x + shift }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.sections.map((s) => s.width))]);
  const boundaryXs = useMemo(() => computeBoundaryXs(layout), [layout]);
  const depthPx = depthMmToTopPx(config.depth);
  const bottom = TOP_Y + depthPx;
  const contentBottom = bottom + TOTAL_LINE_Y_OFFSET + 22;
  // Exactly the front view's crop: same window width for the same section
  // count, same 4:3 ratio as the workspace frame. The drawing is a shallow
  // band, so centre it in that window rather than letting it sit against the
  // top edge.
  const cropW = framedCropWidth(WIDE_FRAME, config.sections.length);
  const cropH = (cropW * 3) / 4;
  const cropY = (TOP_Y + contentBottom) / 2 - cropH / 2;

  // Same resolved fill as the front view (see rack-colors.ts) so the two
  // preview modes never disagree on what color the rack is.
  const fill = resolveRackFill(color);
  const rowStart = layout[0].x;
  const rowEnd = layout[layout.length - 1].x + layout[layout.length - 1].width;
  const totalLengthMm = config.sections.reduce((sum, s) => sum + s.width, 0);
  // Same rule as the front view: a lone section has nothing to disambiguate,
  // so it is never decorated with a selection mark.
  const markActive = interactive && layout.length > 1;

  return (
    <div className={`relative w-full overflow-hidden border border-line bg-surface ${className}`}>
      <svg viewBox={`${CROP_LEFT} ${cropY} ${cropW} ${cropH}`} className="h-full w-full" role="img" aria-label={t(CF['CF-007'], locale)}>
        {layout.map((section, i) => {
          const isActive = section.id === activeSectionId;
          return (
            <g
              key={section.id}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? t(CF['CF-008'], locale, { N: i + 1, W: section.section.width }) : undefined}
              aria-pressed={interactive ? isActive : undefined}
              onClick={interactive ? () => onSelectSection?.(section.id) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectSection?.(section.id);
                      }
                    }
                  : undefined
              }
              className={interactive ? 'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blueprint' : undefined}
              style={interactive ? { cursor: 'pointer' } : undefined}
            >
              <rect x={section.x} y={TOP_Y} width={section.width} height={depthPx} fill={fill} stroke={SEAM} strokeWidth={0.75} />
            </g>
          );
        })}

        {/* Shared-boundary posts, same idea as the front view's front posts —
             same resolved fill, not an unrelated color, now with a seam-weight
             edge so the division between two bays is actually legible. */}
        {boundaryXs.map((x, i) => (
          <rect key={i} x={x - 2.5} y={TOP_Y} width={5} height={depthPx} fill={fill} stroke={SEAM} strokeWidth={0.75} />
        ))}

        {/* Outer perimeter — one graphite-steel hairline around the whole
             footprint. This is what separates the rack from the white canvas
             and stops the plan reading as a flat grey block; the seams above
             stay lighter so the outline leads and the bays sit inside it. */}
        <rect
          x={rowStart}
          y={TOP_Y}
          width={rowEnd - rowStart}
          height={depthPx}
          fill="none"
          stroke={DRAW_INK_SOFT}
          strokeWidth={1}
          pointerEvents="none"
        />

        {/* Selected section — a graphite outline on the bay's own footprint
             edges, painted last so it leads over both the seams and the
             perimeter. Drawn on the edges rather than outside them (as the
             front view does, where it has to clear the posts and feet) so an
             end bay never shows a doubled line against the perimeter. Never a
             colour flood: the section's own width value below also switches
             to graphite/semibold, and aria-pressed carries the state. */}
        {markActive &&
          layout
            .filter((section) => section.id === activeSectionId)
            .map((section) => (
              <rect
                key={`selected-${section.id}`}
                x={section.x}
                y={TOP_Y}
                width={section.width}
                height={depthPx}
                fill="none"
                stroke={DRAW_INK}
                strokeWidth={1.5}
                pointerEvents="none"
              />
            ))}

        {/* Per-section width labels, under each footprint. */}
        {layout.map((section) => (
          <SectionWidthLabel
            key={section.id}
            x={section.x + section.width / 2}
            y={bottom + 15}
            label={section.section.width}
            active={markActive && section.id === activeSectionId}
          />
        ))}

        {/* Total width — the same steel hairline + neutral value tag as the
             front view's own total dimension. */}
        <g pointerEvents="none">
          <line x1={rowStart} y1={bottom + TOTAL_LINE_Y_OFFSET} x2={rowEnd} y2={bottom + TOTAL_LINE_Y_OFFSET} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={rowStart} y1={bottom + TOTAL_LINE_Y_OFFSET - 3.5} x2={rowStart} y2={bottom + TOTAL_LINE_Y_OFFSET + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={rowEnd} y1={bottom + TOTAL_LINE_Y_OFFSET - 3.5} x2={rowEnd} y2={bottom + TOTAL_LINE_Y_OFFSET + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
          <DimensionTag
            x={(rowStart + rowEnd) / 2}
            y={bottom + TOTAL_LINE_Y_OFFSET + 14}
            label={t(CF['CF-023'], locale, { N: Math.round(totalLengthMm) })}
            active={false}
            orientation="horizontal"
          />
        </g>

        {/* Depth, measured down the row's right edge. */}
        <g pointerEvents="none">
          <line x1={rowEnd + 22} y1={TOP_Y} x2={rowEnd + 22} y2={bottom} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={rowEnd + 18.5} y1={TOP_Y} x2={rowEnd + 25.5} y2={TOP_Y} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={rowEnd + 18.5} y1={bottom} x2={rowEnd + 25.5} y2={bottom} stroke={DRAW_LINE} strokeWidth={0.75} />
          <DimensionTag x={rowEnd + 22} y={(TOP_Y + bottom) / 2} label={`${config.depth}`} active={false} orientation="vertical" />
        </g>
      </svg>
    </div>
  );
}
