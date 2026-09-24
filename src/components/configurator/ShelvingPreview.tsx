'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ColorOption, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import {
  DEPTH_ANGLE_DEG,
  VIEWBOX_H,
  VIEWBOX_W,
  clamp,
  mmToPx,
  type DimensionAxis,
} from './resize/dimension-scale';
import { computeRowScale, layoutSectionsWithScale, computeBoundaryXs, applyLiveActiveWidth, type SectionLayout } from './resize/section-geometry';
import { useDimensionDrag } from './resize/useDimensionDrag';
import { ResizeHandle } from './resize/ResizeHandle';
import { MAX_SECTIONS, MIN_SECTIONS } from '@/store/configurator-store';
import { getMaxSectionHeight, getMaxSectionShelves } from '@/lib/configurator/section-dimensions';
import { resolveRackFill, shade } from './rack-colors';
import { computeRenderDepthVec, SHELF_LIP_HEIGHT_PX } from './shelf-depth-projection';
import { t } from '@/lib/i18n/format';
import { CF, CT, G } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Dynamic, formula-free CAD-style SVG preview of the current configuration.
 * Built entirely from primitive shapes scaled to the customer's selections —
 * there is no per-configuration static image to keep in sync.
 *
 * Depth is global to the whole row; width, height, shelves and wall panels
 * belong to each section (the drawing still uses one row height/shelf set —
 * see rowHeight/rowShelves below). Adjacent sections share a single pair of
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
 * summaries stay static) the height dimension tag and the active section's
 * width grow drag handles, and every section gets its own add/remove
 * buttons. Dragging never touches the store directly: it drives a local,
 * continuous "visual" value while the pointer is down, and only calls
 * `onCommitDimension` once, on release or a keyboard step. No pricing or
 * compatibility logic lives in this component.
 *
 * Depth has no drag handle here — it's read-only in this preview, driven
 * directly by `config.depth`. The customer changes it only through the
 * parameter controls below the preview; this component just renders
 * whatever depth is currently configured, the same way it renders shelf
 * count or wall selection.
 */

// Exported so tests can reproduce ShelvingPreview's exact committed/live
// layout pipeline (computeRowScale + layoutSectionsWithScale, and now the
// adaptive depth projection's shelfYs/top inputs) instead of duplicating
// magic numbers that could silently drift out of sync.
export const FLOOR_Y = 250;
export const MAX_ROW_WIDTH_PX = 300;
// Typical 2–4 section rows scale *up* toward this width instead of staying
// at their small natural size — MAX_ROW_WIDTH_PX remains the hard ceiling
// for rows with many/wide sections. Both are deliberately small relative to
// the 640×480 viewBox: the rack should read as a compact object in the
// upper-left of a mostly-white canvas, not a centered hero graphic.
export const TARGET_FILL_PX = 260;
// Row starts this far from the left edge instead of being centred in the
// viewBox — see `layout` below, which shifts layoutSectionsWithScale's
// (centred) output by a constant so the rack always anchors top-left
// regardless of row width, and grows rightward as sections are added.
export const RACK_LEFT_MARGIN = 60;
// Applied to height/depth *after* the protected mm→px conversion — purely a
// rendering-scale knob local to this component. Drag sensitivity is driven
// by useDimensionDrag reading the container's actual CSS box size against
// the (unchanged) VIEWBOX_W/H and the (unchanged) dimension-scale.ts
// ranges, so this never touches resize math, only how large the result is
// drawn.
export const RACK_SCALE = 0.6;
const POST_WIDTH = 5;
// Feet are small dark hardware, not the painted upright body — deliberately
// not derived from the rack's main color (see rack-colors.ts), same as real
// shelving units, whose adjustable plastic/steel feet read darker than the
// painted frame. Sized as small industrial support pads (~22–25% smaller
// than the previous 9×5 block on each dimension), not oversized blocks.
const STEEL_FOOT = '#6B6B6B';
const FOOT_WIDTH = POST_WIDTH + 2;
const FOOT_HEIGHT = 4;

// Small repeated holes down the centreline of each front post — real
// shelving uprights are perforated steel, not a plain bar. Spacing/radius
// tuned to stay "subtle but clearly visible" rather than noisy at this scale.
const HOLE_SPACING = 11;
const HOLE_RADIUS = 1.1;
const HOLE_MARGIN = 7;

function perforationYs(top: number, bottom: number): number[] {
  const from = top + HOLE_MARGIN;
  const to = bottom - HOLE_MARGIN;
  if (to <= from) return [];
  const count = Math.max(1, Math.round((to - from) / HOLE_SPACING));
  return Array.from({ length: count + 1 }, (_, i) => from + (i * (to - from)) / count);
}

// Shared flat, compact language for every circular control around the rack
// (section add/remove, shelf count +/-): plain surface fill, thin border,
// no gradient/shadow. The visible disc is deliberately smaller than the
// button itself — the button stays a 44×44 touch target while the disc
// stays light enough not to compete with the rack. A disabled disc stays
// opaque (only its glyph and border fade) so the rack never shows through
// a control that happens to sit over it.
//
// Colour is the site's graphite, one step lighter at rest than before so a
// row of controls reads as supporting chrome rather than as a second rack:
// a hairline ring with a steel glyph at rest, a graphite ring on the
// selected section, and a solid graphite disc on hover/keyboard focus.
// Disabled discs fade to the light steel/line tokens and ignore hover.
const CIRCLE_HIT =
  'group grid h-11 w-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blueprint disabled:cursor-not-allowed';
const CIRCLE_DISC =
  'grid place-items-center rounded-full border font-medium leading-none text-steel transition-colors group-hover:border-foreground group-hover:bg-foreground group-hover:text-surface group-focus-visible:border-foreground group-focus-visible:bg-foreground group-focus-visible:text-surface group-disabled:!border-line group-disabled:!bg-surface group-disabled:!text-steel-soft';
/** Visible disc sizes inside the 44×44 hit area: the section "add" disc is
 * the larger one; section "remove" and shelf +/− share the smaller size. */
const DISC_LARGE = 'h-[27px] w-[27px] text-base';
const DISC_SMALL = 'h-6 w-6 text-sm';

/* ---------------------------------------------------------------------------
   Technical drawing palette. Every dimension line, tick, label surface and
   selection mark on this canvas reads from these four site tokens and
   nothing else, so the workspace can never drift into a colour system of
   its own. Graphite/steel/white only — the legacy red dimension accent is
   no longer used as general configurator chrome (it stays a token, still
   used by the section table's active-row marker).
   --------------------------------------------------------------------------- */
