import { describe, expect, it } from 'vitest';
import { depthVectorPx, fitPxPerMm } from '@/components/configurator/resize/dimension-scale';
import { rackEnvelopeMm } from '@/components/configurator/resize/section-geometry';
import { FLOOR_Y, computeShelfYs } from '@/components/configurator/ShelvingPreview';
import { MAX_SECTIONS } from '@/lib/configurator/limits';
import {
  computeRenderDepthVec,
  computeRenderDepthVecForSections,
  minShelfSpacingPx,
  MIN_SHELF_AIR_GAP_PX,
  SHELF_LIP_HEIGHT_PX,
  type DepthVec,
} from '@/components/configurator/shelf-depth-projection';

/**
 * Full-matrix coverage for the adaptive front-view depth projection: with
 * the raw (uncapped) depthVec, dense configurations (many shelves and/or a
 * large depth) make a shelf's own receding top surface rise far enough to
 * paint over the shelf immediately above it — the "solid grey staircase"
 * bug. `computeRenderDepthVec` caps only the vertical component, only when
 * shelf density actually requires it, using the exact same shelfYs the
 * component renders from.
 *
 * The matrix below is the authoritative valid MS Standard combination
 * matrix supplied for this task — used here purely for visual/geometry
 * verification, independent of whatever the current catalog technically
 * permits (see the final report for the discrepancy between the two).
 */

interface HeightGroup {
  heights: number[];
  maxShelves: number;
}

interface WidthGroup {
  width: number;
  depths: number[];
  heightGroups: HeightGroup[];
}

const MIN_SHELVES = 2; // the project's existing minimum (DEFAULT_CONFIGURATION / model.minShelves)

const MATRIX: WidthGroup[] = [
  {
    width: 700,
    depths: [300, 400, 500, 600, 800], // 700mm depth is NOT valid for width 700
    heightGroups: [
      { heights: [1500, 1800], maxShelves: 6 },
      { heights: [2000, 2200, 2500, 3000], maxShelves: 8 },
    ],
  },
  {
    width: 1000,
    depths: [300, 400, 500, 600, 700, 800],
    heightGroups: [
      { heights: [1500, 1800], maxShelves: 6 },
      { heights: [2000, 2200, 2500, 3000], maxShelves: 8 },
    ],
  },
  {
    width: 1200,
    depths: [300, 400, 500, 600],
    heightGroups: [
      { heights: [1500, 1800], maxShelves: 6 },
      { heights: [2000, 2200, 2500, 3000], maxShelves: 8 },
    ],
  },
  {
    width: 1500,
    depths: [300, 400, 500, 600],
    heightGroups: [
      { heights: [1500, 1800], maxShelves: 6 },
      { heights: [2000, 2200, 2500, 3000], maxShelves: 8 },
    ],
  },
];

/** Representative shelf counts from the task's own list, filtered down to
 * whatever's actually valid (>= MIN_SHELVES, <= this height group's max). */
function testShelfCounts(maxShelves: number): number[] {
  return [2, 3, 5, 6, 8].filter((n) => n >= MIN_SHELVES && n <= maxShelves);
}

/** MS Standard's catalog maxima, as ConfiguratorClient passes them. */
const CAPACITY = { width: 1500, height: 3000, depth: 800 };

/** The configurator's physical scale for a row of `count` sections — it
 * depends on the count alone (see rackEnvelopeMm), and is largest for one
 * section and smallest for the maximum count. */
function configuratorScale(count: number): number {
  const sections = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    width: 1000,
    height: 2000,
    shelves: 4,
    rearWall: false,
    leftWall: false,
    rightWall: false,
  }));
  return fitPxPerMm(rackEnvelopeMm(sections, 400, CAPACITY));
}
const SCALES: [string, number][] = [
  ['1 section', configuratorScale(1)],
  [`${MAX_SECTIONS} sections`, configuratorScale(MAX_SECTIONS)],
];

/** Reproduces ShelvingPreview's exact geometry pipeline for one section —
 * the same functions/constants the component itself calls, not a
 * re-derived formula. Defaults to the densest (smallest) configurator scale. */
