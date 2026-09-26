// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPACT_FRAME,
  FLOOR_Y,
  POST_WIDTH,
  ShelvingPreview,
  WIDE_FRAME,
  computeShelfYs,
} from '@/components/configurator/ShelvingPreview';
import { DEPTH_ANGLE_DEG, VIEWBOX_H, VIEWBOX_W } from '@/components/configurator/resize/dimension-scale';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * V2.3 true physical geometry, asserted on the rendered SVG: every section
 * is drawn from its OWN width, height and shelf count, all at one uniform
 * scale, standing on one floor, with one shared depth at that same scale.
 * Nothing here reproduces the drawing math — every length is read back from
 * the DOM and compared with the configuration's millimetres.
 */

const CAPACITY = { width: 1500, height: 3000, depth: 800 };

function section(id: string, width: number, height: number, shelves: number, walls: Partial<ShelvingSection> = {}): ShelvingSection {
  return { id, width, height, shelves, rearWall: false, leftWall: false, rightWall: false, ...walls };
}

function config(sections: ShelvingSection[], depth = 400): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth,
    sections,
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
  };
}

const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
const points = (p: Element) =>
  (p.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number) as [number, number]);

interface MeasuredSection {
  left: number;
  right: number;
  widthPx: number;
  top: number;
  heightPx: number;
  postBottoms: number[];
  lipYs: number[];
  rearPostXs: number[];
  frontPostXs: number[];
  topSurfaces: Element[];
}

/** Reads every section's own drawn geometry back from the SVG. */
function measure(svg: SVGSVGElement, count: number): MeasuredSection[] {
  return Array.from({ length: count }, (_, i) => {
    const at = `[data-section-index="${i}"]`;
    const front = Array.from(svg.querySelectorAll(`rect[data-upright="front"]${at}`)).sort((a, b) => num(a, 'x') - num(b, 'x'));
    const rear = Array.from(svg.querySelectorAll(`rect[data-upright="rear"]${at}`)).sort((a, b) => num(a, 'x') - num(b, 'x'));
    expect(front, `section ${i + 1} front uprights`).toHaveLength(2);
    expect(rear, `section ${i + 1} rear uprights`).toHaveLength(2);
    const left = num(front[0], 'x');
    const right = num(front[1], 'x') + num(front[1], 'width');
    const tops = front.map((r) => num(r, 'y'));
    expect(tops[0]).toBeCloseTo(tops[1], 9);
    return {
      left,
      right,
      widthPx: right - left,
      top: tops[0],
      heightPx: FLOOR_Y - tops[0],
      postBottoms: front.map((r) => num(r, 'y') + num(r, 'height')),
      lipYs: Array.from(svg.querySelectorAll(`rect[data-shelf-part="front-lip"]${at}`)).map((r) => num(r, 'y')),
      rearPostXs: rear.map((r) => num(r, 'x')),
      frontPostXs: front.map((r) => num(r, 'x')),
      topSurfaces: Array.from(svg.querySelectorAll(`polygon[data-shelf-part="top-surface"]${at}`)),
    };
  });
}

function renderRack(sections: ShelvingSection[], depth = 400, extra: Record<string, unknown> = {}) {
  const cfg = config(sections, depth);
  const { container } = render(createElement(ShelvingPreview, { config: cfg, ...extra }));
  const svg = container.querySelector('svg')!;
  return { svg, container, measured: measure(svg, sections.length), cfg };
}

/** Every physical length divided by its millimetres gives one number. */
function expectOneUniformScale(sections: ShelvingSection[], measured: MeasuredSection[]) {
  const scale = measured[0].widthPx / sections[0].width;
  for (const [i, s] of sections.entries()) {
    expect(measured[i].widthPx / s.width, `section ${i + 1} width`).toBeCloseTo(scale, 9);
    expect(measured[i].heightPx / s.height, `section ${i + 1} height`).toBeCloseTo(scale, 9);
  }
  return scale;
}

