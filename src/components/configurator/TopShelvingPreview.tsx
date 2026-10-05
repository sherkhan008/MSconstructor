'use client';

import { useMemo, type KeyboardEvent } from 'react';
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
  POST_WIDTH,
  RACK_LEFT_MARGIN,
  SectionWidthLabel,
  TARGET_FILL_PX,
  WIDE_FRAME,
} from './ShelvingPreview';
import { resolveRackFill } from './rack-colors';
import { hasCorners } from '@/lib/configurator/corners';
import { getRackFootprintMm, layoutRackWorld, toWorld } from '@/lib/configurator/rack-world';
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
 *
 * Corners (2026-10-01). The straight plan above draws every section as one
 * straight row, which is false for a corner section (its width runs
 * backward). A kit with a corner is therefore drawn by `CornerTopView`
 * instead: the rack's own world plan (rack-world.ts's `layoutRackWorld`, the
 * same placement the front view, the BOM-free geometry tests and the server
 * schema rely on) seen from above at one uniform millimetre scale — every
 * section's real footprint, nothing invented, nothing redesigned.
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

export function TopShelvingPreview(props: Props) {
  return hasCorners(props.config.sections) ? <CornerTopView {...props} /> : <StraightTopView {...props} />;
}

function StraightTopView({ config, color, className = '', interactive = false, activeSectionId, onSelectSection }: Props) {
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
              {...selectableSectionProps(interactive, t(CF['CF-008'], locale, { N: i + 1, W: section.section.width }), isActive, () =>
                onSelectSection?.(section.id),
              )}
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

/** A section footprint's selection behaviour, shared by both plans: the same
 * `onSelectSection` the front view and the section controls use, by pointer
 * or keyboard. Nothing at all when the plan is not interactive. */
function selectableSectionProps(interactive: boolean, label: string, active: boolean, onSelect: () => void) {
  if (!interactive) return {};
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': active,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    },
    className: 'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blueprint',
    style: { cursor: 'pointer' },
  } as const;
}

/** The corner plan's room for the rack: its front-line length and its reach
 * backward, in viewBox units — the straight plan's own row ceiling and a
 * depth budget. One uniform scale fits whichever is tighter, so the plan
 * keeps the rack's true proportions. */
const CORNER_PLAN_W = MAX_ROW_WIDTH_PX;
const CORNER_PLAN_D = 200;
/** Room for a vertical dimension (its line 22 units out, plus its rotated
 * tag) on a side that has one, and the plain margin on a side that has none. */
const SIDE_DIMENSION_MARGIN = 38;
const SIDE_PLAIN_MARGIN = 14;
const PLAN_TOP_MARGIN = 12;
/** Below the front line: section widths, the total line and its tag. */
const PLAN_BOTTOM_MARGIN = TOTAL_LINE_Y_OFFSET + 26;

/** One vertical dimension at `x` from `y1` to `y2` — hairline, end ticks and
 * its value: the straight plan's depth dimension, reused. */
function VerticalDimension({ x, y1, y2, label, testId }: { x: number; y1: number; y2: number; label: string; testId: string }) {
  return (
    <g pointerEvents="none" data-testid={testId}>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={DRAW_LINE} strokeWidth={0.75} />
      <line x1={x - 3.5} y1={y1} x2={x + 3.5} y2={y1} stroke={DRAW_LINE} strokeWidth={0.75} />
      <line x1={x - 3.5} y1={y2} x2={x + 3.5} y2={y2} stroke={DRAW_LINE} strokeWidth={0.75} />
      <DimensionTag x={x} y={(y1 + y2) / 2} label={label} active={false} orientation="vertical" />
    </g>
  );
}

/**
 * The plan of a kit with corner sections: the world plan (rack-world.ts) seen
 * from above with the customer standing below it — x to the right along the
 * front line, world z (backward) up the screen — at ONE uniform scale on both
 * axes, so a corner's width, which runs backward, is drawn exactly as long as
 * the same width on a straight section.
 *
 * Every section is its own real footprint: a straight one spans its width
 * along the front line and the kit depth backward; a corner spans the kit
 * depth along the front line and its own width backward. Each one's two end
 * frames (its own uprights and the side between them) are drawn across its
 * depth at its own two ends — never shared with a neighbour.
 *
 * Dimensions: a straight section's width under its front edge; a corner's
 * width beside its outer side, along the direction it runs; the front line's
 * real length (the value the front view's total dimension shows); and the
 * kit depth on an end where a straight section shows it.
 */