function computeGeometry(height: number, depth: number, shelves: number, pxPerMm = configuratorScale(MAX_SECTIONS)) {
  const heightPx = height * pxPerMm;
  const top = FLOOR_Y - heightPx;
  const shelfYs = computeShelfYs(top, heightPx, shelves);

  const rawDepthVec: DepthVec = depthVectorPx(depth, pxPerMm);
  const renderDepthVec = computeRenderDepthVec(rawDepthVec, shelfYs);

  return { shelfYs, rawDepthVec, renderDepthVec };
}

/** The actual visible background gap between consecutive shelf bands, given
 * the render vector's vertical component — see shelf-depth-projection.ts's
 * doc comment for the geometric derivation (spacing - lip height + dy,
 * since dy is negative). */
function visibleAirGap(shelfYs: number[], dy: number): number {
  const spacing = minShelfSpacingPx(shelfYs);
  return spacing - SHELF_LIP_HEIGHT_PX + dy;
}

describe('shelf-depth-projection — every valid matrix combination keeps the minimum air gap', () => {
  for (const group of MATRIX) {
    for (const heightGroup of group.heightGroups) {
      for (const height of heightGroup.heights) {
        for (const depth of group.depths) {
          for (const shelves of testShelfCounts(heightGroup.maxShelves)) {
            it(`width=${group.width} height=${height} depth=${depth} shelves=${shelves} keeps >= ${MIN_SHELF_AIR_GAP_PX}px air gap`, () => {
              for (const [scaleName, pxPerMm] of SCALES) {
                const { shelfYs, renderDepthVec } = computeGeometry(height, depth, shelves, pxPerMm);
                const gap = visibleAirGap(shelfYs, renderDepthVec.dy);
                expect(gap, scaleName).toBeGreaterThanOrEqual(MIN_SHELF_AIR_GAP_PX - 1e-6);
              }
            });
          }
        }
      }
    }
  }
});

describe('shelf-depth-projection — explicit worst-case dense configurations', () => {
  const worstCases: { width: number; height: number; depth: number; shelves: number }[] = [
    { width: 700, height: 1500, depth: 800, shelves: 6 },
    { width: 700, height: 1800, depth: 800, shelves: 6 },
    { width: 700, height: 2000, depth: 800, shelves: 8 },
    { width: 700, height: 2500, depth: 800, shelves: 8 },
    { width: 700, height: 3000, depth: 800, shelves: 8 },
    { width: 1000, height: 1500, depth: 800, shelves: 6 },
    { width: 1000, height: 2000, depth: 800, shelves: 8 },
    { width: 1000, height: 2500, depth: 800, shelves: 8 },
    { width: 1000, height: 3000, depth: 800, shelves: 8 },
    { width: 1200, height: 1500, depth: 600, shelves: 6 },
    { width: 1200, height: 2000, depth: 600, shelves: 8 },
    { width: 1200, height: 2500, depth: 600, shelves: 8 },
    { width: 1500, height: 1500, depth: 600, shelves: 6 },
    { width: 1500, height: 2000, depth: 600, shelves: 8 },
    { width: 1500, height: 2500, depth: 600, shelves: 8 },
  ];

  it.each(worstCases)('$width×$height×$depth, $shelves shelves stays readable (no collapsed/inverted band)', ({ height, depth, shelves }) => {
    const { shelfYs, renderDepthVec } = computeGeometry(height, depth, shelves);
    const gap = visibleAirGap(shelfYs, renderDepthVec.dy);
    expect(gap).toBeGreaterThanOrEqual(MIN_SHELF_AIR_GAP_PX - 1e-6);
    // Never inverted/degenerate: the vertical rise is always finite and
    // points the same direction (up) as the natural projection.
    expect(Number.isFinite(renderDepthVec.dy)).toBe(true);
    expect(renderDepthVec.dy).toBeLessThanOrEqual(0);
  });
});

describe('shelf-depth-projection — low-density configurations keep their natural perspective', () => {
  const naturalCases: { height: number; depth: number; shelves: number }[] = [
    { height: 1500, depth: 300, shelves: 2 },
    { height: 2000, depth: 400, shelves: 3 },
    { height: 2500, depth: 300, shelves: 3 },
    { height: 3000, depth: 300, shelves: 2 },
    { height: 2500, depth: 300, shelves: 5 },
  ];

  it.each(naturalCases)('height=$height depth=$depth shelves=$shelves: renderDepthVec.dy is unchanged from the raw projection', ({ height, depth, shelves }) => {
    const { rawDepthVec, renderDepthVec } = computeGeometry(height, depth, shelves);
    expect(renderDepthVec.dy).toBeCloseTo(rawDepthVec.dy, 6);
  });
});