const MIXED_A = [section('a', 1000, 1500, 4), section('b', 1200, 2500, 8)];
const MIXED_B = [section('a', 700, 1000, 2), section('b', 1500, 3000, 8)];
const MIXED_FIVE = [
  section('s1', 700, 1000, 2),
  section('s2', 1000, 1500, 4, { rearWall: true }),
  section('s3', 1200, 2000, 6, { leftWall: true }),
  section('s4', 1500, 2500, 8),
  section('s5', 1000, 3000, 5, { rightWall: true }),
];

afterEach(cleanup);

describe.each([
  ['static preview', {}],
  ['configurator (capacity envelope)', { interactive: true, capacityMm: CAPACITY, activeSectionId: 'a' }],
])('physical geometry — %s', (_name, extra) => {
  it.each([
    ['A: 1000×1500/4 + 1200×2500/8', MIXED_A],
    ['B: 700×1000/2 + 1500×3000/8', MIXED_B],
    ['C: five mixed sections', MIXED_FIVE],
  ])('%s', (_label, sections) => {
    const { svg, measured } = renderRack(sections, 400, extra);

    // 6/1. Widths AND heights at one uniform scale: real ratios, per section.
    const scale = expectOneUniformScale(sections, measured);

    // 2. One common floor: every section's uprights stand on FLOOR_Y.
    for (const m of measured) for (const bottom of m.postBottoms) expect(bottom).toBeCloseTo(FLOOR_Y, 9);

    // Contiguous row: each section starts where the previous one ends, so
    // the two uprights at a junction stand side by side, never shared.
    for (let i = 1; i < measured.length; i += 1) {
      expect(measured[i].left).toBeCloseTo(measured[i - 1].right, 9);
      expect(measured[i].frontPostXs[0] - measured[i - 1].frontPostXs[1]).toBeCloseTo(POST_WIDTH, 9);
    }

    for (const [i, s] of sections.entries()) {
      const m = measured[i];
      // 4. Exactly its own shelf count — not the max, not the first section's.
      expect(m.lipYs, `section ${i + 1} shelves`).toHaveLength(s.shelves);
      expect(m.topSurfaces).toHaveLength(s.shelves);
      // 5. Shelf planes from its OWN height and shelf count.
      const expected = computeShelfYs(m.top, s.height * scale, s.shelves);
      // A front lip's top edge is the shelf's upper face (y − face offset).
      const lipOffsets = m.lipYs.map((y, k) => expected[k] - y);
      for (const offset of lipOffsets) expect(offset).toBeCloseTo(lipOffsets[0], 9);
      // 3/10. Its uprights end flush with its own top shelf's upper face.
      expect(Math.min(...m.lipYs)).toBeCloseTo(m.top, 9);
    }

    // 1. Different heights really are drawn at different heights.
    const tops = new Set(measured.map((m) => m.top.toFixed(6)));
    expect(tops.size).toBe(new Set(sections.map((s) => s.height)).size);

    // 7. Depth at the same scale: every rear upright is offset from its
    // front upright by exactly depth × scale along the receding diagonal
    // (horizontal component — the vertical one may be flattened for
    // shelf density, never the horizontal one).
    const expectedDx = 400 * scale * Math.cos((DEPTH_ANGLE_DEG * Math.PI) / 180);
    for (const m of measured) {
      for (let k = 0; k < 2; k += 1) expect(m.rearPostXs[k] - m.frontPostXs[k]).toBeCloseTo(expectedDx, 9);
    }

    // Nothing leaves the 640×480 drawing.
    for (const r of Array.from(svg.querySelectorAll('rect[data-upright]'))) {
      expect(num(r, 'x')).toBeGreaterThanOrEqual(0);
      expect(num(r, 'x') + num(r, 'width')).toBeLessThanOrEqual(VIEWBOX_W);
      expect(num(r, 'y')).toBeGreaterThanOrEqual(0);
      expect(num(r, 'y') + num(r, 'height')).toBeLessThanOrEqual(VIEWBOX_H);
    }
  });
});