/** Dimension lines, extension ticks and the idle label border. */
export const DRAW_LINE = 'var(--color-line-strong)';
/** The floor reference line and other secondary hairlines. */
export const DRAW_HAIRLINE = 'var(--color-line)';
/** Label/value text and the active (dragging) label surface. */
export const DRAW_INK = 'var(--color-foreground)';
/** Secondary technical text — idle section widths. */
export const DRAW_INK_SOFT = 'var(--color-steel)';
/** Label surface, and the active label's own text. */
export const DRAW_PAPER = 'var(--color-surface)';

/* ---------------------------------------------------------------------------
   Framed workspace crop (see `computeFramedCrop`).
   --------------------------------------------------------------------------- */
/** The shelf-count column sits this far past the row's right edge, plus up to
 * SHELF_COLUMN_DEPTH_SHIFT more on a deep rack so it clears the receding
 * shelf surfaces instead of sitting on them. */
const SHELF_COLUMN_OFFSET = 24;
const SHELF_COLUMN_DEPTH_SHIFT = 30;
/** Room for a 44px touch circle's own radius at the narrowest supported
 * viewport. Every clearance below is checked against this, so no circular
 * control is ever clipped by the frame at any crop. */
const TOUCH_RADIUS_CLEARANCE = 30;
/** Half of a 44px control, and the narrowest phone frame it has to survive.
 * A reserve stated in viewBox units depends on the very crop width it helps
 * determine, so the compact profile solves for it (`R = 22 * w / 320` with
 * `w = base + R`) instead of guessing a constant that has to be generous
 * enough for the widest row and is therefore wasteful for every other one. */
const TOUCH_RADIUS_PX = 22;
const NARROWEST_FRAME_PX = 320;

/**
 * How the workspace frame is proportioned, and how much empty room the crop
 * reserves around the drawing. Two profiles, chosen purely by viewport width
 * in CSS (see `.configurator-stage` in globals.css) — this component
 * publishes both as custom properties and never measures the viewport.
 *
 *  - `WIDE_FRAME` is the approved desktop/tablet framing, unchanged: a 4:3
 *    frame, 46 units of room left of the row, and the deepest possible
 *    shelf-column offset reserved whatever depth is configured.
 *  - `COMPACT_FRAME` applies to phones only. It is proportioned 6:5 rather
 *    than 4:3 — a phone can spare a little frame height far more cheaply
 *    than frame width — and it reserves only what is really drawn: the room
 *    the height dimension actually needs on the left, and the shelf column's
 *    real offset at the *committed* depth. Depth is never dragged (it changes
 *    only through the parameter select), so reading it here cannot rescale
 *    the workspace mid-gesture the way reading a section width would.
 */
export interface FrameProfile {
  /** Frame width divided by height. The crop always takes the frame's ratio. */
  aspect: number;
  /** viewBox x of the crop's left edge: the row starts at RACK_LEFT_MARGIN
   * (see `committedLeftShift`) and the height dimension line plus its rotated
   * tag reach ~34 units to its left. */
  left: number;
  /** Above the rack's top edge: the per-section add buttons are centred 24
   * units above it and need room for their own touch circle. */
  top: number;
  /** Below the floor: per-section width labels, the remove buttons, and the
   * total-width dimension line with its tag (which ends at FLOOR_Y + 89.5). */
  bottom: number;
  /** Fixed shelf-column depth offset to reserve, or null to reserve only the
   * offset the committed depth actually produces. */
  depthAllowance: number | null;
  /** Fixed room reserved right of the shelf-count column for its own touch
   * radius, or null to solve for the exact amount at NARROWEST_FRAME_PX. */
  touchReserve: number | null;
}

export const WIDE_FRAME: FrameProfile = {
  aspect: VIEWBOX_W / VIEWBOX_H,
  left: RACK_LEFT_MARGIN - 46,
  top: 54,
  bottom: 94,
  depthAllowance: SHELF_COLUMN_DEPTH_SHIFT,
  touchReserve: TOUCH_RADIUS_CLEARANCE,
};

export const COMPACT_FRAME: FrameProfile = {
  aspect: 6 / 5,
  left: RACK_LEFT_MARGIN - 36,
  top: 54,
  bottom: 91,
  depthAllowance: null,
  touchReserve: null,
};

/** The top view frames itself with the desktop profile (see its own file). */
export const CROP_LEFT = WIDE_FRAME.left;

/**
 * Width of the framed crop, in viewBox units: everything that can possibly be
 * drawn to the right of the profile's left edge for a row of `sectionCount`
 * sections — the widest that row can auto-fit to, plus the shelf-count column
 * at its furthest offset, plus that column's own touch radius.
 *
 * A ceiling per section *count*, never a measurement of the current section
 * widths. The crop drives the stage's zoom, and a zoom that changed when a
 * width was committed would move the rack under the pointer at the exact
 * moment a drag is released; `computeRowScale` caps a lone section at
 * TARGET_FILL_PX and any longer row at MAX_ROW_WIDTH_PX, so these two
 * ceilings hold for every width the catalog allows.
 */
export function framedCropWidth(
  profile: FrameProfile,
  sectionCount: number,
  depthShiftPx = SHELF_COLUMN_DEPTH_SHIFT,
): number {
  const rowCeiling = sectionCount <= 1 ? TARGET_FILL_PX : MAX_ROW_WIDTH_PX;
  const shelfColumn = profile.depthAllowance ?? clamp(depthShiftPx, 0, SHELF_COLUMN_DEPTH_SHIFT);
  const base = RACK_LEFT_MARGIN + rowCeiling + SHELF_COLUMN_OFFSET + shelfColumn - profile.left;
  if (profile.touchReserve !== null) return base + profile.touchReserve;
  return base / (1 - TOUCH_RADIUS_PX / NARROWEST_FRAME_PX);
}

/**
 * The rectangle of the 640×480 viewBox that the framed workspace actually
 * shows, in viewBox units. Exported so tests can assert the framing without
 * re-deriving it.
 *
 * Framing only: no drawing geometry, no drag math and no interactive position
 * depends on this. `useDimensionDrag` measures the stage element, which still
 * represents the full viewBox at whatever zoom the crop implies, so
 * pointer-to-millimetre sensitivity is unchanged at every crop — and the
 * stage stays exactly 4:3 in real pixels at any frame ratio, because its
 * width and height are taken from `w` and `h` independently.
 *
 * The crop's *size* is a function of the committed rack height, the section
 * count and (compact profile only) the committed depth — never of section
 * widths — so adding, removing or resizing a section never rescales the
 * workspace. Its height still follows a live height drag upward, so a rack
 * dragged taller than its committed framing is never clipped mid-gesture.
 */