describe('shelf-depth-projection — horizontal depth is always preserved', () => {
  it('renderDepthVec.dx always equals rawDepthVec.dx, dense or not', () => {
    for (const group of MATRIX) {
      for (const heightGroup of group.heightGroups) {
        for (const height of heightGroup.heights) {
          for (const depth of group.depths) {
            for (const shelves of testShelfCounts(heightGroup.maxShelves)) {
              const { rawDepthVec, renderDepthVec } = computeGeometry(height, depth, shelves);
              expect(renderDepthVec.dx).toBeCloseTo(rawDepthVec.dx, 9);
            }
          }
        }
      }
    }
  });
});

describe('shelf-depth-projection — depth stays monotonic within each valid width group', () => {
  for (const group of MATRIX) {
    it(`width=${group.width}: increasing depth always increases the horizontal rear-plane offset, even at max shelf density`, () => {
      const sortedDepths = [...group.depths].sort((a, b) => a - b);
      const heightGroup = group.heightGroups[group.heightGroups.length - 1]; // the taller, higher-shelf-count group
      const height = heightGroup.heights[0];

      let previousDx = -Infinity;
      for (const depth of sortedDepths) {
        const { renderDepthVec } = computeGeometry(height, depth, heightGroup.maxShelves);
        expect(renderDepthVec.dx).toBeGreaterThan(previousDx);
        previousDx = renderDepthVec.dx;
      }
    });
  }
});

describe('minShelfSpacingPx', () => {
  it('returns Infinity for fewer than two shelf levels (nothing to compress against)', () => {
    expect(minShelfSpacingPx([])).toBe(Infinity);
    expect(minShelfSpacingPx([120])).toBe(Infinity);
  });

  it('returns the smallest consecutive gap for evenly-spaced shelves', () => {
    expect(minShelfSpacingPx([10, 20, 30, 40])).toBe(10);
  });

  it('a single-shelf configuration never gets its depth vector compressed', () => {
    const { rawDepthVec, renderDepthVec } = computeGeometry(1500, 800, 1);
    expect(renderDepthVec).toEqual(rawDepthVec);
  });
});

describe('shelf-depth-projection — one shared depth for sections with their own shelf planes', () => {
  it('is capped by the densest section, never by the gap between two different sections’ shelves', () => {
    const pxPerMm = configuratorScale(2);
    const sparse = computeShelfYs(FLOOR_Y - 3000 * pxPerMm, 3000 * pxPerMm, 2);
    const dense = computeShelfYs(FLOOR_Y - 2000 * pxPerMm, 2000 * pxPerMm, 8);
    const raw = depthVectorPx(800, pxPerMm);

    const shared = computeRenderDepthVecForSections(raw, [sparse, dense]);
    expect(shared).toEqual(computeRenderDepthVec(raw, dense));
    expect(computeRenderDepthVecForSections(raw, [dense, sparse])).toEqual(shared);
    // Horizontal depth is still the physical depth at the one scale.
    expect(shared.dx).toBeCloseTo(800 * pxPerMm * Math.cos((40 * Math.PI) / 180), 9);
    // Both sections keep the minimum air gap with the shared vector.
    for (const ys of [sparse, dense]) expect(visibleAirGap(ys, shared.dy)).toBeGreaterThanOrEqual(MIN_SHELF_AIR_GAP_PX - 1e-6);
  });

  it('leaves the natural projection alone when every section has air to spare', () => {
    const pxPerMm = configuratorScale(2);
    const a = computeShelfYs(FLOOR_Y - 3000 * pxPerMm, 3000 * pxPerMm, 3);
    const b = computeShelfYs(FLOOR_Y - 2500 * pxPerMm, 2500 * pxPerMm, 2);
    const raw = depthVectorPx(300, pxPerMm);
    expect(computeRenderDepthVecForSections(raw, [a, b])).toEqual(raw);
  });
});
