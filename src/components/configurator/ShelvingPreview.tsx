'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColorOption, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import {
  DEPTH_ANGLE_DEG,
  VIEWBOX_H,
  VIEWBOX_W,
  clamp,
  mmToPx,
  type DimensionAxis,
} from './resize/dimension-scale';
import { computeSectionLayout, computeBoundaryXs, type SectionLayout } from './resize/section-geometry';
import { useDimensionDrag } from './resize/useDimensionDrag';
import { ResizeHandle } from './resize/ResizeHandle';
import { MAX_SECTIONS, MIN_SECTIONS } from '@/store/configurator-store';

/**
 * Dynamic, formula-free CAD-style SVG preview of the current configuration.
 * Built entirely from primitive shapes scaled to the customer's selections —
 * there is no per-configuration static image to keep in sync.
 *
 * Height and depth are global to the whole row; width and wall panels are
 * independent per section. Adjacent sections share a single pair of
 * front/rear posts at their boundary (the real product's bolt-on
 * construction), so an N-section row always draws N+1 post pairs, never 2N.
 * Rear posts are always drawn — they are the physical steel frame, not the
 * optional `rearWall` panel — so removing a wall never removes structure.
 *
 * Paint order (back to front) matters here: rear posts → wall panels → shelf
 * planes → front posts/feet → interactive hit-areas → dimension tags, so a
 * wall panel never hides the rear post it's attached to and nothing sits on
 * top of a control it shouldn't.
 *
 * When `interactive` is set (only the configurator page does this — cart
 * summaries stay static) the height/depth dimension tags and the active
 * section's width grow drag handles, and every section gets its own add/
 * remove buttons. Dragging never touches the store directly: it drives a
 * local, continuous "visual" value while the pointer is down, and only calls
 * `onCommitDimension` once, on release or a keyboard step. No pricing or
 * compatibility logic lives in this component.
 */

const FLOOR_Y = 340;
const MAX_ROW_WIDTH_PX = 560;
// Typical 2–4 section rows scale *up* toward this width (≈81% of the 640
// viewBox) instead of staying at their small natural size — MAX_ROW_WIDTH_PX
// remains the hard ceiling for rows with many/wide sections.
const TARGET_FILL_PX = 520;
const POST_WIDTH = 5;
const STEEL_FRONT = '#8F8F8F';
const STEEL_REAR = '#B7B7B7';
const STEEL_FOOT = '#6B6B6B';

export interface AllowedDimensions {
  heights: number[];
  widths: number[];
  depths: number[];
}

interface Props {
  config: ShelvingConfiguration;
  color?: ColorOption;
  className?: string;
  interactive?: boolean;
  allowedDimensions?: AllowedDimensions;
  activeSectionId?: string;
  onSelectSection?: (id: string) => void;
  onAddSectionAfter?: (id: string) => void;
  onRemoveSectionAt?: (id: string) => void;
  onCommitDimension?: (axis: DimensionAxis, value: number) => void;
  /** Global shelf count controls — rendered attached to the rack's right edge. */
  minShelves?: number;
  maxShelves?: number;
  onIncreaseShelves?: () => void;
  onDecreaseShelves?: () => void;
}

const NO_ALLOWED: number[] = [];
function noop() {}

