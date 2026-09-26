'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ColorOption, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import {
  VIEWBOX_H,
  VIEWBOX_W,
  clamp,
  depthVectorPx,
  fitPxPerMm,
  type DimensionAxis,
} from './resize/dimension-scale';
import { layoutSectionFrames, rackEnvelopeMm, SHELF_FACE_OFFSET_PX, type DimensionCapacityMm } from './resize/section-geometry';
import { useDimensionDrag } from './resize/useDimensionDrag';
import { ResizeHandle } from './resize/ResizeHandle';
import { MAX_SECTIONS, MIN_SECTIONS } from '@/store/configurator-store';
import { resolveRackFill, shade } from './rack-colors';
import { computeRenderDepthVecForSections, SHELF_LIP_HEIGHT_PX } from './shelf-depth-projection';
import { t } from '@/lib/i18n/format';
import { CF, CT, G } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Dynamic, formula-free CAD-style SVG preview of the current configuration.
 * Built entirely from primitive shapes scaled to the customer's selections —
 * there is no per-configuration static image to keep in sync.
 *
 * True physical geometry (V2.3): the whole rack is drawn at ONE uniform
 * scale (`pxPerMm`, see dimension-scale.ts's `fitPxPerMm`), so widths,
 * heights and the shared depth keep their real millimetre ratios. Depth is
 * global to the whole row; width, height, shelves and wall panels belong to
 * each section, and every section is drawn from its own values (see
 * section-geometry.ts's `layoutSectionFrames`): its own width, its own height
 * standing on the common floor line, its own shelf planes. Sections never
 * share an upright (V2.2B: four per section), so each section draws its own
 * left and right upright pair, ending flush with its own top shelf — a
 * shorter section's uprights stop below a taller neighbour's. Rear posts are
 * always drawn — they are the physical steel frame, not the optional
 * `rearWall` panel — so removing a wall never removes structure.
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

// Exported so tests can reproduce ShelvingPreview's exact geometry pipeline
// (rackEnvelopeMm → fitPxPerMm → layoutSectionFrames, and the adaptive depth
// projection's shelfYs inputs) instead of duplicating magic numbers that
// could silently drift out of sync.
export const FLOOR_Y = 250;
// The top view's own (pre-V2.3, non-physical) row auto-fit — it keeps its
// framing unchanged; the front view no longer reads these.
export const MAX_ROW_WIDTH_PX = 300;
export const TARGET_FILL_PX = 260;
// The row's left edge. The rack anchors here and grows rightward as sections
// are added or widened, so a width drag never moves the dragged section's own
// left edge or anything before it.
export const RACK_LEFT_MARGIN = 60;
/** Every upright's drawn width. Each section's two uprights sit just inside
 * its own width, so two neighbouring sections show two uprights side by side
 * at their junction — never one shared post. */
export const POST_WIDTH = 5;
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
   Dimension text readability (V2.4). Labels are drawn in viewBox units; the
   stage's measured size says how many CSS pixels one unit is, and below
   MIN_LABEL_PX a label is scaled up rather than rendered unreadably small.
   --------------------------------------------------------------------------- */
/** Font size of every dimension label, in viewBox units, at scale 1. */
const LABEL_FONT = 10;
/** Height of a dimension tag's label surface, in viewBox units, at scale 1. */
const DIMENSION_TAG_H = 15;
/** The smallest on-screen size dimension text is allowed to render at. */
const MIN_LABEL_PX = 11;
/** Never enlarge beyond this — the reserved margins are sized for it. */
const MAX_LABEL_SCALE = 1.7;
/** Past this enlargement space is tight enough to drop the depth tag. */
const TIGHT_LABEL_SCALE = 1.15;

/** Approximate rendered width of a mono section-width label, in viewBox units. */
function sectionLabelWidth(label: number, scale: number): number {
  return String(Math.round(label)).length * 0.62 * LABEL_FONT * scale;
}

/**
 * The framed stage, measured: CSS pixels per viewBox unit (the stage resolves
 * to the full viewBox at the crop's zoom, so its rendered width over
 * VIEWBOX_W is exactly that) and the visible frame's width in viewBox units
 * (which says which crop profile the CSS applied). Display-only: it sizes
 * label text and spaces the overlaid controls; it never feeds drawing
 * geometry, drag math, configuration or pricing. `null` until measured (and
 * wherever ResizeObserver is unavailable), which leaves labels and control
 * offsets at their defaults.
 */
interface StageMetrics {
  unitPx: number;
  frameUnits: number;
}

function useStageMetrics(ref: RefObject<HTMLElement | null>, enabled: boolean): StageMetrics | null {
  const [metrics, setMetrics] = useState<StageMetrics | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = el.getBoundingClientRect().width;
      const frameWidth = el.parentElement?.getBoundingClientRect().width ?? 0;
      const unitPx = width / VIEWBOX_W;
      setMetrics(width > 0 && frameWidth > 0 ? { unitPx, frameUnits: frameWidth / unitPx } : null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return metrics;
}

/* ---------------------------------------------------------------------------
   Overlaid control spacing (V2.4). The circular controls are HTML buttons
   sized in CSS pixels, while the rack they sit on is drawn in viewBox units —
   so on a narrow section (a 700 mm section on a phone is ~25–30 px wide) the
   section's "+" above its top edge, the height handle on that edge and the
   width handle on its upright would all land within one touch target. Their
   positions are therefore spaced in measured pixels: only where the controls
   are drawn changes, never the drawing, its scale or the drag math.
   --------------------------------------------------------------------------- */
/** Centre-to-centre distance that keeps two 44 px touch targets apart. */
const CONTROL_SPACING_PX = 44;
/** Radius of the section "+" disc (27 px) plus a small margin inside the frame. */
const ADD_DISC_CLEARANCE_PX = 16;
/** Radius of a resize-handle disc (18 px) plus a small margin. */
const HANDLE_DISC_CLEARANCE_PX = 11;

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
 * in CSS (see `.configurator-stage` / `.configurator-frame-box` in
 * globals.css) — this component publishes both as custom properties and
 * never measures the viewport for them.
 *
 *  - `WIDE_FRAME` is the desktop/tablet framing: 46 units of room left of
 *    the row, and the deepest possible shelf-column offset reserved whatever
 *    depth is configured.
 *  - `COMPACT_FRAME` applies to phones only. It reserves only what is really
 *    drawn: the room the height dimension actually needs on the left, and
 *    the shelf column's real offset at the *committed* depth. Depth is never
 *    dragged (it changes only through the parameter select), so reading it
 *    here cannot rescale the workspace mid-gesture the way reading a section
 *    width would.
 *
 * V2.4: the frame's ratio follows the physical envelope it shows (see
 * `computeFramedCrop`) within each profile's bounds — a lone section gets a
 * taller, narrower frame and a five-section row a wide, low one — instead of
 * one fixed ratio that left a small rack floating in empty frame. Like the
 * crop, the ratio depends only on the section count (and, compact, the
 * committed depth), so no width or height drag and no commit of one ever
 * changes it.
 */
export interface FrameProfile {
  /** Bounds of the frame's width ÷ height. The crop always takes the
   * frame's ratio: the envelope's own ratio, clamped into these bounds. */
  minAspect: number;
  maxAspect: number;
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
  /** Minimum room reserved right of the shelf-count column for its own touch
   * radius — never less than the exact amount at NARROWEST_FRAME_PX, which a
   * wide physical row can exceed — or null to reserve exactly that amount. */
  touchReserve: number | null;
}

export const WIDE_FRAME: FrameProfile = {
  minAspect: 1,
  maxAspect: 1.8,
  left: RACK_LEFT_MARGIN - 46,
  top: 54,
  bottom: 94,
  depthAllowance: SHELF_COLUMN_DEPTH_SHIFT,
  touchReserve: TOUCH_RADIUS_CLEARANCE,
};

export const COMPACT_FRAME: FrameProfile = {
  minAspect: 0.9,
  maxAspect: 1.8,
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
 * sections — the widest that row can become, plus the shelf-count column at
 * its furthest offset, plus that column's own touch radius.
 *
 * A ceiling, never a measurement of the current section widths. The crop
 * drives the stage's zoom, and a zoom that changed when a width was committed
 * would move the rack under the pointer at the exact moment a drag is
 * released. The front view passes `rowCeilingPx` — its physical envelope row
 * (every section at the catalog's widest width, see `rackEnvelopeMm`); the top
 * view omits it and keeps its own legacy ceilings (a lone section at
 * TARGET_FILL_PX, any longer row at MAX_ROW_WIDTH_PX).
 */
export function framedCropWidth(
  profile: FrameProfile,
  sectionCount: number,
  depthShiftPx = SHELF_COLUMN_DEPTH_SHIFT,
  rowCeilingPx?: number,
): number {
  const rowCeiling = rowCeilingPx ?? (sectionCount <= 1 ? TARGET_FILL_PX : MAX_ROW_WIDTH_PX);
  const shelfColumn = profile.depthAllowance ?? clamp(depthShiftPx, 0, SHELF_COLUMN_DEPTH_SHIFT);
  const base = RACK_LEFT_MARGIN + rowCeiling + SHELF_COLUMN_OFFSET + shelfColumn - profile.left;
  const solved = base / (1 - TOUCH_RADIUS_PX / NARROWEST_FRAME_PX);
  return profile.touchReserve !== null ? Math.max(base + profile.touchReserve, solved) : solved;
}

/**
 * The rectangle of the 640×480 viewBox that the framed workspace actually
 * shows, in viewBox units, and the frame ratio it implies. Exported so tests
 * can assert the framing without re-deriving it.
 *
 * Framing only: no drawing geometry, no drag math and no interactive position
 * depends on this. `useDimensionDrag` measures the stage element, which still
 * represents the full viewBox at whatever zoom the crop implies, so
 * pointer-to-millimetre sensitivity is unchanged at every crop — and the
 * stage stays exactly 4:3 in real pixels at any frame ratio, because its
 * width and height are taken from `w` and `h` independently.
 *
 * In the configurator the crop's *size* is a function of the section count
 * and (compact profile only) the committed depth — never of a section's width
 * or height: the front view frames its physical envelope (see
 * `rackEnvelopeMm`), the largest rack that count can be dragged to. So no
 * width or height drag, and no commit of one, ever rescales the workspace;
 * only adding or removing a section does.
 *
 * The frame ratio is the envelope's own (content width ÷ content height),
 * clamped into the profile's bounds, so the frame hugs the drawing instead of
 * surrounding it with a fixed-ratio margin. Whatever horizontal slack remains
 * is split around `rowCenterX` — the envelope row's own centre — so a short
 * row sits in the middle of its frame rather than against the left edge. That
 * can place the crop's left edge before the viewBox origin: the room there is
 * plain white frame, since nothing is ever drawn left of x = 0.
 */
export function computeFramedCrop(
  profile: FrameProfile,
  contentTop: number,
  contentBottom: number,
  sectionCount: number,
  depthShiftPx?: number,
  rowCeilingPx?: number,
  rowCenterX?: number,
) {
  const minW = framedCropWidth(profile, sectionCount, depthShiftPx, rowCeilingPx);
  const needed = Math.max(contentBottom - contentTop, 1);
  const aspect = clamp(minW / needed, profile.minAspect, profile.maxAspect);
  const w = clamp(Math.max(needed * aspect, minW), 1, Math.min(VIEWBOX_W, VIEWBOX_H * aspect));
  const h = w / aspect;
  const contentLeft = profile.left;
  const x =
    w >= minW
      ? // Centre the row within the slack, never cutting into the content box.
        clamp((rowCenterX ?? contentLeft + minW / 2) - w / 2, contentLeft + minW - w, contentLeft)
      : clamp(contentLeft - (w - minW) / 2, 0, VIEWBOX_W - w);
  return {
    x,
    y: clamp((contentTop + contentBottom) / 2 - h / 2, 0, VIEWBOX_H - h),
    w,
    h,
    aspect,
  };
}

export type FramedCrop = ReturnType<typeof computeFramedCrop>;

/**
 * Both profiles' crops for a configuration, from its COMMITTED sections and
 * depth. With `capacityMm` (the configurator) the envelope — the largest rack
 * this section count can become — always contains every live drag value, so
 * the result is the same before, during and after a drag. Shared with the top
 * view's frame (ConfiguratorClient), so switching preview mode never changes
 * the workspace's size.
 */
export function computeFramedCrops(
  sections: readonly ShelvingSection[],
  depth: number,
  capacityMm?: DimensionCapacityMm,
): { wide: FramedCrop; compact: FramedCrop } {
  const envelope = rackEnvelopeMm(sections, depth, capacityMm);
  const pxPerMm = fitPxPerMm(envelope);
  const frames = layoutSectionFrames(sections, pxPerMm, RACK_LEFT_MARGIN, FLOOR_Y);
  const rowTop = Math.min(...frames.map((f) => f.top));
  const rowWidth = frames.reduce((sum, f) => sum + f.width, 0);
  const depthVec = computeRenderDepthVecForSections(
    depthVectorPx(depth, pxPerMm),
    frames.map((f) => f.shelfYs),
  );
  const envelopeTop = FLOOR_Y - envelope.height * pxPerMm;
  const envelopeRearTop = envelopeTop + depthVectorPx(envelope.depth, pxPerMm).dy;
  const rowCeiling = Math.max(envelope.rowWidth * pxPerMm, rowWidth);
  const cropFor = (profile: FrameProfile) =>
    computeFramedCrop(
      profile,
      Math.min(envelopeTop - profile.top, envelopeRearTop - 8, rowTop - profile.top, rowTop + depthVec.dy - 8),
      FLOOR_Y + profile.bottom,
      sections.length,
      depthVec.dx,
      rowCeiling,
      RACK_LEFT_MARGIN + rowCeiling / 2,
    );
  return { wide: cropFor(WIDE_FRAME), compact: cropFor(COMPACT_FRAME) };
}

/** The frame-ratio custom properties both preview modes' frames read (see
 * `.configurator-frame-box` in globals.css). */
export function frameAspectVars(crops: { wide: FramedCrop; compact: FramedCrop }): CSSProperties {
  return { '--frame-c-aspect': String(crops.compact.aspect), '--frame-w-aspect': String(crops.wide.aspect) } as CSSProperties;
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
  /** The model's largest width/height/depth (from the catalog). When given,
   * the drawing's physical scale and framing are fitted to the largest rack
   * this section count can become instead of the current one, so neither
   * changes during or after a width/height drag (see `rackEnvelopeMm`). The
   * configurator passes it; static previews omit it and fit their rack. */
  capacityMm?: DimensionCapacityMm;
  activeSectionId?: string;
  onSelectSection?: (id: string) => void;
  onAddSectionAfter?: (id: string) => void;
  onRemoveSectionAt?: (id: string) => void;
  onCommitDimension?: (axis: DimensionAxis, value: number) => void;
  /** The ACTIVE section's shelf count controls — its own min/max (from its
   * own height), rendered in a column just past the row's right edge at that
   * section's mid-height. */
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
  capacityMm,
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
  const activeIndex = Math.max(0, config.sections.indexOf(activeSection));
  // V2.4: the height handle, the height dimension and the shelf-count column
  // all belong to the ACTIVE section — its own height and shelf count, never
  // a row-wide value. The caller passes that section's own allowed heights
  // and shelf range.
  const stageMetrics = useStageMetrics(containerRef, framed);
  const stageUnitPx = stageMetrics?.unitPx ?? null;
  // Dimension text is drawn in viewBox units, so on a phone that shows a long
  // row (a small zoom) it would shrink below readable size. Below
  // MIN_LABEL_PX it is scaled up to stay readable instead; the purely
  // informational depth tag (depth is also in the kit parameters) is dropped
  // once space is that tight, rather than crowding the rest.
  const labelScale = stageUnitPx ? clamp(MIN_LABEL_PX / (LABEL_FONT * stageUnitPx), 1, MAX_LABEL_SCALE) : 1;
  const tightLabels = labelScale > TIGHT_LABEL_SCALE;

  // One uniform physical scale — viewBox units per millimetre — for every
  // section's width and height and for the shared depth. It is a function of
  // COMMITTED state only (and, in the configurator, of the section count and
  // the catalog's largest dimensions alone — see rackEnvelopeMm), never of a
  // live drag value, so it cannot change during a gesture; useDimensionDrag
  // converts the pointer with this exact scale.
  const envelope = rackEnvelopeMm(config.sections, config.depth, capacityMm);
  const pxPerMm = fitPxPerMm(envelope);

  const heightDrag = useDimensionDrag({
    axis: 'height',
    committedValue: activeSection.height,
    allowedValues: allowedDimensions?.heights ?? NO_ALLOWED,
    containerRef,
    pxPerMm,
    onCommit: commit,
    onAnnounce: setAnnouncement,
  });
  const widthDrag = useDimensionDrag({
    axis: 'width',
    committedValue: activeSection.width,
    allowedValues: allowedDimensions?.widths ?? NO_ALLOWED,
    containerRef,
    pxPerMm,
    onCommit: commit,
    onAnnounce: setAnnouncement,
  });
  const anyDragging = heightDrag.isDragging || widthDrag.isDragging;
  useEffect(() => {
    if (anyDragging) setHasInteracted(true);
  }, [anyDragging]);

  // The frame geometry always follows the continuous drag value (smooth
  // resize); only the dimension *labels* jump to the snapped target so the
  // customer can see what will actually be committed on release. A live value
  // replaces exactly what its commit will change — the active section's own
  // width or height, and nothing on any other section — once the pointer has
  // actually moved it off the committed value (a press without movement
  // commits nothing, so it must not redraw anything either).
  const liveHeight =
    heightDrag.isDragging && heightDrag.displayValue !== activeSection.height ? heightDrag.displayValue : null;
  const visualSections: ShelvingSection[] = config.sections.map((s) =>
    s.id === activeSection.id
      ? {
          ...s,
          width: widthDrag.isDragging ? widthDrag.displayValue : s.width,
          height: liveHeight ?? s.height,
        }
      : s,
  );
  // Depth is read-only in this preview — no drag hook, straight from config.
  const visualDepth = config.depth;

  // Per-section world geometry at the one scale: own x/width, own top on the
  // common floor, own shelf planes. Anchored at RACK_LEFT_MARGIN, so a live
  // width drag leaves the active section's left edge and every earlier
  // section untouched and only translates the sections after it.
  const frames = layoutSectionFrames(visualSections, pxPerMm, RACK_LEFT_MARGIN, FLOOR_Y);
  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const rowStart = firstFrame.x;
  const rowEnd = lastFrame.x + lastFrame.width;
  // The tallest section's top — the rack's overall height.
  const rowTop = Math.min(...frames.map((f) => f.top));
  // The active section's live geometry: the width handle rides on its right
  // upright, the height handle on its own top edge.
  const activeGeom = frames.find((f) => f.id === activeSection.id) ?? firstFrame;

  // Each section's own two uprights, on the centrelines just inside its own
  // width — neighbouring sections stand side by side, never on a shared post
  // — each running from the floor up to its OWN section's top (flush top).
  const uprights = frames.flatMap((f, sectionIndex) => [
    { key: `${f.id}-left`, sectionIndex, x: f.x + POST_WIDTH / 2, top: f.top },
    { key: `${f.id}-right`, sectionIndex, x: f.x + f.width - POST_WIDTH / 2, top: f.top },
  ]);

  // One color for every physical surface — uprights, shelves, panels all
  // read this same value (see rack-colors.ts) so front/rear/left/right
  // uprights can never visually diverge the way the old STEEL_FRONT/
  // STEEL_REAR constants did. Shading stays deliberately restrained (small
  // single-digit percentages) so every surface still clearly reads as one
  // painted material, not a second, darker "far" material.
  const fill = resolveRackFill(color);
  const lightFill = shade(fill, 4);
  const darkFill = shade(fill, -6);

  // The shared depth at the SAME pxPerMm as width and height, along the
  // receding diagonal — the natural offset from a front-plane point to its
  // corresponding rear-plane point, before any density adjustment.
  const rawDepthVec = depthVectorPx(visualDepth, pxPerMm);
  // The one true depth offset actually used for every piece of rear-plane
  // geometry below — rear posts, wall panels and every shelf's rear corners
  // all use this exact same vector, so a shelf always reaches its own rear
  // uprights.
  //
  // Its vertical component is capped, only when shelf density actually
  // requires it, so a shelf's own receding top surface never rises far
  // enough to visually collide with the shelf immediately above it (the
  // "solid grey staircase" bug at high shelf counts / large depths — see
  // shelf-depth-projection.ts). Depth is shared by the whole rack, so the
  // densest section decides. The horizontal component is always left
  // untouched: it's the customer's actual visual cue for "how deep is this
  // rack", and a configuration that already has enough natural air gets its
  // ordinary, uncapped perspective back unchanged.
  const depthVec = computeRenderDepthVecForSections(
    rawDepthVec,
    frames.map((f) => f.shelfYs),
  );

  // One set of shelf-corner coordinates per section, from that section's own
  // shelf planes and spanning its own two upright centrelines, reused across
  // all three shelf paint passes below (top surfaces, side lips, front lips)
  // — see the "3a/3b/3c" comment where they're rendered for why that split
  // exists and why every pass needs the exact same corners.
  const shelfCornersBySection = frames.map((f) => {
    const left = f.x + POST_WIDTH / 2;
    const right = f.x + f.width - POST_WIDTH / 2;
    return f.shelfYs.map((y) => ({
      frontLeft: { x: left, y: y - SHELF_FACE_OFFSET_PX },
      frontRight: { x: right, y: y - SHELF_FACE_OFFSET_PX },
      rearLeft: { x: left + depthVec.dx, y: y - SHELF_FACE_OFFSET_PX + depthVec.dy },
      rearRight: { x: right + depthVec.dx, y: y - SHELF_FACE_OFFSET_PX + depthVec.dy },
    }));
  });

  // Shelf-count column: far enough past the row's right edge to clear the
  // receding shelf surfaces of a deep rack instead of sitting on top of
  // them, capped so a deep row never pushes it outside the framed crop.
  const shelfColumnX = Math.min(
    rowEnd + SHELF_COLUMN_OFFSET + Math.min(depthVec.dx, SHELF_COLUMN_DEPTH_SHIFT),
    VIEWBOX_W - 16,
  );
  // The height label stays to the left of the rack, measuring the ACTIVE
  // section's height from the floor to its own top plane (a hairline
  // extension carries that level across when the active section is not the
  // first); only the drag *handle* sits on the rack. Requirement: the handle
  // must sit on the top shelf/top structural edge, not floating to the side —
  // the active section's, since the drag changes its height. Deliberately
  // offset from the section's horizontal centre (not centred on it): the
  // per-section "add" button already lives centred above each section, and a
  // 44px circular hit-target directly concentric with another one makes the
  // lower control (z-index-wise) permanently unclickable, on short mobile
  // containers especially. Anchoring near the section's left edge instead
  // keeps the handle clearly on the rack's own top edge. A tag enlarged for
  // readability moves just far enough right to stay inside the reserved
  // left margin.
  const heightLabelPoint = {
    x: Math.max(rowStart - 26, rowStart - 34 + (DIMENSION_TAG_H * labelScale) / 2),
    y: (activeGeom.top + FLOOR_Y) / 2,
  };
  // Still used to position the read-only depth dimension tag below — see
  // the SVG dimension-tags block.
  const depthOrigin = { x: rowEnd, y: lastFrame.top + 10 };
  const depthEnd = { x: depthOrigin.x + depthVec.dx, y: depthOrigin.y + depthVec.dy };

  // Height resize discovery/drag strips: one along each section's own top
  // edge (the row's two ends extended outward). Pressing a section's strip
  // resizes THAT section: a strip of a section that is not yet active selects
  // it first — synchronously, so the drag starts from that section's own
  // committed height and allowed heights — then starts the same drag.
  const heightZones = frames.map((f, i) => {
    const x1 = f.x - (i === 0 ? 14 : 0);
    const x2 = f.x + f.width + (i === frames.length - 1 ? 14 : 0);
    return { id: f.id, path: `M${x1} ${f.top - 20}H${x2}V${f.top}H${x1}Z` };
  });
  // Width zones (each section's right upright) work the same way. Neither
  // kind selects a section on mere hover: V2.4's panel expands the active
  // section's controls, and a selection that followed the pointer across
  // uprights — or landed on a neighbour when a drag was released over its
  // upright — would swap the open controls under the customer.
  function startZoneDrag(drag: typeof heightDrag, e: ReactPointerEvent<Element>, sectionId: string) {
    if (sectionId !== activeSection.id && onSelectSection) flushSync(() => onSelectSection(sectionId));
    drag.onPointerDown(e);
  }

  const totalLengthMm = visualSections.reduce((sum, s) => sum + s.width, 0);
  const canAdd = config.sections.length < MAX_SECTIONS;
  const canRemove = config.sections.length > MIN_SECTIONS;

  const showHint = interactive && !hasInteracted;
  const hint = t(CF['CF-021'], locale);
  const loadCaption = t(CT['CT-024'], locale, { N: config.loadCapacity });
  // Only highlight the active section's own +/− when there is a choice of
  // section at all — a single-section row has nothing to disambiguate.
  const markActive = interactive && config.sections.length > 1;
  const sectionName = t(CF['CF-025'], locale, { N: activeIndex + 1 });

  const frameTop = tightFraming ? rowTop + depthVec.dy - 30 : Math.min(0, rowTop + depthVec.dy - 30);

  // Framed workspace crop (see computeFramedCrops): frames the physical
  // envelope the scale was fitted to — in the configurator the largest rack
  // this section count can become — so committing or dragging a width or a
  // height never rescales the workspace or moves the rack under the pointer.
  //
  // Both profiles are computed and published as custom properties; a media
  // query in globals.css decides which one the stage and the frame ratio
  // actually use, so the crop never depends on reading the viewport and there
  // is nothing to hydrate.
  const crops = computeFramedCrops(config.sections, config.depth, capacityMm);
  const wideCrop = crops.wide;
  const compactCrop = crops.compact;

  // Overlaid control positions, spaced in measured pixels (see
  // CONTROL_SPACING_PX). Unmeasured (static render, tests), every offset
  // falls back to its fixed viewBox default.
  const pxToUnits = (value: number) => (stageUnitPx ? value / stageUnitPx : 0);
  const spacing = pxToUnits(CONTROL_SPACING_PX);
  // The crop the CSS actually applied — the one whose width matches the
  // visible frame — bounds how far above a section its "+" can rise.
  const appliedCrop = stageMetrics
    ? Math.abs(stageMetrics.frameUnits - wideCrop.w) <= Math.abs(stageMetrics.frameUnits - compactCrop.w)
      ? wideCrop
      : compactCrop
    : null;
  const addTopLimit = appliedCrop ? appliedCrop.y + pxToUnits(ADD_DISC_CLEARANCE_PX) : Number.NEGATIVE_INFINITY;
  /** Each section's "+": at least one touch target above its own top edge
   * (never less than the default 24 units), as far as the frame allows. */
  const addButtonY = (top: number) => Math.min(top - 24, Math.max(top - Math.max(24, spacing), addTopLimit));
  // The height handle rides the active section's top edge near one end —
  // a quarter of the way in on a narrow section, away from the "+" centred
  // above it — on the end clearer of every section's "+" (a shorter
  // neighbour's "+" can sit level with this top edge). Only when the frame
  // leaves no room to lift the section's own "+" a full target (a narrow
  // section at the tallest height on a small phone) is the handle lowered by
  // the missing distance, onto the top of the upright. Side and offset come
  // from the COMMITTED layout, so neither changes during a drag and the
  // handle keeps following the pointer 1:1.
  const committedFrames = layoutSectionFrames(config.sections, pxPerMm, RACK_LEFT_MARGIN, FLOOR_Y);
  const committedActive = committedFrames[activeIndex] ?? committedFrames[0];
  const handleDrop = Math.min(
    Math.max(0, spacing - (committedActive.top - addButtonY(committedActive.top))),
    (FLOOR_Y - committedActive.top) * 0.4,
  );
  const handleInset = (width: number) => Math.min(20, width / 4);
  const clearanceFromAdds = (x: number) =>
    Math.min(
      ...committedFrames.map((f) => Math.hypot(x - (f.x + f.width / 2), committedActive.top + handleDrop - addButtonY(f.top))),
    );
  // The left end is preferred (the right one is shared with the width
  // handle); the right end is used only when the left is crowded and the
  // right is clearer.
  const leftClearance = clearanceFromAdds(committedActive.x + handleInset(committedActive.width));
  const handleOnRight =
    spacing > 0 &&
    leftClearance < spacing &&
    clearanceFromAdds(committedActive.x + committedActive.width - handleInset(committedActive.width)) > leftClearance;
  const heightHandlePoint = {
    x: handleOnRight ? activeGeom.x + activeGeom.width - handleInset(activeGeom.width) : activeGeom.x + handleInset(activeGeom.width),
    y: activeGeom.top + handleDrop,
  };
  // The width handle rides the active section's right upright at mid-height,
  // moved down (never below the floor) when that would be within one target
  // of the height handle — the case of a short section.
  const widthHandlePoint = {
    x: activeGeom.x + activeGeom.width,
    y: Math.min(FLOOR_Y - pxToUnits(HANDLE_DISC_CLEARANCE_PX), Math.max((activeGeom.top + FLOOR_Y) / 2, heightHandlePoint.y + spacing)),
  };
  const stageVars = (crop: FramedCrop, prefix: string) => ({
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
             stroke below, never from a darker "far" color. Every section has
             its own rear pair, rising to its own top. */}
        {uprights.map((u) => (
          <g key={`rear-post-${u.key}`}>
            <rect
              data-upright="rear"
              data-section-index={u.sectionIndex}
              x={u.x + depthVec.dx - POST_WIDTH / 2}
              y={u.top + depthVec.dy}
              width={POST_WIDTH}
              height={FLOOR_Y - u.top}
              fill={fill}
              stroke={darkFill}
              strokeWidth={0.5}
            />
            {perforationYs(u.top, FLOOR_Y).map((y, hi) => (
              <circle key={hi} cx={u.x + depthVec.dx} cy={y + depthVec.dy} r={HOLE_RADIUS} fill="#FFFFFF" />
            ))}
          </g>
        ))}

        {/* 2. Wall panels — only when the customer actually selected them,
             each on its own section's uprights and up to its own top. */}
        {frames.map((f, si) => (
          <g key={`walls-${f.id}`} data-section-index={si}>
            <WallPanels
              section={f.section}
              left={f.x + POST_WIDTH / 2}
              right={f.x + f.width - POST_WIDTH / 2}
              top={f.top}
              bottom={FLOOR_Y}
              depthVec={depthVec}
              darkFill={darkFill}
              lightFill={lightFill}
            />
          </g>
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
        {frames.map((f, si) => (
          <g key={`shelf-tops-${f.id}`}>
            {shelfCornersBySection[si].map((c, i) => (
              <polygon
                key={i}
                data-shelf-part="top-surface"
                data-section-index={si}
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
        {frames.map((f, si) => (
          <g key={`shelf-sidelips-${f.id}`}>
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
        {frames.map((f, si) => (
          <g key={`shelf-frontlips-${f.id}`}>
            {shelfCornersBySection[si].map((c, i) => (
              <rect
                key={i}
                data-shelf-part="front-lip"
                data-section-index={si}
                x={c.frontLeft.x}
                y={c.frontLeft.y}
                width={c.frontRight.x - c.frontLeft.x}
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
             turn visually noisy. Each section's own pair, each ending flush
             with its own section's top shelf. */}
        {uprights.map((u) => (
          <g key={`front-post-${u.key}`}>
            <rect
              data-upright="front"
              data-section-index={u.sectionIndex}
              x={u.x - POST_WIDTH / 2}
              y={u.top}
              width={POST_WIDTH}
              height={FLOOR_Y - u.top}
              fill={fill}
              stroke={lightFill}
              strokeWidth={0.5}
            />
            {perforationYs(u.top, FLOOR_Y).map((y, hi) => (
              <circle key={hi} cx={u.x} cy={y} r={HOLE_RADIUS} fill="#FFFFFF" />
            ))}
            <rect x={u.x - FOOT_WIDTH / 2} y={FLOOR_Y} width={FOOT_WIDTH} height={FOOT_HEIGHT} fill={STEEL_FOOT} />
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
            y={activeGeom.top - 7}
            width={activeGeom.width + 6}
            height={FLOOR_Y - activeGeom.top + 14}
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
        {frames.map((section, i) => {
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
              <rect x={section.x} y={section.top - 6} width={section.width} height={FLOOR_Y - section.top + 12} fill="transparent" />
              {isHovered && (
                <rect
                  x={section.x - 3}
                  y={section.top - 7}
                  width={section.width + 6}
                  height={FLOOR_Y - section.top + 14}
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
             The height zone sits entirely above each section's own `top`
             and the width zone entirely at-or-below it (matching each one's
             own literal spec — the upright's own visible height for width, a
             strip along the top edge for height) so they meet at `top`
             without overlapping: since the width zone is painted after and
             therefore wins any shared pixel, an overlap here would make a
             press at the top-right corner of an upright silently always
             start a width drag, even where the pointer is arguably over
             the top edge, not the upright. */}
        {interactive && (
          <>
            {heightZones.map((zone, i) => {
              // Only the active section's strip reveals the handle marker —
              // the marker sits on that section, so revealing it from another
              // section's edge would point at the wrong top.
              const isActiveZone = zone.id === activeSection.id;
              return (
                <path
                  key={`height-zone-${zone.id}`}
                  data-testid="height-resize-zone"
                  data-section-index={i}
                  d={zone.path}
                  fill="transparent"
                  style={{ cursor: 'ns-resize' }}
                  onPointerEnter={isActiveZone ? () => setHeightZoneHovered(true) : undefined}
                  onPointerLeave={isActiveZone ? () => setHeightZoneHovered(false) : undefined}
                  onPointerDown={(e) => startZoneDrag(heightDrag, e, zone.id)}
                  onPointerMove={heightDrag.onPointerMove}
                  onPointerUp={heightDrag.onPointerUp}
                  onPointerCancel={heightDrag.onPointerCancel}
                />
              );
            })}
            {frames.map((section, i) => {
              const isActiveZone = section.id === activeSection.id;
              return (
                <rect
                  key={`width-zone-${section.id}`}
                  data-testid="width-resize-zone"
                  data-section-index={i}
                  x={section.x + section.width - 16}
                  y={section.top}
                  width={32}
                  height={FLOOR_Y - section.top + 10}
                  fill="transparent"
                  style={{ cursor: 'ew-resize' }}
                  onPointerEnter={isActiveZone ? () => setWidthZoneHovered(true) : undefined}
                  onPointerLeave={isActiveZone ? () => setWidthZoneHovered(false) : undefined}
                  onPointerDown={(e) => startZoneDrag(widthDrag, e, section.id)}
                  onPointerMove={widthDrag.onPointerMove}
                  onPointerUp={widthDrag.onPointerUp}
                  onPointerCancel={widthDrag.onPointerCancel}
                />
              );
            })}
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
               capped with short ticks at the floor and the ACTIVE section's
               top plane — that section's own height. */}
          <line x1={heightLabelPoint.x} y1={activeGeom.top} x2={heightLabelPoint.x} y2={FLOOR_Y} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={heightLabelPoint.x - 3.5} y1={activeGeom.top} x2={heightLabelPoint.x + 3.5} y2={activeGeom.top} stroke={DRAW_LINE} strokeWidth={0.75} />
          <line x1={heightLabelPoint.x - 3.5} y1={FLOOR_Y} x2={heightLabelPoint.x + 3.5} y2={FLOOR_Y} stroke={DRAW_LINE} strokeWidth={0.75} />
          {/* …and, for any section but the first, a dashed hairline carrying
               the measured level across to that section's own top edge. */}
          {activeIndex > 0 && (
            <line
              data-testid="height-extension-line"
              x1={heightLabelPoint.x + 3.5}
              y1={activeGeom.top}
              x2={activeGeom.x}
              y2={activeGeom.top}
              stroke={DRAW_HAIRLINE}
              strokeWidth={0.75}
              strokeDasharray="2 2"
            />
          )}
          {/* Depth: a leader following the rack's own perspective diagonal,
               from the front upright back to the rear plane. */}
          {!tightLabels && <line x1={depthOrigin.x} y1={depthOrigin.y} x2={depthEnd.x} y2={depthEnd.y} stroke={DRAW_LINE} strokeWidth={0.75} />}
        </g>
        <DimensionTag
          x={heightLabelPoint.x}
          y={heightLabelPoint.y}
          label={`${Math.round(heightDrag.snapTarget ?? activeSection.height)}`}
          active={heightDrag.isDragging}
          orientation="vertical"
          scale={labelScale}
          testId="height-dimension-tag"
        />
        {!tightLabels && (
          <DimensionTag x={depthEnd.x} y={depthEnd.y} label={`${config.depth}`} active={false} orientation="horizontal" testId="depth-dimension-tag" scale={labelScale} />
        )}

        {frames.map((section) => {
          const isDraggingThis = widthDrag.isDragging && section.id === activeSection.id;
          const label = isDraggingThis ? (widthDrag.snapTarget ?? section.section.width) : section.section.width;
          // A value that would not fit under its own section is left out
          // rather than overlapping its neighbour's — every section's width
          // is always in the section list, and the total stays drawn.
          if (sectionLabelWidth(label, labelScale) > section.width - 2) return null;
          return (
            <SectionWidthLabel
              key={`label-${section.id}`}
              x={section.x + section.width / 2}
              y={FLOOR_Y + 13}
              label={label}
              active={isDraggingThis || (markActive && section.id === activeSection.id)}
              scale={labelScale}
            />
          );
        })}

        <TotalWidthLine x1={rowStart} x2={rowEnd} y={FLOOR_Y + 68} label={Math.round(totalLengthMm)} active={widthDrag.isDragging} scale={labelScale} />
      </svg>

      {interactive && (
        <>
          <ResizeHandle
            axis="height"
            ariaLabel={t(CF['CF-009'], locale, { H: activeSection.height })}
            value={activeSection.height}
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

          {/* One + above and one − below every section, anchored to that
              section's own top/floor (not fixed container percentages) so they
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
          {frames.map((section, i) => {
            const xPercent = ((section.x + section.width / 2) / VIEWBOX_W) * 100;
            const yPercent = (addButtonY(section.top) / VIEWBOX_H) * 100;
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
          {frames.map((section, i) => {
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

          {/* The ACTIVE section's shelf count — a compact vertical control
              column just off the rack's right edge, level with that
              section's own mid-height, in the same circle language as the
              section add/remove controls. The two 44px hit areas overlap the
              count between them by design, so the column stays short. Its
              group label, desktop tooltips and the graphite ring (whenever
              there is a choice of section) name the section it edits; it
              never needs hover to work. */}
          <div
            role="group"
            aria-label={`${t(CF['CF-032'], locale)} · ${sectionName}`}
            data-testid="preview-shelf-controls"
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center -space-y-1.5"
            style={{
              left: `${(shelfColumnX / VIEWBOX_W) * 100}%`,
              top: `${(((activeGeom.top + FLOOR_Y) / 2) / VIEWBOX_H) * 100}%`,
            }}
          >
            <button
              type="button"
              aria-label={t(CF['CF-019'], locale)}
              title={`${t(CF['CF-019'], locale)} · ${sectionName}`}
              onClick={onIncreaseShelves}
              disabled={activeSection.shelves >= maxShelves}
              className={CIRCLE_HIT}
            >
              <span aria-hidden="true" className={`${CIRCLE_DISC} ${DISC_SMALL} ${markActive ? 'border-foreground' : 'border-line-strong'} bg-surface`}>
                +
              </span>
            </button>
            <span className="mono relative z-10 text-xs font-semibold leading-none text-foreground">{activeSection.shelves}</span>
            <button
              type="button"
              aria-label={t(CF['CF-020'], locale)}
              title={`${t(CF['CF-020'], locale)} · ${sectionName}`}
              onClick={onDecreaseShelves}
              disabled={activeSection.shelves <= minShelves}
              className={CIRCLE_HIT}
            >
              <span aria-hidden="true" className={`${CIRCLE_DISC} ${DISC_SMALL} ${markActive ? 'border-foreground' : 'border-line-strong'} bg-surface`}>
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
        {/* The frame takes the crop's own ratio — compact on phones, wide
            from `sm` up (see computeFramedCrop). The top view frame in
            ConfiguratorClient reads the identical pair, so switching view
            never changes the workspace's height. */}
        <div className={`configurator-frame-box relative mx-auto w-full overflow-hidden ${frameClassName}`} style={frameAspectVars(crops)}>
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

// Re-exported so tests can derive real shelfYs the same way the component
// does (see section-geometry.ts, where each section's own shelf planes and
// the flush-top offset now live alongside the rest of its world geometry).
export { computeShelfYs, SHELF_FACE_OFFSET_PX } from './resize/section-geometry';

/** Rear wall / left wall / right wall — only rendered when the customer
 * actually selected them, on the section's own upright centrelines (`left`,
 * `right`) and up to its own `top`. Fully opaque painted metal panels, same
 * light-grey family as the rest of the rack — no transparency, subtle
 * shading only. */
function WallPanels({
  section: s,
  left,
  right,
  top,
  bottom,
  depthVec,
  darkFill,
  lightFill,
}: {
  section: ShelvingSection;
  left: number;
  right: number;
  top: number;
  bottom: number;
  depthVec: { dx: number; dy: number };
  darkFill: string;
  lightFill: string;
}) {
  return (
    <>
      {s.rearWall && (
        <polygon
          data-wall="rear"
          points={`${left + depthVec.dx},${top + depthVec.dy} ${right + depthVec.dx},${top + depthVec.dy} ${right + depthVec.dx},${bottom + depthVec.dy} ${left + depthVec.dx},${bottom + depthVec.dy}`}
          fill={darkFill}
        />
      )}
      {s.leftWall && (
        <polygon data-wall="left" points={`${left},${top} ${left},${bottom} ${left + depthVec.dx},${bottom + depthVec.dy} ${left + depthVec.dx},${top + depthVec.dy}`} fill={lightFill} />
      )}
      {s.rightWall && (
        <polygon
          data-wall="right"
          points={`${right},${top} ${right},${bottom} ${right + depthVec.dx},${bottom + depthVec.dy} ${right + depthVec.dx},${top + depthVec.dy}`}
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
export function SectionWidthLabel({
  x,
  y,
  label,
  active,
  scale = 1,
}: {
  x: number;
  y: number;
  label: number;
  active: boolean;
  /** Readability enlargement (see ShelvingPreview's labelScale); 1 elsewhere. */
  scale?: number;
}) {
  return (
    <text
      x={x}
      y={y + 3.5 * scale}
      textAnchor="middle"
      fontFamily="IBM Plex Mono, monospace"
      fontSize={LABEL_FONT * scale}
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
  scale = 1,
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
  /** Readability enlargement (see ShelvingPreview's labelScale); 1 elsewhere. */
  scale?: number;
}) {
  const w = Math.max(26, label.length * 6.6 + 11) * scale;
  const h = DIMENSION_TAG_H * scale;
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
        y={y + 3.4 * scale}
        textAnchor="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontSize={LABEL_FONT * scale}
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
 * and neutral tag every other dimension on this canvas uses. The tag's lower
 * edge stays at y + 21.5 at any readability scale (inside the reserved
 * bottom margin); an enlarged tag grows upward over its own line. */
function TotalWidthLine({
  x1,
  x2,
  y,
  label,
  active,
  scale = 1,
}: {
  x1: number;
  x2: number;
  y: number;
  label: number;
  active: boolean;
  scale?: number;
}) {
  const locale = useLocale();
  return (
    <g pointerEvents="none">
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={DRAW_LINE} strokeWidth={0.75} />
      <line x1={x1} y1={y - 3.5} x2={x1} y2={y + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
      <line x1={x2} y1={y - 3.5} x2={x2} y2={y + 3.5} stroke={DRAW_LINE} strokeWidth={0.75} />
      <DimensionTag
        x={(x1 + x2) / 2}
        y={y + 21.5 - (DIMENSION_TAG_H * scale) / 2}
        label={`${label} ${t(G['G-008'], locale)}`}
        active={active}
        orientation="horizontal"
        scale={scale}
        testId="total-width-tag"
      />
    </g>
  );
}