export function computeFramedCrop(
  profile: FrameProfile,
  contentTop: number,
  contentBottom: number,
  sectionCount: number,
  depthShiftPx?: number,
) {
  const minW = framedCropWidth(profile, sectionCount, depthShiftPx);
  const needed = Math.max(contentBottom - contentTop, 1);
  const w = clamp(Math.max(needed * profile.aspect, minW), 1, Math.min(VIEWBOX_W, VIEWBOX_H * profile.aspect));
  const h = w / profile.aspect;
  return {
    x: clamp(profile.left - (w - minW) / 2, 0, VIEWBOX_W - w),
    y: clamp((contentTop + contentBottom) / 2 - h / 2, 0, VIEWBOX_H - h),
    w,
    h,
  };
}

export interface AllowedDimensions {
  heights: number[];
  widths: number[];
  depths: number[];
}

interface Props {
  /** Tighter framing for storefront illustrations; interactive geometry is unchanged. */
  presentation?: boolean;
  /** With `presentation`: start the frame just above the rack instead of at
   * the viewBox origin, so a short rack does not sit under an empty band.
   * Framing only — the drawing itself is unchanged. */
  tightFraming?: boolean;
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
  /** "Сброс настроек" text action, top-right of the preview. Reuses the
   * store's existing `reset()` — this component never invents its own reset
   * logic, only renders the button when a handler is supplied. */
  onReset?: () => void;
  /** Configurator workspace framing: renders the preview as a 4:3 frame
   * that zooms onto the rack (see `computeFramedCrop`), with the first-run
   * hint and load caption in a caption strip under the frame instead of
   * floating over the drawing. `className` styles the outer wrapper and
   * `frameClassName` the 4:3 frame itself. */
  framed?: boolean;
  frameClassName?: string;
  /** Unframed only: false omits the overlaid load caption — for a thumbnail
   * whose surrounding text already states the load. */
  showLoadCaption?: boolean;
}

const NO_ALLOWED: number[] = [];
function noop() {}