export function ShelvingPreview({
  config,
  color,
  className = '',
  interactive = false,
  allowedDimensions,
  activeSectionId,
  onSelectSection,
  onAddSectionAfter,
  onRemoveSectionAt,
  onCommitDimension,
  minShelves = 2,
  maxShelves = 8,
  onIncreaseShelves,
  onDecreaseShelves,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);
  // Hover-only UI state — purely visual, never touches config/store, so it
  // can never trigger a price recalculation. `activeSectionId` still exists
  // for real selection logic (width drag targets it, SectionTable highlights
  // it) but no longer drives any permanent on-canvas outline by itself.
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  // Whole-preview hover — the only thing that reveals the resize-handle
  // markers pre-emptively. Also purely visual/local: never persisted, never
  // written to the store, never a dependency of useLivePrice.
  const [isPreviewHovered, setIsPreviewHovered] = useState(false);
  const commit = onCommitDimension ?? noop;

  const activeSection = config.sections.find((s) => s.id === activeSectionId) ?? config.sections[0];

  const heightDrag = useDimensionDrag({
    axis: 'height',
    committedValue: config.height,
    allowedValues: allowedDimensions?.heights ?? NO_ALLOWED,
    containerRef,
    onCommit: commit,
    onAnnounce: setAnnouncement,
  });
  const widthDrag = useDimensionDrag({
    axis: 'width',
    committedValue: activeSection.width,
    allowedValues: allowedDimensions?.widths ?? NO_ALLOWED,
    containerRef,
    onCommit: commit,
    onAnnounce: setAnnouncement,
  });
  const depthDrag = useDimensionDrag({
    axis: 'depth',
    committedValue: config.depth,
    allowedValues: allowedDimensions?.depths ?? NO_ALLOWED,
    containerRef,
    onCommit: commit,
    onAnnounce: setAnnouncement,
  });

  const anyDragging = heightDrag.isDragging || widthDrag.isDragging || depthDrag.isDragging;
  useEffect(() => {
    if (anyDragging) setHasInteracted(true);
  }, [anyDragging]);

  // The frame geometry always follows the continuous drag value (smooth
  // resize); only the dimension *labels* jump to the snapped target so the
  // customer can see what will actually be committed on release. Only the
  // active section's width is replaced by the live drag value — the rest of
  // the row stays put, matching "width drag changes only the active section".
  const visualSections: ShelvingSection[] = config.sections.map((s) =>
    s.id === activeSection.id && widthDrag.isDragging ? { ...s, width: widthDrag.displayValue } : s,
  );
  const visualHeight = heightDrag.displayValue;
  const visualDepth = depthDrag.displayValue;

  const layout = useMemo(
    () => computeSectionLayout(visualSections, MAX_ROW_WIDTH_PX, VIEWBOX_W, TARGET_FILL_PX),
    // Keyed on every field that changes what gets drawn (width for proportions,
    // walls for WallPanels) — not just width, or a wall toggle with no width
    // change would leave `layout[i].section` (and its wall flags) stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(visualSections)],
  );
  const heightPx = mmToPx('height', visualHeight);
  const top = FLOOR_Y - heightPx;
  const shelfYs = useMemo(() => computeShelfYs(top, heightPx, config.shelves), [top, heightPx, config.shelves]);
  const boundaryXs = useMemo(() => computeBoundaryXs(layout), [layout]);

  const fill = color?.hex ?? '#D9DBDD';
  const darkFill = shade(fill, -18);
  const lightFill = shade(fill, 22);
  // Shelf surfaces read as thin light metal, not a filled bay — much lighter
  // than the raw frame colour (which is what posts/walls use) and only ever
  // a shallow sliver of depth, not the full perspective offset.
  const shelfFill = shade(fill, 42);

  const depthPx = mmToPx('depth', visualDepth);
  const angleRad = (DEPTH_ANGLE_DEG * Math.PI) / 180;
  const depthVec = { dx: depthPx * Math.cos(angleRad), dy: -depthPx * Math.sin(angleRad) };
  const shelfDepthVec = { dx: depthVec.dx * 0.5, dy: depthVec.dy * 0.5 };

  const rowStart = layout[0].x;
  const rowEnd = layout[layout.length - 1].x + layout[layout.length - 1].width;
  const heightHandlePoint = { x: rowStart - 26, y: (top + FLOOR_Y) / 2 };
  const activeGeom = layout.find((s) => s.id === activeSection.id) ?? layout[0];
  const widthHandlePoint = { x: activeGeom.x + activeGeom.width, y: (top + FLOOR_Y) / 2 };
  const depthOrigin = { x: rowEnd, y: top + 10 };
  const depthEnd = { x: depthOrigin.x + depthVec.dx, y: depthOrigin.y + depthVec.dy };

  const totalLengthMm = widthDrag.isDragging
    ? layout.reduce((sum, s) => sum + s.section.width, 0)
    : config.sections.reduce((sum, s) => sum + s.width, 0);
  const canAdd = config.sections.length < MAX_SECTIONS;
  const canRemove = config.sections.length > MIN_SECTIONS;

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden border border-line bg-surface ${className}`}
      onPointerEnter={interactive ? () => setIsPreviewHovered(true) : undefined}
      onPointerLeave={interactive ? () => setIsPreviewHovered(false) : undefined}
    >
      <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} className="h-full w-full" role="img" aria-label="Схема стеллажа спереди">
        <line x1={20} y1={FLOOR_Y} x2={VIEWBOX_W - 20} y2={FLOOR_Y} stroke={STEEL_FOOT} strokeWidth={1.5} opacity={0.5} />

        {/* 1. Rear posts — the physical steel frame, always visible regardless of any wall selection. */}
        {boundaryXs.map((x, i) => (
          <g key={`rear-post-${i}`}>
            <line
              x1={x}
              y1={top}
              x2={x + depthVec.dx}
              y2={top + depthVec.dy}
              stroke={STEEL_REAR}
              strokeWidth={1}
            />
            <line
              x1={x}
              y1={FLOOR_Y}
              x2={x + depthVec.dx}
              y2={FLOOR_Y + depthVec.dy}
              stroke={STEEL_REAR}
              strokeWidth={1}
            />
            <rect
              x={x + depthVec.dx - POST_WIDTH / 2}
              y={top + depthVec.dy}
              width={POST_WIDTH}
              height={FLOOR_Y - top}
              fill={STEEL_REAR}
            />
          </g>
        ))}

        {/* 2. Wall panels — only when the customer actually selected them. */}
        {layout.map((section) => (
          <WallPanels key={`walls-${section.id}`} section={section} top={top} bottom={FLOOR_Y} depthVec={depthVec} darkFill={darkFill} lightFill={lightFill} />
        ))}

        {/* 3. Shelf planes — a thin front edge plus a shallow receding sliver,
             just enough to read as a physical plate with real depth. White
             space between shelf levels stays untouched — no fill spans the
             full bay, and both the sliver and the plate use a much lighter
             tone than the frame colour so the bay reads as empty, not filled. */}
        {layout.map((section) => (
          <g key={`shelves-${section.id}`}>
            {shelfYs.map((y, i) => (
              <g key={i}>
                <polygon
                  points={`${section.x},${y - 2} ${section.x + section.width},${y - 2} ${section.x + section.width + shelfDepthVec.dx},${y - 2 + shelfDepthVec.dy} ${section.x + shelfDepthVec.dx},${y - 2 + shelfDepthVec.dy}`}
                  fill={lightFill}
                  opacity={0.18}
                />
                <rect x={section.x} y={y - 2} width={section.width} height={4} fill={shelfFill} stroke="#1C2024" strokeOpacity={0.1} strokeWidth={0.5} />
              </g>
            ))}
          </g>
        ))}

        {/* 4. Front posts + feet. */}
        {boundaryXs.map((x, i) => (
          <g key={`front-post-${i}`}>
            <rect x={x - POST_WIDTH / 2} y={top} width={POST_WIDTH} height={FLOOR_Y - top} fill={STEEL_FRONT} />
            <rect x={x - POST_WIDTH / 2 - 2} y={FLOOR_Y} width={POST_WIDTH + 4} height={5} fill={STEEL_FOOT} />
          </g>
        ))}

        {/* 5. Interactive hit-areas + hover-only outline. `activeSectionId`
             keeps driving real selection (width drag, SectionTable), but the
             visible dashed box now follows the pointer, not the selection —
             it must disappear the instant the pointer leaves, never persist. */}
        {layout.map((section, i) => {
          const isActive = interactive && section.id === activeSection.id;
          const isHovered = interactive && section.id === hoveredSectionId;
          return (
            <g
              key={`hit-${section.id}`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `Секция ${i + 1}, ширина ${section.section.width} мм` : undefined}
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
              onPointerEnter={interactive ? () => setHoveredSectionId(section.id) : undefined}
              onPointerLeave={
                interactive ? () => setHoveredSectionId((current) => (current === section.id ? null : current)) : undefined
              }
              // `outline-none` clears the browser's default black `outline: auto`
              // that a mouse click leaves on a focused, non-native-button element
              // (it matches plain :focus, not :focus-visible, so our global
              // :focus-visible rule never gets a chance to override it) —
              // focus-visible:outline-* restores a subtle indicator, but only
              // while the section actually has real keyboard focus.
              className={interactive ? 'outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-dashed focus-visible:outline-offset-2 focus-visible:outline-dimension-accent' : undefined}
              style={interactive ? { cursor: 'pointer' } : undefined}
            >
              <rect x={section.x} y={top - 6} width={section.width} height={FLOOR_Y - top + 12} fill="transparent" />
              {isHovered && (
                <rect
                  x={section.x - 2}
                  y={top - 8}
                  width={section.width + 4}
                  height={FLOOR_Y - top + 16}
                  fill="none"
                  stroke="var(--color-dimension-accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.85}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* 6. Dimension tags/labels. */}
        <DimensionTag x={heightHandlePoint.x} y={heightHandlePoint.y} label={`${Math.round(heightDrag.snapTarget ?? config.height)}`} active={heightDrag.isDragging} orientation="vertical" />
        <DimensionTag x={depthEnd.x} y={depthEnd.y} label={`${Math.round(depthDrag.snapTarget ?? config.depth)}`} active={depthDrag.isDragging} orientation="horizontal" />

        {layout.map((section) => (
          <SectionWidthLabel
            key={`label-${section.id}`}
            x={section.x + section.width / 2}
            y={FLOOR_Y + 16}
            label={widthDrag.isDragging && section.id === activeSection.id ? (widthDrag.snapTarget ?? section.section.width) : section.section.width}
            active={widthDrag.isDragging && section.id === activeSection.id}
          />
        ))}

        <TotalWidthLine x1={rowStart} x2={rowEnd} y={FLOOR_Y + 40} label={Math.round(totalLengthMm)} active={widthDrag.isDragging} />
      </svg>

      {interactive && (
        <>
          <ResizeHandle
            axis="height"
            ariaLabel={`Изменить высоту стеллажа. Текущая высота: ${config.height} миллиметров.`}
            value={config.height}
            min={heightDrag.min}
            max={heightDrag.max}
            xPercent={(heightHandlePoint.x / VIEWBOX_W) * 100}
            yPercent={(heightHandlePoint.y / VIEWBOX_H) * 100}
            cursorClassName="cursor-ns-resize"
            isDragging={heightDrag.isDragging}
            previewHovered={isPreviewHovered}
            onPointerDown={heightDrag.onPointerDown}
            onPointerMove={heightDrag.onPointerMove}
            onPointerUp={heightDrag.onPointerUp}
            onPointerCancel={heightDrag.onPointerCancel}
            onKeyDown={heightDrag.onKeyDown}
          />
          <ResizeHandle
            axis="width"
            ariaLabel={`Изменить ширину активной секции. Текущая ширина: ${activeSection.width} миллиметров.`}
            value={activeSection.width}
            min={widthDrag.min}
            max={widthDrag.max}
            xPercent={(widthHandlePoint.x / VIEWBOX_W) * 100}
            yPercent={(widthHandlePoint.y / VIEWBOX_H) * 100}
            cursorClassName="cursor-ew-resize"
            isDragging={widthDrag.isDragging}
            previewHovered={isPreviewHovered}
            onPointerDown={widthDrag.onPointerDown}
            onPointerMove={widthDrag.onPointerMove}
            onPointerUp={widthDrag.onPointerUp}
            onPointerCancel={widthDrag.onPointerCancel}
            onKeyDown={widthDrag.onKeyDown}
          />
          <ResizeHandle
            axis="depth"
            ariaLabel={`Изменить глубину стеллажа. Текущая глубина: ${config.depth} миллиметров.`}
            value={config.depth}
            min={depthDrag.min}
            max={depthDrag.max}
            xPercent={(depthEnd.x / VIEWBOX_W) * 100}
            yPercent={(depthEnd.y / VIEWBOX_H) * 100}
            cursorClassName="cursor-nesw-resize"
            isDragging={depthDrag.isDragging}
            previewHovered={isPreviewHovered}
            onPointerDown={depthDrag.onPointerDown}
            onPointerMove={depthDrag.onPointerMove}
            onPointerUp={depthDrag.onPointerUp}
            onPointerCancel={depthDrag.onPointerCancel}
            onKeyDown={depthDrag.onKeyDown}
          />

          {/* One + above and one − below every section, per the reference layout. */}
          {layout.map((section, i) => {
            const xPercent = ((section.x + section.width / 2) / VIEWBOX_W) * 100;
            return (
              <div key={`add-${section.id}`} className="absolute -translate-x-1/2" style={{ left: `${xPercent}%`, top: '4%' }}>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => onAddSectionAfter?.(section.id)}
                  title={`Добавить секцию после «Секция ${i + 1}»`}
                  aria-label={`Добавить секцию после секции ${i + 1}`}
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-sm text-steel shadow-sm transition-colors hover:border-dimension-accent hover:text-dimension-accent disabled:cursor-not-allowed disabled:opacity-30"
                >
                  +
                </button>
              </div>
            );
          })}
          {layout.map((section, i) => {
            const xPercent = ((section.x + section.width / 2) / VIEWBOX_W) * 100;
            return (
              <div
                key={`remove-${section.id}`}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${xPercent}%`, top: '90%' }}
              >
                <button
                  type="button"
                  disabled={!canRemove}
                  onClick={() => onRemoveSectionAt?.(section.id)}
                  title={`Удалить «Секция ${i + 1}»`}
                  aria-label={`Удалить секцию ${i + 1}`}
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-sm text-steel shadow-sm transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                >
                  −
                </button>
              </div>
            );
          })}

          {/* Global shelf count — attached directly to the rack's right edge,
              not a separate panel. */}
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
            style={{
              left: `${(Math.min(rowEnd + 30, VIEWBOX_W - 18) / VIEWBOX_W) * 100}%`,
              top: `${(((top + FLOOR_Y) / 2) / VIEWBOX_H) * 100}%`,
            }}
          >
            <button
              type="button"
              aria-label="Увеличить количество полок"
              onClick={onIncreaseShelves}
              disabled={config.shelves >= maxShelves}
              className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-sm text-steel shadow-sm transition-colors hover:border-dimension-accent hover:text-dimension-accent disabled:cursor-not-allowed disabled:opacity-30"
            >
              +
            </button>
            <span className="mono text-[11px] font-semibold text-steel">{config.shelves}</span>
            <button
              type="button"
              aria-label="Уменьшить количество полок"
              onClick={onDecreaseShelves}
              disabled={config.shelves <= minShelves}
              className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-sm text-steel shadow-sm transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
            >
              −
            </button>
          </div>

          {/* No opaque background — this is a first-run nudge, not a control,
              and must never visually cover the real section +/- buttons that
              share this bottom strip. */}
          {!hasInteracted && (
            <p className="tech-label pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 px-2 py-1 text-center text-steel drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
              Кликните секцию, чтобы выбрать, или перетащите маркеры
            </p>
          )}
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </>
      )}

      <div className="tech-label pointer-events-none absolute bottom-2 right-3">{config.loadCapacity} кг/полка</div>
    </div>
  );
}