function CornerTopView({ config, color, className = '', interactive = false, activeSectionId, onSelectSection }: Props) {
  const locale = useLocale();
  const { placements, bounds } = layoutRackWorld(config.sections, config.depth);
  const planW = Math.max(bounds.x1 - bounds.x0, 1);
  const planD = Math.max(bounds.z1 - bounds.z0, 1);
  const s = Math.min(CORNER_PLAN_W / planW, CORNER_PLAN_D / planD);
  const X = (x: number) => (x - bounds.x0) * s;
  const Y = (z: number) => (bounds.z1 - z) * s;
  const frontY = Y(0);

  const first = placements[0];
  const last = placements[placements.length - 1];
  // The kit depth is measured on a straight end section, the right one
  // preferred (as on the straight plan). A kit whose two ends are both
  // corners has no straight end; its depth stays in the kit dimensions.
  const depthSide = last.corner === 'NONE' ? 'right' : first.corner === 'NONE' ? 'left' : null;
  const leftMargin = first.corner === 'LEFT' || depthSide === 'left' ? SIDE_DIMENSION_MARGIN : SIDE_PLAIN_MARGIN;
  const rightMargin = last.corner === 'RIGHT' || depthSide === 'right' ? SIDE_DIMENSION_MARGIN : SIDE_PLAIN_MARGIN;
  const viewBox = `${-leftMargin} ${-PLAN_TOP_MARGIN} ${planW * s + leftMargin + rightMargin} ${planD * s + PLAN_TOP_MARGIN + PLAN_BOTTOM_MARGIN}`;

  const fill = resolveRackFill(color);
  const markActive = interactive && placements.length > 1;
  const rects = placements.map((p) => ({
    p,
    x: X(p.footprint.x0),
    y: Y(p.footprint.z1),
    width: (p.footprint.x1 - p.footprint.x0) * s,
    height: (p.footprint.z1 - p.footprint.z0) * s,
  }));
  // Every footprint stands on the front line (z = 0) and they follow each
  // other left to right, so the plan's outline is a skyline: along the front
  // line, then back over each section's own far edge.
  const outline = [
    `M${X(bounds.x0)} ${frontY}`,
    `L${X(bounds.x1)} ${frontY}`,
    ...[...rects].reverse().flatMap((r) => [`L${r.x + r.width} ${r.y}`, `L${r.x} ${r.y}`]),
    'Z',
  ].join('');
  const frontLengthMm = getRackFootprintMm(config.sections, config.depth).width;
  const totalY = frontY + TOTAL_LINE_Y_OFFSET;

  return (
    <div data-testid="top-view-corner-plan" className={`relative w-full overflow-hidden border border-line bg-surface ${className}`}>
      <svg viewBox={viewBox} className="h-full w-full" role="img" aria-label={t(CF['CF-007'], locale)}>
        {rects.map(({ p, x, y, width, height }) => (
          <g
            key={p.section.id}
            data-plan-section={p.index + 1}
            data-corner={p.corner}
            {...selectableSectionProps(interactive, t(CF['CF-008'], locale, { N: p.index + 1, W: p.section.width }), p.section.id === activeSectionId, () =>
              onSelectSection?.(p.section.id),
            )}
          >
            <rect x={x} y={y} width={width} height={height} fill={fill} stroke={SEAM} strokeWidth={0.75} />
          </g>
        ))}

        {/* Each section's two end frames, across its own depth at its own two
            ends (u = 0 and u = width), placed by the section's own transform —
            the straight plan's posts. */}
        {placements.flatMap((p) =>
          [0, p.section.width].map((end) => {
            const inset = Math.min(POST_WIDTH / 2 / s, p.section.width / 4);
            const u = end === 0 ? inset : end - inset;
            const a = toWorld(p, u, 0);
            const b = toWorld(p, u, config.depth);
            const alongX = Math.abs(a.x - b.x) > Math.abs(a.z - b.z);
            const x0 = Math.min(X(a.x), X(b.x));
            const y0 = Math.min(Y(a.z), Y(b.z));
            return (
              <rect
                key={`${p.section.id}-${end}`}
                data-plan-frame
                x={alongX ? x0 : x0 - POST_WIDTH / 2}
                y={alongX ? y0 - POST_WIDTH / 2 : y0}
                width={alongX ? Math.abs(X(a.x) - X(b.x)) : POST_WIDTH}
                height={alongX ? POST_WIDTH : Math.abs(Y(a.z) - Y(b.z))}
                fill={fill}
                stroke={SEAM}
                strokeWidth={0.75}
                pointerEvents="none"
              />
            );
          }),
        )}

        <path d={outline} fill="none" stroke={DRAW_INK_SOFT} strokeWidth={1} pointerEvents="none" />

        {markActive &&
          rects
            .filter(({ p }) => p.section.id === activeSectionId)
            .map(({ p, x, y, width, height }) => (
              <rect key={`selected-${p.section.id}`} x={x} y={y} width={width} height={height} fill="none" stroke={DRAW_INK} strokeWidth={1.5} pointerEvents="none" />
            ))}

        {/* Widths, each along the direction it runs: under a straight
            section's front edge, beside a corner's outer side. */}
        {rects.map(({ p, x, y, width }) =>
          p.corner === 'NONE' ? (
            <SectionWidthLabel
              key={`w-${p.section.id}`}
              x={x + width / 2}
              y={frontY + 15}
              label={p.section.width}
              active={markActive && p.section.id === activeSectionId}
            />
          ) : (
            <VerticalDimension
              key={`w-${p.section.id}`}
              testId={`plan-corner-width-${p.index + 1}`}
              x={p.corner === 'LEFT' ? x - 22 : x + width + 22}
              y1={y}
              y2={frontY}
              label={`${p.section.width}`}
            />
          ),
        )}

        {depthSide && (
          <VerticalDimension
            testId="plan-depth"
            x={depthSide === 'right' ? X(bounds.x1) + 22 : X(bounds.x0) - 22}
            y1={Y(config.depth)}
            y2={frontY}
            label={`${config.depth}`}
          />
        )}

        {/* The front line's real length — a corner adds the kit depth to it,
            exactly as the front view's total dimension states. */}
        <g pointerEvents="none">
          <line x1={X(bounds.x0)} y1={totalY} x2={X(bounds.x1)} y2={totalY} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={X(bounds.x0)} y1={totalY - 3.5} x2={X(bounds.x0)} y2={totalY + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={X(bounds.x1)} y1={totalY - 3.5} x2={X(bounds.x1)} y2={totalY + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
          <DimensionTag
            x={(X(bounds.x0) + X(bounds.x1)) / 2}
            y={totalY + 14}
            label={t(CF['CF-023'], locale, { N: Math.round(frontLengthMm) })}
            active={false}
            orientation="horizontal"
          />
        </g>
      </svg>
    </div>
  );
}
