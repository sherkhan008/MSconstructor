// @vitest-environment jsdom
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { uniformRow, type UniformRowInput } from '../helpers/uniform-row';

/**
 * Regression test for the "shelf stops short of the rear uprights" bug: the
 * shelf polygon's rear corners used to be offset by a hard-halved fraction
 * of the front→rear depth vector (`shelfDepthVec = depthVec * 0.5`) while
 * the rear posts themselves are drawn a full `depthVec` back — leaving a
 * visible gap. This proves the shelf's rear corners are derived from the
 * exact same depth projection the rear posts use, for every supported
 * depth, not a hardcoded pixel value tuned for one case.
 */

function baseConfig(overrides: Partial<UniformRowInput> = {}): ShelvingConfiguration {
  return uniformRow({
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 3,
    sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  });
}

function num(el: Element, attr: string): number {
  return Number(el.getAttribute(attr));
}

/** The shelf's top-surface polygon: a 4-point polygon painted with the
 * resolved rack color (as opposed to dimension tags/labels, which are
 * `<rect>`/`<text>`, or hit-areas, which are `fill="transparent"`). */
function findShelfTopPolygon(svg: SVGSVGElement): SVGPolygonElement {
  const polygon = Array.from(svg.querySelectorAll('polygon')).find((p) => {
    const points = p.getAttribute('points') ?? '';
    const fill = p.getAttribute('fill') ?? '';
    return points.trim().split(/\s+/).length === 4 && fill.startsWith('#');
  });
  if (!polygon) throw new Error('shelf top-surface polygon not found');
  return polygon as SVGPolygonElement;
}

/** POST_WIDTH=5 rects, in DOM/paint order. For a single-section row (two
 * shared boundaries) the component always paints both rear posts before
 * both front posts (see ShelvingPreview.tsx's numbered paint-order
 * comments), so the first two are rear, the last two are front. */
function findPostRects(svg: SVGSVGElement): { rear: Element[]; front: Element[] } {
  const posts = Array.from(svg.querySelectorAll('rect')).filter((r) => num(r, 'width') === 5);
  if (posts.length !== 4) throw new Error(`expected 4 post rects for a single-section row, found ${posts.length}`);
  return { rear: posts.slice(0, 2), front: posts.slice(2, 4) };
}

describe('ShelvingPreview — shelf rear corners align with the rear uprights', () => {
  it.each([300, 400, 500, 600, 700, 800])(
    'at depth=%dmm, the shelf top-surface rear corners land exactly on the rear post centrelines',
    (depth) => {
      const { container } = render(createElement(ShelvingPreview, { config: baseConfig({ depth }) }));
      const svg = container.querySelector('svg')!;

      const { rear } = findPostRects(svg);
      const rearCentreXs = rear.map((r) => num(r, 'x') + num(r, 'width') / 2).sort((a, b) => a - b);

      const shelf = findShelfTopPolygon(svg);
      const points = shelf
        .getAttribute('points')!
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number));
      const [, , rearRight, rearLeft] = points;
      const shelfRearXs = [rearLeft[0], rearRight[0]].sort((a, b) => a - b);

      // The shelf's rear-left/rear-right x must exactly match the rear
      // posts' own centrelines — not merely "close", and not a fixed
      // fraction of the way there.
      expect(shelfRearXs[0]).toBeCloseTo(rearCentreXs[0], 6);
      expect(shelfRearXs[1]).toBeCloseTo(rearCentreXs[1], 6);

      // Sanity check this isn't a false positive from depth being ~0: the
      // rear corners must actually be offset from the front corners.
      const [frontLeft, frontRight] = points;
      expect(Math.abs(rearRight[0] - frontRight[0])).toBeGreaterThan(1);
      expect(Math.abs(rearLeft[0] - frontLeft[0])).toBeGreaterThan(1);
    },
  );

  it('the shelf rear corners still align with the rear posts after a width change (row rescale)', () => {
    const { container } = render(
      createElement(ShelvingPreview, {
        config: baseConfig({ depth: 400, sections: [{ id: 'sec-1', width: 1500, rearWall: false, leftWall: false, rightWall: false }] }),
      }),
    );
    const svg = container.querySelector('svg')!;
    const { rear } = findPostRects(svg);
    const rearCentreXs = rear.map((r) => num(r, 'x') + num(r, 'width') / 2).sort((a, b) => a - b);

    const shelf = findShelfTopPolygon(svg);
    const points = shelf
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(',').map(Number));
    const [, , rearRight, rearLeft] = points;
    const shelfRearXs = [rearLeft[0], rearRight[0]].sort((a, b) => a - b);

    expect(shelfRearXs[0]).toBeCloseTo(rearCentreXs[0], 6);
    expect(shelfRearXs[1]).toBeCloseTo(rearCentreXs[1], 6);
  });
});

/** Every shelf's top-surface polygon, one per shelf level — as opposed to
 * `findShelfTopPolygon` above (which only ever returns the first) or the
 * side-lip polygons, which are also 4-point and `#`-filled but use the
 * darker shade (`darkFill`), not the base resolved rack color. */
function findAllShelfTopPolygons(svg: SVGSVGElement, baseFillHex: string): SVGPolygonElement[] {
  return Array.from(svg.querySelectorAll('polygon[data-shelf-part="top-surface"]')).filter(
    (p) => p.getAttribute('fill') === baseFillHex,
  ) as SVGPolygonElement[];
}

describe('ShelvingPreview — rear alignment holds even when the depth projection is compressed', () => {
  // The adaptive depth projection (shelf-depth-projection.ts) caps the
  // vertical rise of *every* shelf's rear corners identically, but never
  // touches the horizontal component — so every shelf, at every density,
  // must still land exactly on the rear post centreline horizontally, the
  // same invariant the tests above prove for the uncompressed case. This
  // exercises the dense end of the matrix (8 shelves, 800mm depth) where
  // compression actually engages, to prove the fix didn't decouple the
  // shelves' rear corners from the rear posts' own position.
  it.each([300, 400, 600, 800])(
    'at depth=%dmm with 8 shelves, every shelf top-surface rear corner still lands on the rear post centrelines',
    (depth) => {
      const { container } = render(
        createElement(ShelvingPreview, { config: baseConfig({ depth, shelves: 8, height: 2000 }) }),
      );
      const svg = container.querySelector('svg')!;

      const { rear } = findPostRects(svg);
      const rearCentreXs = rear.map((r) => num(r, 'x') + num(r, 'width') / 2).sort((a, b) => a - b);

      const shelves = findAllShelfTopPolygons(svg, '#C9CED0');
      expect(shelves).toHaveLength(8);

      for (const shelf of shelves) {
        const points = shelf
          .getAttribute('points')!
          .trim()
          .split(/\s+/)
          .map((pair) => pair.split(',').map(Number));
        const [, , rearRight, rearLeft] = points;
        const shelfRearXs = [rearLeft[0], rearRight[0]].sort((a, b) => a - b);
        expect(shelfRearXs[0]).toBeCloseTo(rearCentreXs[0], 6);
        expect(shelfRearXs[1]).toBeCloseTo(rearCentreXs[1], 6);
      }
    },
  );
});
