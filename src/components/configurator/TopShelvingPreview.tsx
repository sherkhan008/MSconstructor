'use client';

import { useMemo } from 'react';
import type { ColorOption, ShelvingConfiguration } from '@/lib/types/domain';
import { VIEWBOX_W, depthMmToTopPx } from './resize/dimension-scale';
import { computeSectionLayout, computeBoundaryXs } from './resize/section-geometry';
import { SectionWidthLabel } from './ShelvingPreview';
import { resolveRackFill, shade } from './rack-colors';
import { t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Plan/top view — a bird's-eye footprint of the current shelving row,
 * following the same reference used for the front view. Reuses the exact
 * same per-section x-layout as ShelvingPreview (computeSectionLayout) so
 * sections line up identically between the two view modes; horizontal axis
 * is section width, vertical axis is the global depth.
 *
 * View/select only for this iteration — no drag here. Section selection is
 * wired straight to the same `activeSectionId`/`onSelectSection` the front
 * view and the section table already share; there is no separate top-view
 * selection state.
 */

const MAX_ROW_WIDTH_PX = 520;
const TOP_Y = 26;
const TOTAL_LINE_Y_OFFSET = 22;

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
  const layout = useMemo(
    () => computeSectionLayout(config.sections, MAX_ROW_WIDTH_PX, VIEWBOX_W),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(config.sections.map((s) => s.width))],
  );
  const boundaryXs = useMemo(() => computeBoundaryXs(layout), [layout]);
  const depthPx = depthMmToTopPx(config.depth);
  const bottom = TOP_Y + depthPx;
  const viewboxH = bottom + TOTAL_LINE_Y_OFFSET + 34;

  // Same resolved fill as the front view (see rack-colors.ts) so the two
  // preview modes never disagree on what color the rack is.
  const fill = resolveRackFill(color);
  const edgeShade = shade(fill, -6);
  const rowStart = layout[0].x;
  const rowEnd = layout[layout.length - 1].x + layout[layout.length - 1].width;
  const totalLengthMm = config.sections.reduce((sum, s) => sum + s.width, 0);

  return (
    <div className={`relative w-full overflow-hidden border border-line bg-surface ${className}`}>
      <svg viewBox={`0 0 ${VIEWBOX_W} ${viewboxH}`} className="h-full w-full" role="img" aria-label={t(CF['CF-007'], locale)}>
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
              style={interactive ? { cursor: 'pointer' } : undefined}
            >
              <rect x={section.x} y={TOP_Y} width={section.width} height={depthPx} fill={fill} stroke={edgeShade} strokeWidth={1} />
              {isActive && layout.length > 1 && (
                <rect
                  x={section.x - 2}
                  y={TOP_Y - 2}
                  width={section.width + 4}
                  height={depthPx + 4}
                  fill="none"
                  stroke="var(--color-dimension-accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Shared-boundary posts, same idea as the front view's front posts —
             same resolved fill, not an unrelated color. */}
        {boundaryXs.map((x, i) => (
          <rect key={i} x={x - 2.5} y={TOP_Y} width={5} height={depthPx} fill={fill} stroke={edgeShade} strokeWidth={0.5} />
        ))}

        {/* Per-section width labels, under each footprint. */}
        {layout.map((section) => (
          <SectionWidthLabel key={section.id} x={section.x + section.width / 2} y={bottom + 16} label={section.section.width} active={false} />
        ))}

        {/* Total width. */}
        <g>
          <line x1={rowStart} y1={bottom + TOTAL_LINE_Y_OFFSET} x2={rowEnd} y2={bottom + TOTAL_LINE_Y_OFFSET} stroke="#B7B7B7" strokeWidth={1} />
          <line x1={rowStart} y1={bottom + TOTAL_LINE_Y_OFFSET - 3} x2={rowStart} y2={bottom + TOTAL_LINE_Y_OFFSET + 3} stroke="#B7B7B7" strokeWidth={1} />
          <line x1={rowEnd} y1={bottom + TOTAL_LINE_Y_OFFSET - 3} x2={rowEnd} y2={bottom + TOTAL_LINE_Y_OFFSET + 3} stroke="#B7B7B7" strokeWidth={1} />
          <text x={(rowStart + rowEnd) / 2} y={bottom + TOTAL_LINE_Y_OFFSET + 14} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={10} fill="#8A8A8A">
            {t(CF['CF-023'], locale, { N: Math.round(totalLengthMm) })}
          </text>
        </g>

        {/* Depth tag on the right edge. */}
        <g>
          <rect x={rowEnd + 10} y={TOP_Y} width={5} height={depthPx} fill="none" />
          <line x1={rowEnd + 14} y1={TOP_Y} x2={rowEnd + 14} y2={bottom} stroke="var(--color-dimension-accent)" strokeWidth={1} opacity={0.5} />
          <rect x={rowEnd + 6} y={(TOP_Y + bottom) / 2 - 9} width={30} height={18} rx={2} fill="var(--color-dimension-accent)" opacity={0.92} />
          <text x={rowEnd + 21} y={(TOP_Y + bottom) / 2 + 3.5} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={10} fontWeight={600} fill="#FFFFFF">
            {config.depth}
          </text>
        </g>
      </svg>
    </div>
  );
}