function computeShelfYs(top: number, heightPx: number, shelves: number): number[] {
  const shelfCount = Math.max(1, shelves);
  return Array.from({ length: shelfCount }, (_, i) => {
    const ratio = shelfCount === 1 ? 0.5 : i / (shelfCount - 1);
    return top + 14 + ratio * (heightPx - 28);
  });
}

/** Rear wall / left wall / right wall — only rendered when the customer actually selected them. */
function WallPanels({
  section,
  top,
  bottom,
  depthVec,
  darkFill,
  lightFill,
}: {
  section: SectionLayout;
  top: number;
  bottom: number;
  depthVec: { dx: number; dy: number };
  darkFill: string;
  lightFill: string;
}) {
  const { x, width, section: s } = section;
  return (
    <>
      {s.rearWall && (
        <polygon
          points={`${x + depthVec.dx},${top + depthVec.dy} ${x + width + depthVec.dx},${top + depthVec.dy} ${x + width + depthVec.dx},${bottom + depthVec.dy} ${x + depthVec.dx},${bottom + depthVec.dy}`}
          fill={darkFill}
          opacity={0.3}
        />
      )}
      {s.leftWall && (
        <polygon points={`${x},${top} ${x},${bottom} ${x + depthVec.dx},${bottom + depthVec.dy} ${x + depthVec.dx},${top + depthVec.dy}`} fill={lightFill} opacity={0.45} />
      )}
      {s.rightWall && (
        <polygon
          points={`${x + width},${top} ${x + width},${bottom} ${x + width + depthVec.dx},${bottom + depthVec.dy} ${x + width + depthVec.dx},${top + depthVec.dy}`}
          fill={lightFill}
          opacity={0.45}
        />
      )}
    </>
  );
}