export function ShelvingPreview({
  config,
  color,
  className = '',
  presentation = false,
  tightFraming = false,
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
  onReset,
  framed = false,
  frameClassName = '',
  showLoadCaption = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const [announcement, setAnnouncement] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);
  // Hover-only UI state — purely visual, never touches config/store, so it
  // can never trigger a price recalculation. `activeSectionId` still exists
  // for real selection logic (width drag targets it, SectionTable highlights
  // it) but no longer drives any permanent on-canvas outline by itself.
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  // Per-axis resize-discovery hover — each marker only appears once the
  // pointer is over that axis's own physical part of the rack (top edge for
  // height, a section's right upright for width), never just because the
  // pointer entered the white canvas somewhere. Purely visual/local: never
  // persisted, never written to the store, never a dependency of
  // useLivePrice. Depth has no entry here — it has no drag handle to
  // discover (see the component doc comment above).
  const [heightZoneHovered, setHeightZoneHovered] = useState(false);
  const [widthZoneHovered, setWidthZoneHovered] = useState(false);
  const commit = onCommitDimension ?? noop;

  const activeSection = config.sections.find((s) => s.id === activeSectionId) ?? config.sections[0];
  // TRANSITIONAL (V2.2A): height and shelves live on each section, but this
  // preview still draws the row with one height and one shelf set (the
  // per-section drawing comes with the per-section UI phase). It draws the
  // tallest section and the most shelves — the row's envelope; the customer
  // UI only produces uniform sections, where these equal every section's own
  // values. A mixed configuration cannot be priced yet (see engine.ts).
  const rowHeight = getMaxSectionHeight(config.sections);
  const rowShelves = getMaxSectionShelves(config.sections);

  const heightDrag = useDimensionDrag({
    axis: 'height',
    committedValue: rowHeight,
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
  const anyDragging = heightDrag.isDragging || widthDrag.isDragging;
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
  // Depth is read-only in this preview — no drag hook, straight from config.
  const visualDepth = config.depth;

  // The row's auto-fit scale is a function of *all* sections' total width.
  // `rowScale` here is the *committed* (idle) scale — it only ever changes
  // once a drag actually commits, never mid-drag.
  const rowScale = useMemo(
    () => computeRowScale(config.sections, MAX_ROW_WIDTH_PX, TARGET_FILL_PX),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(config.sections)],
  );
  // The idle/committed layout — what the row looks like right now, with
  // nothing being dragged. This alone determines section geometry whenever
  // width isn't actively dragging, and is also the frozen baseline the live
  // drag anchors to below (every section's own left edge and pixel width,
  // exactly as committed).
  const committedCenteredLayout = useMemo(
    () => layoutSectionsWithScale(config.sections, rowScale, VIEWBOX_W),
    // Keyed on every field that changes what gets drawn (width for proportions,
    // walls for WallPanels) — not just width, or a wall toggle with no width
    // change would leave `layout[i].section` (and its wall flags) stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(config.sections), rowScale],
  );
  // computeSectionLayout centres the row in the viewBox (shared with
  // TopShelvingPreview, which still wants that). Front View instead anchors
  // the row a fixed distance from the left edge, so the rack sits toward the
  // upper-left and grows rightward as sections are added, rather than
  // re-centring itself every time.
  const committedLeftShift = RACK_LEFT_MARGIN - committedCenteredLayout[0].x;
  const committedLayout = useMemo(
    () => committedCenteredLayout.map((s) => ({ ...s, x: s.x + committedLeftShift })),
    [committedCenteredLayout, committedLeftShift],
  );
  // Live width drag: same single-fixed-anchor principle height already
  // uses (bottom fixed, only top moves). The active section's own left edge
  // and every *other* section's own pixel width stay exactly as committed;
  // only the active section's width changes, and sections after it
  // translate to stay contiguous (see applyLiveActiveWidth). Its width uses
  // a freshly-computed auto-fit scale from `visualSections` — what the row
  // WOULD be if committed right now — not a scale frozen from whatever the
  // row looked like when the drag started: computeRowScale's auto-fit
  // depends on the row's total width, so a value dragged to (say) 700mm
  // must render at the exact same pixel width the row will actually use
  // once 700mm is committed, not the scale that applied at the drag's
  // starting width. This never re-centers the row or reflows any other
  // section — it only ever touches the one active section's width and the
  // x of sections after it.
  const layout = useMemo(() => {
    if (!widthDrag.isDragging) return committedLayout;
    const liveScale = computeRowScale(visualSections, MAX_ROW_WIDTH_PX, TARGET_FILL_PX);
    const liveActiveWidthPx = mmToPx('width', widthDrag.displayValue) * liveScale;
    return applyLiveActiveWidth(committedLayout, activeSection.id, liveActiveWidthPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthDrag.isDragging, widthDrag.displayValue, committedLayout, activeSection.id, JSON.stringify(visualSections)]);

  const heightPx = mmToPx('height', visualHeight) * RACK_SCALE;
  const top = FLOOR_Y - heightPx;
  const shelfYs = useMemo(() => computeShelfYs(top, heightPx, rowShelves), [top, heightPx, rowShelves]);
  const boundaryXs = useMemo(() => computeBoundaryXs(layout), [layout]);
  const frontHoleYs = useMemo(() => perforationYs(top, FLOOR_Y), [top]);

  // One color for every physical surface — uprights, shelves, panels all
  // read this same value (see rack-colors.ts) so front/rear/left/right
  // uprights can never visually diverge the way the old STEEL_FRONT/
  // STEEL_REAR constants did. Shading stays deliberately restrained (small
  // single-digit percentages) so every surface still clearly reads as one
  // painted material, not a second, darker "far" material.
  const fill = resolveRackFill(color);
  const lightFill = shade(fill, 4);
  const darkFill = shade(fill, -6);

  const depthPx = mmToPx('depth', visualDepth) * RACK_SCALE;
  const angleRad = (DEPTH_ANGLE_DEG * Math.PI) / 180;
  // The natural/preferred depth offset from a front-plane point to its
  // corresponding rear-plane point, before any density adjustment.
  const rawDepthVec = { dx: depthPx * Math.cos(angleRad), dy: -depthPx * Math.sin(angleRad) };
  // The one true depth offset actually used for every piece of rear-plane
  // geometry below — rear posts and wall panels draw their rear corners at
  // `+depthVec`, so shelves must use this exact same vector for their rear
  // corners too, or they visually stop short of the rear uprights
  // (previously a separate `shelfDepthVec` here was hard-halved, which is
  // exactly what left a gap between the shelf and the rear posts).
  //
  // Its vertical component is capped, only when shelf density actually
  // requires it, so a shelf's own receding top surface never rises far
  // enough to visually collide with the shelf immediately above it (the
  // "solid grey staircase" bug at high shelf counts / large depths — see
  // shelf-depth-projection.ts). The horizontal component is always left
  // untouched: it's the customer's actual visual cue for "how deep is this
  // rack", and a configuration that already has enough natural air gets its
  // ordinary, uncapped perspective back unchanged.
  const depthVec = computeRenderDepthVec(rawDepthVec, shelfYs);

  // One set of shelf-corner coordinates per section, computed once and
  // reused across all three shelf paint passes below (top surfaces, side
  // lips, front lips) — see the "3a/3b/3c" comment where they're rendered
  // for why that split exists and why every pass needs the exact same
  // corners.
  const shelfCornersBySection = useMemo(
    () =>
      layout.map((section) =>
        shelfYs.map((y) => ({
          frontLeft: { x: section.x, y: y - SHELF_FACE_OFFSET_PX },
          frontRight: { x: section.x + section.width, y: y - SHELF_FACE_OFFSET_PX },
          rearLeft: { x: section.x + depthVec.dx, y: y - SHELF_FACE_OFFSET_PX + depthVec.dy },
          rearRight: { x: section.x + section.width + depthVec.dx, y: y - SHELF_FACE_OFFSET_PX + depthVec.dy },
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(layout.map((s) => ({ x: s.x, width: s.width }))), shelfYs, depthVec.dx, depthVec.dy],
  );

  const rowStart = layout[0].x;
  const rowEnd = layout[layout.length - 1].x + layout[layout.length - 1].width;
  // Shelf-count column: far enough past the row's right edge to clear the
  // receding shelf surfaces of a deep rack instead of sitting on top of
  // them, capped so a deep row never pushes it outside the framed crop.
  const shelfColumnX = Math.min(
    rowEnd + SHELF_COLUMN_OFFSET + Math.min(depthVec.dx, SHELF_COLUMN_DEPTH_SHIFT),
    VIEWBOX_W - 16,
  );
  // The red height label stays exactly where it always has, to the left of
  // the rack — only the drag *handle* moves. Requirement: the handle must
  // sit on the top shelf/top structural edge, not floating to the side.
  // Deliberately offset from the row's horizontal centre (not centred on
  // it): the per-section "add" button already lives centred above each
  // section at this same height, and for the very common single-section
  // row that's the exact same point the row's centre would be — a 44px
  // circular hit-target directly concentric with another one makes the
  // lower control (z-index-wise) permanently unclickable, on short mobile
  // containers especially. Anchoring near the row's left edge instead keeps
  // the handle clearly on the rack's own top edge while never coinciding
  // with any section's add-button centre.
  const heightLabelPoint = { x: rowStart - 26, y: (top + FLOOR_Y) / 2 };
  const heightHandlePoint = { x: rowStart + 20, y: top };
  const activeGeom = layout.find((s) => s.id === activeSection.id) ?? layout[0];
  const widthHandlePoint = { x: activeGeom.x + activeGeom.width, y: (top + FLOOR_Y) / 2 };
  // Still used to position the read-only depth dimension tag below — see
  // the SVG dimension-tags block.
  const depthOrigin = { x: rowEnd, y: top + 10 };
  const depthEnd = { x: depthOrigin.x + depthVec.dx, y: depthOrigin.y + depthVec.dy };

  const totalLengthMm = widthDrag.isDragging
    ? config.sections.reduce((sum, s) => sum + (s.id === activeSection.id ? widthDrag.displayValue : s.width), 0)
    : config.sections.reduce((sum, s) => sum + s.width, 0);
  const canAdd = config.sections.length < MAX_SECTIONS;
  const canRemove = config.sections.length > MIN_SECTIONS;

  const showHint = interactive && !hasInteracted;
  const hint = t(CF['CF-021'], locale);
  const loadCaption = t(CT['CT-024'], locale, { N: config.loadCapacity });
  // Only highlight the active section's own +/− when there is a choice of
  // section at all — a single-section row has nothing to disambiguate.
  const markActive = interactive && config.sections.length > 1;

  const frameTop = tightFraming ? top + depthVec.dy - 30 : Math.min(0, top + depthVec.dy - 30);

  // Framed workspace crop (see computeFramedCrop): the rack fills the frame
  // far more confidently than the old fixed top-left 3/4 crop did, without a
  // single drawing coordinate changing. Sized from the COMMITTED height, so
  // committing a width — or adding/removing a section — never rescales the
  // workspace; a live height drag may only ever grow it, so a rack dragged
  // taller than its committed framing is not clipped mid-gesture.
  //
  // Both profiles are computed and published as custom properties; a media
  // query in globals.css decides which one the stage actually uses, so the
  // component never reads the viewport and there is nothing to hydrate.
  const committedTop = FLOOR_Y - mmToPx('height', rowHeight) * RACK_SCALE;
  const cropTopEdge = Math.min(committedTop, top);
  const cropFor = (profile: FrameProfile) =>
    computeFramedCrop(
      profile,
      Math.min(cropTopEdge - profile.top, cropTopEdge + depthVec.dy - 8),
      FLOOR_Y + profile.bottom,
      config.sections.length,
      depthVec.dx,
    );
  const wideCrop = cropFor(WIDE_FRAME);
  const compactCrop = cropFor(COMPACT_FRAME);
  const stageVars = (crop: ReturnType<typeof cropFor>, prefix: string) => ({
    [`--stage-${prefix}-w`]: `${(VIEWBOX_W / crop.w) * 100}%`,
    [`--stage-${prefix}-h`]: `${(VIEWBOX_H / crop.h) * 100}%`,
    [`--stage-${prefix}-l`]: `${(-crop.x / crop.w) * 100}%`,
    [`--stage-${prefix}-t`]: `${(-crop.y / crop.h) * 100}%`,
  });

  const drawing = (
    <>
      <svg viewBox={presentation && !interactive ? `0 ${frameTop} ${rowEnd + depthVec.dx + 50} ${FLOOR_Y + 110 - frameTop}` : `0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} className="h-full w-full" role="img" aria-label={t(CF['CF-006'], locale)}>
        {/* 0. Floor reference — one hairline for the rack's feet to stand on,
             in the lightest line token, behind every structural element. A
             single ground line, not a grid: no blueprint squares, no
             graph-paper texture, nothing that fills the white canvas. */}
        <line
          x1={rowStart - 34}
          y1={FLOOR_Y + FOOT_HEIGHT}
          x2={rowEnd + depthVec.dx + 20}
          y2={FLOOR_Y + FOOT_HEIGHT}
          stroke={DRAW_HAIRLINE}
          strokeWidth={1}
          pointerEvents="none"
        />

        {/* 1. Rear posts — the physical steel frame, always visible regardless
             of any wall selection (a rear post is not the same thing as the
             optional rearWall panel). Perforated the same way as the front
             posts, just shifted by depthVec to sit on the rear post's own
             centreline. Same fill as every other upright (see rack-colors.ts)
             — depth reads from the perspective offset and the thin edge
             stroke below, never from a darker "far" color. */}
        {boundaryXs.map((x, i) => (
          <g key={`rear-post-${i}`}>
            <rect
              x={x + depthVec.dx - POST_WIDTH / 2}
              y={top + depthVec.dy}
              width={POST_WIDTH}
              height={FLOOR_Y - top}
              fill={fill}
              stroke={darkFill}
              strokeWidth={0.5}
            />
            {frontHoleYs.map((y, hi) => (
              <circle key={hi} cx={x + depthVec.dx} cy={y + depthVec.dy} r={HOLE_RADIUS} fill="#FFFFFF" />
            ))}
          </g>
        ))}

        {/* 2. Wall panels — only when the customer actually selected them. */}
        {layout.map((section) => (
          <WallPanels key={`walls-${section.id}`} section={section} top={top} bottom={FLOOR_Y} depthVec={depthVec} darkFill={darkFill} lightFill={lightFill} />
        ))}

        {/* 3. Shelf planes — a receding top surface plus folded lips on the
             front edge AND both depth (side) edges, all fully opaque painted
             sheet metal (no transparency on any of them — a transparent top
             surface is exactly what made shelves read as glass/wireframe
             instead of solid plate). Depth reads from each lip being a shade
             darker than the top surface, not from opacity. White space
             between shelf levels stays untouched — no fill spans the full
             bay. The top surface's rear corners use the exact same
             `depthVec` as the rear posts/wall panels (not a shortened
             fraction of it), so the shelf visually reaches the rear
             uprights instead of stopping partway there. Side lips are
             derived from these exact same four corners (front-left,
             front-right, rear-left, rear-right) — never separate hardcoded
             coordinates — so they stay attached to the shelf at every
             depth.

             Split into three separate paint passes (3a/3b/3c below) instead
             of one self-contained group per shelf level. A single shelf's
             receding top surface is `5 + |depthVec.dy|` px tall — at deep
             depths and/or many shelves (8 shelves at a typical height puts
             consecutive shelf centrelines under 18px apart) that easily
             exceeds the spacing between shelf levels. With one group per
             shelf, a *lower* shelf's own top-surface polygon — painted
             after, so on top of — the shelf immediately above it would
             paint straight over that upper shelf's horizontal front lip,
             leaving only the diagonal side lips readable and making the
             whole rack look like one solid panel with diagonal "steps"
             instead of N distinct horizontal shelves. Painting every top
             surface first, then every side lip, then every front lip last
             (across all shelf levels) guarantees a front lip — which never
             overlaps another front lip, since lips are always far shorter
             than the shelf spacing — can never be hidden by any shelf's
             receding top surface, at any shelf count or depth. This also
             gives the correct visual priority: horizontal front lip on top
             (primary cue), side lips beneath it but above the top surfaces
             (secondary detail), top surfaces as the base wash. */}
        {layout.map((section, si) => (
          <g key={`shelf-tops-${section.id}`}>
            {shelfCornersBySection[si].map((c, i) => (
              <polygon
                key={i}
                data-shelf-part="top-surface"
                points={`${c.frontLeft.x},${c.frontLeft.y} ${c.frontRight.x},${c.frontRight.y} ${c.rearRight.x},${c.rearRight.y} ${c.rearLeft.x},${c.rearLeft.y}`}
                fill={fill}
              />
            ))}
          </g>
        ))}
        {/* 3b. Side lips — fill only, no stroke: at a shared boundary between
             two sections, one section's right lip and the next section's
             left lip land on the exact same coincident line, and stacking
             two identical opaque fills there is visually inert, but a
             stroke would double up into a visibly darker seam. */}
        {layout.map((section, si) => (
          <g key={`shelf-sidelips-${section.id}`}>
            {shelfCornersBySection[si].map((c, i) => (
              <g key={i}>
                <polygon
                  points={`${c.frontLeft.x},${c.frontLeft.y} ${c.rearLeft.x},${c.rearLeft.y} ${c.rearLeft.x},${c.rearLeft.y + SHELF_LIP_HEIGHT_PX} ${c.frontLeft.x},${c.frontLeft.y + SHELF_LIP_HEIGHT_PX}`}
                  fill={fill}
                />
                <polygon
                  points={`${c.frontRight.x},${c.frontRight.y} ${c.rearRight.x},${c.rearRight.y} ${c.rearRight.x},${c.rearRight.y + SHELF_LIP_HEIGHT_PX} ${c.frontRight.x},${c.frontRight.y + SHELF_LIP_HEIGHT_PX}`}
                  fill={fill}
                />
              </g>
            ))}
          </g>
        ))}
        {/* 3c. Front lips — see the paint-order note above: always the last
             shelf layer, so every one of these stays visible regardless of
             shelf count or depth. */}
        {layout.map((section, si) => (
          <g key={`shelf-frontlips-${section.id}`}>
            {shelfCornersBySection[si].map((c, i) => (
              <rect
                key={i}
                x={section.x}
                y={c.frontLeft.y}
                width={section.width}
                height={SHELF_LIP_HEIGHT_PX}
                fill={fill}
                stroke="#1C2024"
                strokeOpacity={0.16}
                strokeWidth={0.5}
              />
            ))}
          </g>
        ))}

        {/* 4. Front posts + feet. Same fill as the rear posts above — a tiny
             highlight stroke is the only thing distinguishing "closer to the
             viewer" from the rear posts' edge-shade stroke, per the "same
             color, subtle shading only" rule. Perforation holes punched down
             the centreline read as industrial upright steel rather than a
             plain bar — subtle (small, evenly spaced) so the rack doesn't
             turn visually noisy. */}
        {boundaryXs.map((x, i) => (
          <g key={`front-post-${i}`}>
            <rect x={x - POST_WIDTH / 2} y={top} width={POST_WIDTH} height={FLOOR_Y - top} fill={fill} stroke={lightFill} strokeWidth={0.5} />
            {frontHoleYs.map((y, hi) => (
              <circle key={hi} cx={x} cy={y} r={HOLE_RADIUS} fill="#FFFFFF" />
            ))}
            <rect x={x - FOOT_WIDTH / 2} y={FLOOR_Y} width={FOOT_WIDTH} height={FOOT_HEIGHT} fill={STEEL_FOOT} />
          </g>
        ))}

        {/* 4b. Selected section — a single hairline graphite rectangle just
             outside the section's own uprights. Deliberately an outline and
             not a tint: the white space between shelves must stay white, and
             a filled selection would read as a decorative panel. The mark is
             geometric, not colour-only — the section's width value below the
             rack also switches to graphite/semibold and its own +/- controls
             pick up a graphite ring — so selection stays legible without
             flooding the rack with accent colour. Only drawn when there is
             more than one section to tell apart. */}
        {markActive && (
          <rect
            x={activeGeom.x - 3}
            y={top - 7}
            width={activeGeom.width + 6}
            height={FLOOR_Y - top + 14}
            fill="none"
            stroke={DRAW_INK}
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {/* 5. Interactive hit-areas + hover-only outline. `activeSectionId`
             keeps driving real selection (width drag, SectionTable), but the
             visible dashed box now follows the pointer, not the selection —
             it must disappear the instant the pointer leaves, never persist. */}
        {layout.map((section, i) => {
          const isActive = interactive && section.id === activeSection.id;
          // The selected section already carries its own permanent graphite
          // outline (4b above), so hovering it must not stack a second box
          // on top of the first.
          const isHovered = interactive && section.id === hoveredSectionId && !(markActive && isActive);
          return (
            <g
              key={`hit-${section.id}`}
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
              className={interactive ? 'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blueprint' : undefined}
              style={interactive ? { cursor: 'pointer' } : undefined}
            >
              <rect x={section.x} y={top - 6} width={section.width} height={FLOOR_Y - top + 12} fill="transparent" />
              {isHovered && (
                <rect
                  x={section.x - 3}
                  y={top - 7}
                  width={section.width + 6}
                  height={FLOOR_Y - top + 14}
                  fill="none"
                  stroke={DRAW_INK_SOFT}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* 5b. Resize zones — invisible, generous hit areas that both (a)
             reveal the corresponding ResizeHandle marker on hover, and (b)
             are themselves a full drag surface: pointer-down anywhere in
             here starts the same drag the small circular marker starts,
             reusing the exact same widthDrag/heightDrag handlers (and
             therefore the exact same pointer-capture, math, clamping, and
             commit-on-release behavior) — there is still only one drag
             state machine per axis, just two DOM entry points into it. The
             circular ResizeHandle button remains fully functional on its
             own (keyboard focus still lives there, and its own small hit
             area still works for pointer input), it's just no longer the
             *only* way to grab a resize. Never just "somewhere on the white
             canvas" — each zone tracks the exact physical part of the rack
             it resizes. Painted after the section hit-areas so they take
             pointer priority over the broader per-section hover box in
             their (small, intentional) overlap near the corners.
             The height zone sits entirely above `top` and the width zone
             entirely at-or-below it (matching each one's own literal
             spec — the upright's own visible height for width, a strip
             centred on the top edge for height) so they meet at `top`
             without overlapping: since the width zone is painted after and
             therefore wins any shared pixel, an overlap here would make a
             press at the top-right corner of an upright silently always
             start a width drag, even where the pointer is arguably over
             the top edge, not the upright. */}
        {interactive && (
          <>
            <rect
              data-testid="height-resize-zone"
              x={rowStart - 14}
              y={top - 20}
              width={rowEnd - rowStart + 28}
              height={20}
              fill="transparent"
              style={{ cursor: 'ns-resize' }}
              onPointerEnter={() => setHeightZoneHovered(true)}
              onPointerLeave={() => setHeightZoneHovered(false)}
              onPointerDown={heightDrag.onPointerDown}
              onPointerMove={heightDrag.onPointerMove}
              onPointerUp={heightDrag.onPointerUp}
              onPointerCancel={heightDrag.onPointerCancel}
            />
            {layout.map((section) => (
              <rect
                key={`width-zone-${section.id}`}
                data-testid="width-resize-zone"
                x={section.x + section.width - 16}
                y={top}
                width={32}
                height={FLOOR_Y - top + 10}
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onPointerEnter={() => {
                  setWidthZoneHovered(true);
                  onSelectSection?.(section.id);
                }}
                onPointerLeave={() => setWidthZoneHovered(false)}
                onPointerDown={widthDrag.onPointerDown}
                onPointerMove={widthDrag.onPointerMove}
                onPointerUp={widthDrag.onPointerUp}
                onPointerCancel={widthDrag.onPointerCancel}
              />
            ))}
          </>
        )}

        {/* 6. Dimension system — thin steel extension lines with the value
             breaking each one, the way a real technical drawing reads. Every
             stroke here is one weight lighter than the rack's own edges so
             the measurement layer never competes with the product. Depth's
             tag is purely informational — read-only, always the committed
             config.depth, never "active" (there is no depth drag to be
             active for; see the component doc comment above). */}
        <g pointerEvents="none">
          {/* Height: a vertical extension line down the rack's left side,
               capped with short ticks at the floor and the top edge. */}
          <line x1={heightLabelPoint.x} y1={top} x2={heightLabelPoint.x} y2={FLOOR_Y} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={heightLabelPoint.x - 3.5} y1={top} x2={heightLabelPoint.x + 3.5} y2={top} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={heightLabelPoint.x - 3.5} y1={FLOOR_Y} x2={heightLabelPoint.x + 3.5} y2={FLOOR_Y} stroke={DRAW_LINE} strokeWidth={0.75} />
          {/* Depth: a leader following the rack's own perspective diagonal,
               from the front upright back to the rear plane. */}
          <line x1={depthOrigin.x} y1={depthOrigin.y} x2={depthEnd.x} y2={depthEnd.y} stroke={DRAW_LINE} strokeWidth={0.75} />
        </g>
        <DimensionTag x={heightLabelPoint.x} y={heightLabelPoint.y} label={`${Math.round(heightDrag.snapTarget ?? rowHeight)}`} active={heightDrag.isDragging} orientation="vertical" />
        <DimensionTag x={depthEnd.x} y={depthEnd.y} label={`${config.depth}`} active={false} orientation="horizontal" testId="depth-dimension-tag" />

        {layout.map((section) => {
          const isDraggingThis = widthDrag.isDragging && section.id === activeSection.id;
          return (
            <SectionWidthLabel
              key={`label-${section.id}`}
              x={section.x + section.width / 2}
              y={FLOOR_Y + 13}
              label={isDraggingThis ? (widthDrag.snapTarget ?? section.section.width) : section.section.width}
              active={isDraggingThis || (markActive && section.id === activeSection.id)}
            />
          );
        })}

        <TotalWidthLine x1={rowStart} x2={rowEnd} y={FLOOR_Y + 68} label={Math.round(totalLengthMm)} active={widthDrag.isDragging} />
      </svg>

      {interactive && (
        <>
          <ResizeHandle
            axis="height"
            ariaLabel={t(CF['CF-009'], locale, { H: rowHeight })}
            value={rowHeight}
            min={heightDrag.min}
            max={heightDrag.max}
            xPercent={(heightHandlePoint.x / VIEWBOX_W) * 100}
            yPercent={(heightHandlePoint.y / VIEWBOX_H) * 100}
            cursorClassName="cursor-ns-resize"
            isDragging={heightDrag.isDragging}
            zoneHovered={heightZoneHovered}
            onPointerEnter={() => setHeightZoneHovered(true)}
            onPointerLeave={() => setHeightZoneHovered(false)}
            onPointerDown={heightDrag.onPointerDown}
            onPointerMove={heightDrag.onPointerMove}
            onPointerUp={heightDrag.onPointerUp}
            onPointerCancel={heightDrag.onPointerCancel}
            onKeyDown={heightDrag.onKeyDown}
          />
          <ResizeHandle
            axis="width"
            ariaLabel={t(CF['CF-010'], locale, { W: activeSection.width })}
            value={activeSection.width}
            min={widthDrag.min}
            max={widthDrag.max}
            xPercent={(widthHandlePoint.x / VIEWBOX_W) * 100}
            yPercent={(widthHandlePoint.y / VIEWBOX_H) * 100}
            cursorClassName="cursor-ew-resize"
            isDragging={widthDrag.isDragging}
            zoneHovered={widthZoneHovered}
            onPointerEnter={() => setWidthZoneHovered(true)}
            onPointerLeave={() => setWidthZoneHovered(false)}
            onPointerDown={widthDrag.onPointerDown}
            onPointerMove={widthDrag.onPointerMove}
            onPointerUp={widthDrag.onPointerUp}
            onPointerCancel={widthDrag.onPointerCancel}
            onKeyDown={widthDrag.onKeyDown}
          />

          {/* One + above and one − below every section, anchored to the
              rack's own top/floor (not fixed container percentages) so they
              still hug the now much smaller rack at any height. The add
              control is the more prominent of the pair, per the reference.
              The add button specifically gets z-20 (above the resize
              handles' z-10): it now lives at the same top-of-rack height as
              the height handle, and on a short container two 44px circular
              targets can end up close enough that whichever is on top wins
              every click — the add button is the more frequently-used,
              harder-to-substitute control, so it wins. (The remove button
              and shelf-count controls sit at different heights that don't
              overlap anything, so they're left at the default stacking
              order — adding z-20 there too once regressed the width
              handle, which shares their vertical band.) */}
          {layout.map((section, i) => {
            const xPercent = ((section.x + section.width / 2) / VIEWBOX_W) * 100;
            const yPercent = ((top - 24) / VIEWBOX_H) * 100;
            const isActive = markActive && section.id === activeSection.id;
            return (
              <div key={`add-${section.id}`} className="absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: `${xPercent}%`, top: `${yPercent}%` }}>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => onAddSectionAfter?.(section.id)}
                  title={t(CF['CF-015'], locale, { N: i + 1 })}
                  aria-label={t(CF['CF-016'], locale, { N: i + 1 })}
                  className={CIRCLE_HIT}
                >
                  <span
                    aria-hidden="true"
                    className={`${CIRCLE_DISC} ${DISC_LARGE} ${isActive ? 'border-foreground' : 'border-line-strong'} bg-surface`}
                  >
                    +
                  </span>
                </button>
              </div>
            );
          })}
          {layout.map((section, i) => {
            const xPercent = ((section.x + section.width / 2) / VIEWBOX_W) * 100;
            const yPercent = ((FLOOR_Y + 44) / VIEWBOX_H) * 100;
            const isActive = markActive && section.id === activeSection.id;
            return (
              <div
                key={`remove-${section.id}`}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
              >
                <button
                  type="button"
                  disabled={!canRemove}
                  onClick={() => onRemoveSectionAt?.(section.id)}
                  title={t(CF['CF-017'], locale, { N: i + 1 })}
                  aria-label={t(CF['CF-018'], locale, { N: i + 1 })}
                  className={CIRCLE_HIT}
                >
                  <span
                    aria-hidden="true"
                    className={`${CIRCLE_DISC} ${DISC_SMALL} ${isActive ? 'border-foreground' : 'border-line-strong'} bg-surface`}
                  >
                    −
                  </span>
                </button>
              </div>
            );
          })}

          {/* Global shelf count — a compact vertical control column just off
              the rack's right edge, in the same circle language as the
              section add/remove controls. The two 44px hit areas overlap the
              count between them by design, so the column stays short. */}
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center -space-y-1.5"
            style={{
              left: `${(shelfColumnX / VIEWBOX_W) * 100}%`,
              top: `${(((top + FLOOR_Y) / 2) / VIEWBOX_H) * 100}%`,
            }}
          >
            <button type="button" aria-label={t(CF['CF-019'], locale)} onClick={onIncreaseShelves} disabled={rowShelves >= maxShelves} className={CIRCLE_HIT}>
              <span aria-hidden="true" className={`${CIRCLE_DISC} ${DISC_SMALL} border-line-strong bg-surface`}>
                +
              </span>
            </button>
            <span className="mono relative z-10 text-xs font-semibold leading-none text-foreground">{rowShelves}</span>
            <button type="button" aria-label={t(CF['CF-020'], locale)} onClick={onDecreaseShelves} disabled={rowShelves <= minShelves} className={CIRCLE_HIT}>
              <span aria-hidden="true" className={`${CIRCLE_DISC} ${DISC_SMALL} border-line-strong bg-surface`}>
                −
              </span>
            </button>
          </div>

          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </>
      )}
    </>
  );

  if (framed) {
    return (
      <div className={`bg-surface ${className}`}>
        {/* 6:5 on phones, the approved 4:3 from `sm` up. The top view frame in
            ConfiguratorClient carries the identical pair, so switching view
            never changes the workspace's height. */}
        <div className={`relative mx-auto aspect-[6/5] w-full overflow-hidden sm:aspect-[4/3] ${frameClassName}`}>
          <div
            ref={containerRef}
            data-testid="preview-stage"
            className="configurator-stage absolute"
            style={{ ...stageVars(compactCrop, 'c'), ...stageVars(wideCrop, 'w') } as CSSProperties}
          >
            {drawing}
          </div>
        </div>
        {/* Secondary technical strip: the first-run nudge and the load
            caption read as guidance under the drawing, never as headings —
            12px, steel, sentence case, no uppercase spec label. */}
        <div className="flex items-start justify-between gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs leading-snug text-steel sm:px-4">
          {/* First-run nudge — sits under the drawing, so it can never cover
              the rack or its controls at any width. */}
          <p className="min-w-0">{showHint ? hint : null}</p>
          <p className="mono shrink-0 whitespace-nowrap">{loadCaption}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative w-full overflow-hidden border border-line bg-surface ${className}`}>
      {drawing}

      {/* No opaque background — this is a first-run nudge, not a control,
          and must never visually cover the real section +/- buttons that
          share this bottom strip. */}
      {showHint && (
        <p className="tech-label pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 px-2 py-1 text-center text-steel drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
          {hint}
        </p>
      )}

      {interactive && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="tech-label absolute right-3 top-3 text-steel underline-offset-2 hover:text-foreground hover:underline"
        >
          {t(CF['CF-022'], locale)}
        </button>
      )}

      {showLoadCaption && <div className="tech-label pointer-events-none absolute bottom-2 right-3">{loadCaption}</div>}
    </div>
  );
}

// Exported so tests can derive real shelfYs the same way the component does,
// instead of re-deriving the spacing formula theoretically (see
// shelf-depth-projection.ts, whose collision math is meant to consume these
// exact coordinates).
//
// A shelf's upper face (its front lip's top edge and the front corners of its
// receding top surface) is drawn SHELF_FACE_OFFSET_PX above its y. The top
// shelf's y is placed exactly that far below `top`, so its upper face lies on
// the rack's physical top — the same `top` every upright and wall panel
// starts from — and nothing protrudes above it. Drawing only: the configured
// height, the price and the BOM never read these coordinates. The bottom
// shelf keeps its clearance above the floor.
export const SHELF_FACE_OFFSET_PX = 2;
const BOTTOM_SHELF_CLEARANCE_PX = 14;

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

/** Rear wall / left wall / right wall — only rendered when the customer
 * actually selected them. Fully opaque painted metal panels, same light-grey
 * family as the rest of the rack — no transparency, subtle shading only. */
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
        />
      )}
      {s.leftWall && (
        <polygon points={`${x},${top} ${x},${bottom} ${x + depthVec.dx},${bottom + depthVec.dy} ${x + depthVec.dx},${top + depthVec.dy}`} fill={lightFill} />
      )}
      {s.rightWall && (
        <polygon
          points={`${x + width},${top} ${x + width},${bottom} ${x + width + depthVec.dx},${bottom + depthVec.dy} ${x + width + depthVec.dx},${top + depthVec.dy}`}
          fill={lightFill}
        />
      )}
    </>
  );
}

