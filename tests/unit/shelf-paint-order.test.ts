// @vitest-environment jsdom
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { uniformRow, type UniformRowInput } from '../helpers/uniform-row';

/**
 * Regression test for the "8 shelves look like one solid grey panel with
 * diagonal steps" bug: each shelf's own receding top-surface polygon is
 * `5 + |depthVec.dy|` px tall, which at typical depths comfortably exceeds
 * the gap between shelf centrelines once there are ~6+ shelves (or the rack
 * is short). With the old one-group-per-shelf paint order, a *lower*
 * shelf's top surface — painted after, so on top of, the shelf above it —
 * covered that upper shelf's horizontal front lip, leaving only the
 * diagonal side lips visible. The fix repaints in three full passes (every
 * top surface, then every side lip, then every front lip) so a front lip
 * can never be hidden by another shelf's top surface, at any shelf count,
 * height, or depth. This proves all N front lips render, stay visually
 * distinct, and — the actual regression guard — always paint after every
 * top-surface polygon in DOM order.
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

/** Front-lip rects are the only `height="5"` rects in the whole render
 * (rear/front post rects use `height={FLOOR_Y-top}`, feet use
 * `height={FOOT_HEIGHT}=4`), so this attribute alone identifies them
 * without relying on paint order or DOM position — the thing being tested. */
function findFrontLipRects(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.querySelectorAll('rect')).filter((r) => r.getAttribute('height') === '5') as SVGRectElement[];
}

/** The shelf top-surface polygons: identified by their own `data-shelf-part`
 * marker (not dimension tags/labels, not transparent hit-areas). Side lips
 * are also 4-point polygons and now share the same fill as the top surface
 * (shelf and lip colors must match), so fill alone no longer distinguishes
 * them — the marker is the reliable selector. */
function findShelfTopPolygons(svg: SVGSVGElement, baseFillHex: string): SVGPolygonElement[] {
  return Array.from(svg.querySelectorAll('polygon[data-shelf-part="top-surface"]')).filter(
    (p) => p.getAttribute('fill') === baseFillHex,
  ) as SVGPolygonElement[];
}

describe('ShelvingPreview — every shelf front lip stays visible regardless of shelf count/height', () => {
  const shelfCounts = [2, 3, 5, 8];
  const heights = [1500, 2000, 2500, 3000];

  for (const shelves of shelfCounts) {
    for (const height of heights) {
      it(`renders all ${shelves} front lips, each after every top surface in paint order, at height=${height}mm`, () => {
        const { container } = render(createElement(ShelvingPreview, { config: baseConfig({ shelves, height }) }));
        const svg = container.querySelector('svg')!;

        const frontLips = findFrontLipRects(svg);
        expect(frontLips).toHaveLength(shelves);

        // Every front lip must have its own distinct vertical position —
        // proving N genuinely separate levels, not duplicates collapsed
        // onto each other.
        const lipYs = frontLips.map((r) => Number(r.getAttribute('y')));
        expect(new Set(lipYs).size).toBe(shelves);

        const topSurfaces = findShelfTopPolygons(svg, '#C9CED0');
        expect(topSurfaces).toHaveLength(shelves);

        // The actual regression guard: in DOM/paint order, every top
        // surface must come before every front lip, so no shelf's top
        // surface can ever visually cover another shelf's front lip.
        const allNodes = Array.from(svg.querySelectorAll('*'));
        const lastTopSurfaceIndex = Math.max(...topSurfaces.map((el) => allNodes.indexOf(el)));
        const firstFrontLipIndex = Math.min(...frontLips.map((el) => allNodes.indexOf(el)));
        expect(firstFrontLipIndex).toBeGreaterThan(lastTopSurfaceIndex);
      });
    }
  }

  it('keeps front lips readable at a shallow rack height with the maximum shelf count (the worst case: 1500mm, 8 shelves)', () => {
    const { container } = render(createElement(ShelvingPreview, { config: baseConfig({ shelves: 8, height: 1500 }) }));
    const svg = container.querySelector('svg')!;
    expect(findFrontLipRects(svg)).toHaveLength(8);
  });
});

describe('ShelvingPreview — rear wall respects config.rearWall', () => {
  it('renders no rear-wall polygon when rearWall is false (the default open rack)', () => {
    const { container: withoutWall } = render(
      createElement(ShelvingPreview, { config: baseConfig({ sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }] }) }),
    );
    const { container: withWall } = render(
      createElement(ShelvingPreview, { config: baseConfig({ sections: [{ id: 'sec-1', width: 1000, rearWall: true, leftWall: false, rightWall: false }] }) }),
    );

    const withoutWallPolygonCount = withoutWall.querySelectorAll('svg polygon').length;
    const withWallPolygonCount = withWall.querySelectorAll('svg polygon').length;

    // Exactly one extra polygon — the rear wall panel — appears only when
    // rearWall is actually selected; nothing else about the render changes.
    expect(withWallPolygonCount).toBe(withoutWallPolygonCount + 1);
  });
});