describe('physical geometry — one scale for the whole rack', () => {
  it('a taller neighbour never stretches a shorter section, and vice versa', () => {
    const alone = renderRack([section('a', 1000, 1500, 4)], 400, { interactive: true, capacityMm: CAPACITY }).measured[0];
    cleanup();
    const beside = renderRack(MIXED_A, 400, { interactive: true, capacityMm: CAPACITY }).measured[0];
    // Same section count differs (1 vs 2) but both fit the height envelope,
    // so the configurator scale — and this section's drawing — is identical.
    expect(beside.heightPx).toBeCloseTo(alone.heightPx, 9);
    expect(beside.widthPx).toBeCloseTo(alone.widthPx, 9);
    expect(beside.lipYs).toEqual(alone.lipYs);
  });

  it('depth changes the receding offset in proportion and nothing else', () => {
    const shallow = renderRack(MIXED_A, 300, { interactive: true, capacityMm: CAPACITY }).measured;
    cleanup();
    const deep = renderRack(MIXED_A, 600, { interactive: true, capacityMm: CAPACITY }).measured;
    const dx = (m: MeasuredSection[]) => m[0].rearPostXs[0] - m[0].frontPostXs[0];
    expect(dx(deep) / dx(shallow)).toBeCloseTo(600 / 300, 9);
    for (let i = 0; i < 2; i += 1) {
      expect(deep[i].widthPx).toBeCloseTo(shallow[i].widthPx, 9);
      expect(deep[i].heightPx).toBeCloseTo(shallow[i].heightPx, 9);
    }
  });

  it('walls are drawn only on the sections that selected them, up to their own top', () => {
    const { svg, measured } = renderRack(MIXED_FIVE, 400);
    // Selected: s2 rear, s3 left, s5 right — and nothing else.
    const walls = Array.from(svg.querySelectorAll('polygon[data-wall]')).map((p) => ({
      kind: p.getAttribute('data-wall'),
      section: Number(p.parentElement?.getAttribute('data-section-index')),
      ys: points(p).map(([, y]) => y),
      xs: points(p).map(([x]) => x),
    }));
    expect(walls.map((w) => `${w.section}:${w.kind}`).sort()).toEqual(['1:rear', '2:left', '4:right']);

    const rearTopOf = (i: number) => num(svg.querySelector(`rect[data-upright="rear"][data-section-index="${i}"]`)!, 'y');
    for (const wall of walls) {
      const m = measured[wall.section];
      if (wall.kind === 'rear') {
        // The rear panel spans its own section's rear plane, up to its own rear top.
        expect(Math.min(...wall.ys)).toBeCloseTo(rearTopOf(wall.section), 9);
      } else {
        // A side panel rises from its own section's front top, never higher.
        expect(Math.max(...wall.ys)).toBeCloseTo(FLOOR_Y, 9);
        expect(wall.ys).toEqual(expect.arrayContaining([expect.closeTo(m.top, 9)]));
      }
      // Always within its own section's uprights (front plane or rear plane).
      const dx = m.rearPostXs[0] - m.frontPostXs[0];
      for (const x of wall.xs) {
        expect(x).toBeGreaterThanOrEqual(m.left - 1e-9);
        expect(x).toBeLessThanOrEqual(m.right + dx + 1e-9);
      }
    }
  });
});

