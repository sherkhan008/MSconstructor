// @vitest-environment jsdom
import { createElement } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mmToPx } from '@/components/configurator/resize/dimension-scale';
import { FLOOR_Y, RACK_SCALE, SHELF_FACE_OFFSET_PX, ShelvingPreview, computeShelfYs } from '@/components/configurator/ShelvingPreview';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { uniformRow, type UniformRowInput } from '../helpers/uniform-row';

/**
 * V2.1 flush top: the uprights (front and rear) and any selected wall panel
 * end exactly at the top shelf's upper face — nothing protrudes above it.
 * A drawing fix only: the configured height, price and BOM are untouched.
 */

function baseConfig(overrides: Partial<UniformRowInput> = {}): ShelvingConfiguration {
  return uniformRow({
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
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

const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
const points = (p: Element) =>
  (p.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number) as [number, number]);

afterEach(cleanup);

describe('computeShelfYs — the top shelf sits on the physical top', () => {
  const heightPx = mmToPx('height', 2000) * RACK_SCALE;
  const top = FLOOR_Y - heightPx;

  it.each([1, 2, 3, 5, 8])('with %d shelf(s), the top shelf face is exactly at `top`', (shelves) => {
    const ys = computeShelfYs(top, heightPx, shelves);
    expect(ys).toHaveLength(shelves);
    expect(ys[0] - SHELF_FACE_OFFSET_PX).toBeCloseTo(top, 9);
    // Ordered top → bottom, and the bottom shelf still clears the floor.
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(ys[ys.length - 1]).toBeLessThan(FLOOR_Y);
  });
});

describe('ShelvingPreview — uprights and walls end flush with the top shelf', () => {
  const cases: Partial<UniformRowInput>[] = [
    { height: 1500, depth: 300, shelves: 2 },
    { height: 2000, depth: 400, shelves: 5 },
    { height: 2500, depth: 600, shelves: 6 },
    { height: 3000, depth: 800, shelves: 8 },
    {
      height: 2000,
      depth: 500,
      shelves: 4,
      sections: [
        { id: 'a', width: 1000, rearWall: true, leftWall: true, rightWall: false },
        { id: 'b', width: 700, rearWall: true, leftWall: false, rightWall: true },
      ],
    },
  ];

  it.each(cases)('%o', (overrides) => {
    const config = baseConfig(overrides);
    const { container } = render(createElement(ShelvingPreview, { config }));
    const svg = container.querySelector('svg')!;

    const posts = Array.from(svg.querySelectorAll('rect')).filter((r) => num(r, 'width') === 5);
    const half = posts.length / 2;
    const rearTops = posts.slice(0, half).map((r) => num(r, 'y'));
    const frontTops = posts.slice(half).map((r) => num(r, 'y'));

    const shelfTops = Array.from(svg.querySelectorAll('polygon[data-shelf-part="top-surface"]'));
    expect(shelfTops.length).toBe(config.sections.reduce((n, s) => n + s.shelves, 0));
    // Top surface points: frontLeft, frontRight, rearRight, rearLeft.
    const topFrontY = Math.min(...shelfTops.flatMap((p) => points(p).slice(0, 2).map(([, y]) => y)));
    const topRearY = Math.min(...shelfTops.flatMap((p) => points(p).slice(2, 4).map(([, y]) => y)));

    // Front uprights start exactly at the top shelf's front face…
    for (const y of frontTops) expect(y).toBeCloseTo(topFrontY, 9);
    // …and rear uprights exactly at its rear face (same depth projection).
    for (const y of rearTops) expect(y).toBeCloseTo(topRearY, 9);

    // No rack-coloured surface (shelves, lips, selected walls) rises above
    // the rear uprights' top — nothing protrudes past the top shelf.
    const allPolygonYs = Array.from(svg.querySelectorAll('polygon')).flatMap((p) => points(p).map(([, y]) => y));
    expect(Math.min(...allPolygonYs)).toBeGreaterThanOrEqual(topRearY - 1e-9);
  });

  it('never changes the configuration it draws', () => {
    const config = baseConfig({ height: 2200, shelves: 6 });
    const snapshot = JSON.stringify(config);
    render(createElement(ShelvingPreview, { config: Object.freeze(config) }));
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it('is drawing-only: pricing and BOM code never read the preview geometry', () => {
    const dir = join(process.cwd(), 'src', 'lib', 'pricing');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/ShelvingPreview|computeShelfYs|SHELF_FACE_OFFSET_PX/);
    }
  });
});