/** Compact grey tag under each section — mirrors the reference's per-section width chip. */
export function SectionWidthLabel({ x, y, label, active }: { x: number; y: number; label: number; active: boolean }) {
  const text = String(Math.round(label));
  const w = Math.max(24, text.length * 6 + 8);
  const h = active ? 16 : 14;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={2} fill={active ? 'var(--color-dimension-accent)' : '#9AA1AB'} opacity={active ? 1 : 0.85} />
      <text x={x} y={y + 3} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={active ? 10 : 9} fontWeight={600} fill="#FFFFFF">
        {text}
      </text>
    </g>
  );
}

/** Compact persistent red tag with a white number — the reference's "small red rectangle" dimension style. */
export function DimensionTag({
  x,
  y,
  label,
  active,
  orientation,
}: {
  x: number;
  y: number;
  label: string;
  active: boolean;
  orientation: 'vertical' | 'horizontal';
}) {
  const w = Math.max(28, label.length * 7 + 10);
  const h = active ? 18 : 16;
  const isVertical = orientation === 'vertical';
  return (
    <g transform={isVertical ? `rotate(-90 ${x} ${y})` : undefined}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={2} fill="var(--color-dimension-accent)" opacity={active ? 1 : 0.92} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={active ? 11 : 10} fontWeight={600} fill="#FFFFFF">
        {label}
      </text>
    </g>
  );
}

/** Thin dimension line + centered value under the whole row — no arrowheads, no sentence-length label. */
function TotalWidthLine({ x1, x2, y, label, active }: { x1: number; x2: number; y: number; label: number; active: boolean }) {
  const color = active ? 'var(--color-dimension-accent)' : '#B7B7B7';
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={1} />
      <line x1={x1} y1={y - 3} x2={x1} y2={y + 3} stroke={color} strokeWidth={1} />
      <line x1={x2} y1={y - 3} x2={x2} y2={y + 3} stroke={color} strokeWidth={1} />
      <DimensionTag x={(x1 + x2) / 2} y={y + 15} label={`${label} мм`} active={active} orientation="horizontal" />
    </g>
  );
}

function shade(hex: string, percent: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const num = Number.parseInt(normalized, 16);
  const r = clamp(((num >> 16) & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  const g = clamp(((num >> 8) & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  const b = clamp((num & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