describe('physical geometry — the configurator frame contains the whole rack', () => {
  it.each([
    ['uniform', [section('a', 1000, 2000, 4)]],
    ['mixed A', MIXED_A],
    ['mixed B', MIXED_B],
    ['five mixed', MIXED_FIVE],
    ['five widest and tallest', Array.from({ length: 5 }, (_, i) => section(`w${i}`, 1500, 3000, 8))],
  ])('%s: every upright and shelf lies inside both crop profiles', (_label, sections) => {
    const { container, svg } = renderRack(sections, 800, { interactive: true, capacityMm: CAPACITY, framed: true, activeSectionId: sections[0].id });
    const stage = container.querySelector<HTMLElement>('[data-testid="preview-stage"]')!;
    const frame = stage.parentElement!;
    for (const [prefix, profile] of [['w', WIDE_FRAME], ['c', COMPACT_FRAME]] as const) {
      const widthPct = parseFloat(stage.style.getPropertyValue(`--stage-${prefix}-w`));
      const leftPct = parseFloat(stage.style.getPropertyValue(`--stage-${prefix}-l`));
      const topPct = parseFloat(stage.style.getPropertyValue(`--stage-${prefix}-t`));
      const heightPct = parseFloat(stage.style.getPropertyValue(`--stage-${prefix}-h`));
      const cropW = (VIEWBOX_W / widthPct) * 100;
      const cropH = (VIEWBOX_H / heightPct) * 100;
      const cropX = (-leftPct / 100) * cropW;
      const cropY = (-topPct / 100) * cropH;
      // The crop takes exactly the frame's own published ratio (V2.4: the
      // envelope's ratio, within the profile's bounds).
      const aspect = parseFloat(frame.style.getPropertyValue(`--frame-${prefix}-aspect`));
      expect(cropW / cropH).toBeCloseTo(aspect, 6);
      expect(aspect).toBeGreaterThanOrEqual(profile.minAspect);
      expect(aspect).toBeLessThanOrEqual(profile.maxAspect);
      for (const el of Array.from(svg.querySelectorAll('rect[data-upright], rect[data-shelf-part]'))) {
        expect(num(el, 'x')).toBeGreaterThanOrEqual(cropX - 1e-6);
        expect(num(el, 'x') + num(el, 'width')).toBeLessThanOrEqual(cropX + cropW + 1e-6);
        expect(num(el, 'y')).toBeGreaterThanOrEqual(cropY - 1e-6);
        expect(num(el, 'y') + num(el, 'height')).toBeLessThanOrEqual(cropY + cropH + 1e-6);
      }
    }
  });
});

describe('physical geometry — section selection still targets the right section', () => {
  it('clicking or pressing Enter on a section selects that section, at its own mixed geometry', () => {
    const onSelectSection = vi.fn();
    const { container } = render(
      createElement(ShelvingPreview, {
        config: config(MIXED_FIVE),
        interactive: true,
        capacityMm: CAPACITY,
        activeSectionId: 's1',
        onSelectSection,
      }),
    );
    const buttons = Array.from(container.querySelectorAll('svg g[role="button"]'));
    expect(buttons).toHaveLength(5);
    fireEvent.click(buttons[3]);
    expect(onSelectSection).toHaveBeenLastCalledWith('s4');
    fireEvent.keyDown(buttons[0], { key: 'Enter' });
    expect(onSelectSection).toHaveBeenLastCalledWith('s1');

    // Each hit area spans its own section only: from its own top to the floor.
    const measured = measure(container.querySelector('svg')!, 5);
    for (const [i, g] of buttons.entries()) {
      const hit = g.querySelector('rect')!;
      expect(num(hit, 'x')).toBeCloseTo(measured[i].left, 9);
      expect(num(hit, 'width')).toBeCloseTo(measured[i].widthPx, 9);
      expect(num(hit, 'y')).toBeCloseTo(measured[i].top - 6, 9);
    }
  });

  it('the selection outline hugs the selected section at its own height', () => {
    const { container } = render(
      createElement(ShelvingPreview, { config: config(MIXED_A), interactive: true, capacityMm: CAPACITY, activeSectionId: 'a' }),
    );
    const svg = container.querySelector('svg')!;
    const measured = measure(svg, 2);
    const outline = Array.from(svg.querySelectorAll('rect[fill="none"]')).find((r) => r.getAttribute('stroke-dasharray') === null)!;
    expect(num(outline, 'y')).toBeCloseTo(measured[0].top - 7, 9);
    expect(num(outline, 'width')).toBeCloseTo(measured[0].widthPx + 6, 9);
  });
});
