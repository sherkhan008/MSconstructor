import type { SectionCorner, ShelvingSection } from '@/lib/types/domain';

/**
 * World geometry of a rack in millimetres (Configurator V2.6).
 *
 * World axes: x runs to the right along the front of the row, z runs
 * backward (away from the customer standing in front of it), y is up from
 * the common floor. Every section stands on y = 0 with its own height.
 *
 * Every section is placed by an explicit rigid transform of its LOCAL frame:
 *   u — along the section's own width, from its left end (0) to its right
 *       end (width), as seen by someone standing in front of it;
 *   v — along the shared depth, from its front (0) to its back (depth).
 * world(u, v) = origin + u·widthAxis + v·depthAxis. The axes are always a
 * proper 90° rotation (never a mirror), and stored values are never swapped:
 * the section's width is always measured along `widthAxis`, the kit depth
 * always along `depthAxis`.
 *
 *   NONE   widthAxis = +x, depthAxis = +z. Straight sections follow each
 *          other left to right along the front line z = 0.
 *   LEFT   the first section folded backward about its junction with the
 *          row (rotated -90°): widthAxis = -z, depthAxis = +x. Its width
 *          runs backward from the front line, its depth occupies the
 *          x-range left of the row, and its front faces outward (-x). Its
 *          right end is the near end (z = 0), its left end the far one.
 *   RIGHT  the last section folded backward the same way (rotated +90°):
 *          widthAxis = +z, depthAxis = -x, front facing outward (+x). Its
 *          left end is the near end, its right end the far one.
 *
 * Folded outward, a corner never faces its neighbour: every shelf stays
 * reachable and LEFT + RIGHT never block each other. Neighbours stand side
 * by side, each on its own four uprights (nothing is shared or added).
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** An axis-aligned face of a section's footprint box. */
export type BoxFace = 'xMin' | 'xMax' | 'zMin' | 'zMax';

/** What placement reads from a section: its width and orientation. */
export type PlacedSection = Pick<ShelvingSection, 'width' | 'corner'>;

export interface SectionPlacement<S extends PlacedSection = ShelvingSection> {
  section: S;
  index: number;
  corner: SectionCorner;
  /** World position of local (u = 0, v = 0): the section's front-left corner. */
  origin: Vec2;
  /** World direction of local +u (the stored width). */
  widthAxis: Vec2;
  /** World direction of local +v (the shared depth, front → back). */
  depthAxis: Vec2;
  /** The section's footprint — always the transform of [0, width] × [0, depth]. */
  footprint: { x0: number; x1: number; z0: number; z1: number };
}

export interface RackWorld<S extends PlacedSection = ShelvingSection> {
  placements: SectionPlacement<S>[];
  /** Union of every footprint: the rack's overall plan envelope. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

const AXES: Record<SectionCorner, { widthAxis: Vec2; depthAxis: Vec2 }> = {
  NONE: { widthAxis: { x: 1, z: 0 }, depthAxis: { x: 0, z: 1 } },
  LEFT: { widthAxis: { x: 0, z: -1 }, depthAxis: { x: 1, z: 0 } },
  RIGHT: { widthAxis: { x: 0, z: 1 }, depthAxis: { x: -1, z: 0 } },
};

/** world(u, v) for one placement. */
export function toWorld(placement: Pick<SectionPlacement, 'origin' | 'widthAxis' | 'depthAxis'>, u: number, v: number): Vec2 {
  const { origin, widthAxis, depthAxis } = placement;
  return { x: origin.x + u * widthAxis.x + v * depthAxis.x, z: origin.z + u * widthAxis.z + v * depthAxis.z };
}

/** The x-extent a section occupies along the front line: its width when
 * straight, the shared depth when it is a corner. */
export function sectionFrontSpanMm(section: PlacedSection, depth: number): number {
  return section.corner === 'NONE' ? section.width : depth;
}

/** How far a section reaches backward (z): the shared depth when straight,
 * its own width when it is a corner. */
export function sectionRecedeMm(section: PlacedSection, depth: number): number {
  return section.corner === 'NONE' ? depth : section.width;
}

/**
 * Places every section in world millimetres, left to right from x = 0. A
 * section's x depends only on the sections before it; a corner's width only
 * moves its own far end (it runs backward), never another section.
 */
export function layoutRackWorld<S extends PlacedSection>(sections: readonly S[], depth: number): RackWorld<S> {
  let cursor = 0;
  const placements = sections.map((section, index): SectionPlacement<S> => {
    const { widthAxis, depthAxis } = AXES[section.corner];
    const span = sectionFrontSpanMm(section, depth);
    const x0 = cursor;
    cursor += span;
    // Local (0, 0) sits where the rotation puts it inside the footprint
    // [x0, x0 + span] × [0, recede]: the straight section's front-left
    // corner; the LEFT corner's far outer corner; the RIGHT corner's near
    // outer corner.
    const origin: Vec2 =
      section.corner === 'LEFT' ? { x: x0, z: section.width } : section.corner === 'RIGHT' ? { x: x0 + depth, z: 0 } : { x: x0, z: 0 };
    const placement = { origin, widthAxis, depthAxis };
    const a = toWorld(placement, 0, 0);
    const b = toWorld(placement, section.width, depth);
    return {
      section,
      index,
      corner: section.corner,
      ...placement,
      footprint: { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) },
    };
  });
  const bounds = placements.reduce(
    (acc, p) => ({
      x0: Math.min(acc.x0, p.footprint.x0),
      x1: Math.max(acc.x1, p.footprint.x1),
      z0: Math.min(acc.z0, p.footprint.z0),
      z1: Math.max(acc.z1, p.footprint.z1),
    }),
    { x0: 0, x1: 0, z0: 0, z1: 0 },
  );
  return { placements, bounds };
}

/**
 * The world face a section's LOCAL face lands on: its rear (v = depth), its
 * left end (u = 0) or its right end (u = width). Derived from the transform's
 * outward normal — never a per-corner table — so wall panels always follow
 * the section's real orientation.
 */
export function worldFaceOf(placement: Pick<SectionPlacement, 'widthAxis' | 'depthAxis'>, face: 'rear' | 'left' | 'right'): BoxFace {
  const normal =
    face === 'rear'
      ? placement.depthAxis
      : face === 'left'
        ? { x: -placement.widthAxis.x, z: -placement.widthAxis.z }
        : placement.widthAxis;
  if (normal.x > 0) return 'xMax';
  if (normal.x < 0) return 'xMin';
  return normal.z > 0 ? 'zMax' : 'zMin';
}

/** Every upright's centreline in world mm: each section's own four, at the
 * corners of its own footprint, inset by `insetMm` along width and depth.
 * Never shared with a neighbour, never added for a corner. */
export function sectionUprightsMm(placement: SectionPlacement<PlacedSection>, depth: number, insetMm = 0): Vec2[] {
  const w = placement.section.width;
  return [
    toWorld(placement, insetMm, insetMm),
    toWorld(placement, w - insetMm, insetMm),
    toWorld(placement, insetMm, depth - insetMm),
    toWorld(placement, w - insetMm, depth - insetMm),
  ];
}

/**
 * The rack's overall plan size in millimetres: its x-extent (the front line,
 * including a corner's depth) and its z-extent (the shared depth, or a
 * corner's width when that reaches further back). For a straight rack this is
 * exactly (Σ section widths, depth).
 */
export function getRackFootprintMm(sections: readonly PlacedSection[], depth: number): { width: number; depth: number } {
  const { bounds } = layoutRackWorld(sections, depth);
  return { width: bounds.x1 - bounds.x0, depth: bounds.z1 - bounds.z0 };
}