/** The per-section width value under each section. Plain mono figures on the
 * white canvas — the old solid grey chip added a second row of filled blocks
 * under the rack for no extra information. `active` (the section being
 * dragged, or the selected one in a multi-section row) darkens it to graphite
 * and adds weight; it is never the only cue for either state. */
export function SectionWidthLabel({ x, y, label, active }: { x: number; y: number; label: number; active: boolean }) {
  return (
    <text
      x={x}
      y={y + 3.5}
      textAnchor="middle"
      fontFamily="IBM Plex Mono, monospace"
      fontSize={10}
      fontWeight={active ? 700 : 500}
      fill={active ? DRAW_INK : DRAW_INK_SOFT}
      pointerEvents="none"
    >
      {String(Math.round(label))}
    </text>
  );
}

/** A dimension value sitting on its own extension line: white label surface,
 * hairline steel border, graphite mono figures. `active` (the axis currently
 * being dragged) inverts it to solid graphite rather than switching hue, so
 * the drawing keeps a single neutral palette and the moving value is still
 * unmistakable. Its box size does not change with `active` — an active tag
 * that grew would nudge the drawing around mid-drag. */
export function DimensionTag({
  x,
  y,
  label,
  active,
  orientation,
  testId,
}: {
  x: number;
  y: number;
  label: string;
  active: boolean;
  orientation: 'vertical' | 'horizontal';
  /** Purely a test hook (no visual/behavioral effect) — several DimensionTag
   * instances render structurally-identical markup with only their number
   * differing, which a test can't otherwise reliably tell apart. */
  testId?: string;
}) {
  const w = Math.max(26, label.length * 6.6 + 11);
  const h = 15;
  const isVertical = orientation === 'vertical';
  return (
    <g transform={isVertical ? `rotate(-90 ${x} ${y})` : undefined} data-testid={testId} pointerEvents="none">
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={1.5}
        fill={active ? DRAW_INK : DRAW_PAPER}
        stroke={active ? DRAW_INK : DRAW_LINE}
        strokeWidth={0.75}
      />
      <text
        x={x}
        y={y + 3.4}
        textAnchor="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontSize={10}
        fontWeight={600}
        fill={active ? DRAW_PAPER : DRAW_INK}
      >
        {label}
      </text>
    </g>
  );
}

/** Thin dimension line + centred value under the whole row — no arrowheads,
 * no sentence-length label, and no colour of its own: the same steel hairline
 * and neutral tag every other dimension on this canvas uses. */
function TotalWidthLine({ x1, x2, y, label, active }: { x1: number; x2: number; y: number; label: number; active: boolean }) {
  const locale = useLocale();
  return (
    <g pointerEvents="none">
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={DRAW_LINE} strokeWidth={0.75} />
      <line x1={x1} y1={y - 3.5} x2={x1} y2={y + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
      <line x1={x2} y1={y - 3.5} x2={x2} y2={y + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
      <DimensionTag x={(x1 + x2) / 2} y={y + 14} label={`${label} ${t(G['G-008'], locale)}`} active={active} orientation="horizontal" />
    </g>
  );
}
