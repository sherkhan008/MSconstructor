// @vitest-environment jsdom
import { createElement, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedCornersAt, areSectionCornersValid, findCornerIssues, MAX_CORNERS } from '@/lib/configurator/corners';
import { getRackFootprintMm, layoutRackWorld, sectionUprightsMm, toWorld, worldFaceOf } from '@/lib/configurator/rack-world';
import {
  configurationToShareQuery,
  parseConfigurationFromSearchParams,
  parseWorkspaceFromSearchParams,
  workspaceToShareQuery,
} from '@/lib/configurator/url';
import { readPersistedConfiguration, upgradeStraightConfiguration } from '@/lib/configurator/persisted-configuration';
import { DEFAULT_CONFIGURATION, useConfiguratorStore } from '@/store/configurator-store';
import { getWorkspaceRackCount } from '@/lib/configurator/workspace';
import { MAX_KITS_PER_ORDER } from '@/lib/orders/limits';
import { shelvingConfigurationSchema } from '@/lib/pricing/schema';
import {
  computeFramedCrops,
  computeRackDepthVec,
  FLOOR_Y,
  POST_WIDTH,
  RACK_LEFT_MARGIN,
  ShelvingPreview,
} from '@/components/configurator/ShelvingPreview';
import { TopShelvingPreview } from '@/components/configurator/TopShelvingPreview';
import { DEPTH_ANGLE_DEG, fitPxPerMm, VIEWBOX_H, VIEWBOX_W } from '@/components/configurator/resize/dimension-scale';
import { layoutSectionFrames, rackEnvelopeMm } from '@/components/configurator/resize/section-geometry';
import { projectOnVector, useDimensionDrag } from '@/components/configurator/resize/useDimensionDrag';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { activeConfig, loadSingleKit } from '../helpers/workspace';

/**
 * Configurator V2.6 — corner sections. A corner is the same section rotated
 * 90° backward at an edge of the rack: LEFT only first, RIGHT only last, at
 * most two. Stored width/depth/height never swap; the world transform moves
 * the section, and the drawing projects that world geometry.
 */

const CAPACITY = { width: 1500, height: 3000, depth: 800 };
const COS = Math.cos((DEPTH_ANGLE_DEG * Math.PI) / 180);

function section(id: string, width: number, height = 2000, shelves = 5, extra: Partial<ShelvingSection> = {}): ShelvingSection {
  return { id, width, height, shelves, rearWall: false, leftWall: false, rightWall: false, corner: 'NONE', ...extra };
}
const corner = (s: ShelvingSection, c: SectionCorner): ShelvingSection => ({ ...s, corner: c });

function config(sections: ShelvingSection[], overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return { ...DEFAULT_CONFIGURATION, sections, accessories: [], ...overrides };
}

const corners = (cfg: Pick<ShelvingConfiguration, 'sections'>) => cfg.sections.map((s) => s.corner);

afterEach(cleanup);

/* -------------------------------------------------------------------------- */
describe('corner placement rules', () => {
  it('offers only valid choices per position', () => {
    expect(allowedCornersAt(0, 1)).toEqual(['NONE', 'LEFT', 'RIGHT']); // a lone section is both edges
    expect(allowedCornersAt(0, 3)).toEqual(['NONE', 'LEFT']);
    expect(allowedCornersAt(1, 3)).toEqual(['NONE']);
    expect(allowedCornersAt(2, 3)).toEqual(['NONE', 'RIGHT']);
    expect(MAX_CORNERS).toBe(2);
  });

  it('accepts no corner, LEFT first, RIGHT last, LEFT + RIGHT', () => {
    const s = (c: SectionCorner) => ({ corner: c });
    expect(areSectionCornersValid([s('NONE'), s('NONE')])).toBe(true);
    expect(areSectionCornersValid([s('LEFT'), s('NONE')])).toBe(true);
    expect(areSectionCornersValid([s('NONE'), s('RIGHT')])).toBe(true);
    expect(areSectionCornersValid([s('LEFT'), s('NONE'), s('RIGHT')])).toBe(true);
    expect(areSectionCornersValid([s('LEFT'), s('RIGHT')])).toBe(true);
    expect(areSectionCornersValid([s('LEFT')])).toBe(true);
    expect(areSectionCornersValid([s('RIGHT')])).toBe(true);
  });

  it('rejects a middle corner, wrong-side corners, doubles and more than two', () => {
    const s = (c: SectionCorner) => ({ corner: c });
    expect(findCornerIssues([s('NONE'), s('LEFT'), s('NONE')])).toEqual(['LEFT_NOT_FIRST']);
    expect(findCornerIssues([s('NONE'), s('RIGHT'), s('NONE')])).toEqual(['RIGHT_NOT_LAST']);
    expect(findCornerIssues([s('RIGHT'), s('NONE')])).toEqual(['RIGHT_NOT_LAST']);
    expect(findCornerIssues([s('NONE'), s('LEFT')])).toEqual(['LEFT_NOT_FIRST']);
    expect(findCornerIssues([s('LEFT'), s('LEFT')])).toContain('LEFT_NOT_FIRST');
    expect(findCornerIssues([s('RIGHT'), s('RIGHT')])).toContain('RIGHT_NOT_LAST');
    expect(findCornerIssues([s('LEFT'), s('LEFT'), s('RIGHT')])).toEqual(['LEFT_NOT_FIRST', 'TOO_MANY_CORNERS']);
  });

  it('the server schema enforces the same rules and keeps the 5-section limit', () => {
    const ok = config([corner(section('a', 1000), 'LEFT'), section('b', 1000), corner(section('c', 1000), 'RIGHT')]);
    expect(shelvingConfigurationSchema.safeParse(ok).success).toBe(true);
    const middle = config([section('a', 1000), corner(section('b', 1000), 'LEFT'), section('c', 1000)]);
    expect(shelvingConfigurationSchema.safeParse(middle).success).toBe(false);
    const six = config(Array.from({ length: 6 }, (_, i) => section(`s${i}`, 1000)));
    expect(shelvingConfigurationSchema.safeParse(six).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe('store — section operations around corners', () => {
  const store = () => useConfiguratorStore.getState();
  const ids = () => activeConfig().sections.map((s) => s.id);

  beforeEach(() => loadSingleKit(DEFAULT_CONFIGURATION));

  it('sets a corner only where it is allowed; an invalid patch changes nothing', () => {
    loadSingleKit(config([section('a', 1000), section('b', 1000), section('c', 1000)]));
    store().updateSection('b', { corner: 'LEFT' });
    store().updateSection('a', { corner: 'RIGHT' });
    store().updateSection('c', { corner: 'LEFT' });
    expect(corners(activeConfig())).toEqual(['NONE', 'NONE', 'NONE']);
    store().updateSection('a', { corner: 'LEFT' });
    store().updateSection('c', { corner: 'RIGHT' });
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE', 'RIGHT']);
    // Refused as a whole: the width in the same patch is not applied either.
    store().updateSection('b', { corner: 'RIGHT', width: 700 });
    expect(activeConfig().sections[1]).toEqual(section('b', 1000));
    store().setMany({ sections: [section('x', 1000), corner(section('y', 1000), 'LEFT')] });
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('a lone section can be LEFT or RIGHT (one at a time) and then grows correctly', () => {
    loadSingleKit(config([section('a', 1000)]));
    store().updateSection('a', { corner: 'RIGHT' });
    expect(corners(activeConfig())).toEqual(['RIGHT']);
    store().addSection(); // inserted before the right corner, which stays last
    expect(corners(activeConfig())).toEqual(['NONE', 'RIGHT']);
    expect(activeConfig().sections[1].id).toBe('a');

    loadSingleKit(config([section('a', 1000)]));
    store().updateSection('a', { corner: 'LEFT' });
    store().addSection(); // inserted after the left corner, which stays first
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE']);
    expect(activeConfig().sections[0].id).toBe('a');
  });

  it('add after a RIGHT corner goes before it; add after a LEFT corner goes after it; new sections are straight', () => {
    loadSingleKit(config([corner(section('L', 1200), 'LEFT'), section('m', 1000), corner(section('R', 700), 'RIGHT')]));
    store().setActiveSectionId('R');
    store().addSection();
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE', 'NONE', 'RIGHT']);
    expect(activeConfig().sections[2].width).toBe(700); // copies the template's dimensions
    expect(activeConfig().sections[3].id).toBe('R');
    store().setActiveSectionId('L');
    store().addSection();
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE', 'NONE', 'NONE', 'RIGHT']);
    expect(areSectionCornersValid(activeConfig().sections)).toBe(true);
    store().addSection(); // 5 sections: the limit is unchanged
    expect(activeConfig().sections).toHaveLength(5);
  });

  it('duplicating a corner creates a straight copy on the row side, never a second corner', () => {
    loadSingleKit(config([corner(section('L', 1200, 1500, 4, { rearWall: true }), 'LEFT'), corner(section('R', 700, 2500, 8), 'RIGHT')]));
    store().duplicateSection('L');
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE', 'RIGHT']);
    expect(activeConfig().sections[1]).toMatchObject({ width: 1200, height: 1500, shelves: 4, rearWall: true, corner: 'NONE' });
    store().duplicateSection('R');
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE', 'NONE', 'RIGHT']);
    expect(activeConfig().sections[2]).toMatchObject({ width: 700, height: 2500, shelves: 8, corner: 'NONE' });
    expect(activeConfig().sections[3].id).toBe('R');
  });

  it('removing any section never leaves a corner on the wrong edge', () => {
    loadSingleKit(config([corner(section('L', 1000), 'LEFT'), section('m', 1000), corner(section('R', 1000), 'RIGHT')]));
    store().removeSection('m');
    expect(corners(activeConfig())).toEqual(['LEFT', 'RIGHT']);
    store().removeSection('L');
    expect(corners(activeConfig())).toEqual(['RIGHT']);
    loadSingleKit(config([corner(section('L', 1000), 'LEFT'), section('m', 1000), corner(section('R', 1000), 'RIGHT')]));
    store().removeSection('R');
    expect(corners(activeConfig())).toEqual(['LEFT', 'NONE']);
  });

  it('corner width and height edits keep the stored values as they are (no swap)', () => {
    loadSingleKit(config([corner(section('L', 1000), 'LEFT'), section('m', 1000)], { depth: 500 }));
    store().updateSection('L', { width: 1200 });
    store().updateSection('L', { height: 2500 });
    expect(activeConfig().sections[0]).toMatchObject({ width: 1200, height: 2500, corner: 'LEFT' });
    expect(activeConfig().depth).toBe(500);
  });
});

describe('store — every kit keeps its own corners', () => {
  const store = () => useConfiguratorStore.getState();
  beforeEach(() => loadSingleKit(config([corner(section('a', 1000), 'LEFT'), section('b', 1000)])));

  it('different kits hold different corners; switching kits preserves them', () => {
    expect(store().addKit().ok).toBe(true);
    const second = store().kits[1];
    store().updateSection(second.configuration.sections[0].id, { corner: 'RIGHT' });
    expect(store().kits.map((k) => corners(k.configuration))).toEqual([['LEFT', 'NONE'], ['RIGHT']]);
    store().selectKit(store().kits[0].id);
    store().selectKit(store().kits[1].id);
    expect(store().kits.map((k) => corners(k.configuration))).toEqual([['LEFT', 'NONE'], ['RIGHT']]);
  });

  it('duplicating a kit copies its corners with fresh ids; the 5-kit and 5-rack limits are unchanged', () => {
    expect(store().duplicateKit(store().kits[0].id).ok).toBe(true);
    const [a, b] = store().kits;
    expect(corners(b.configuration)).toEqual(corners(a.configuration));
    expect(b.id).not.toBe(a.id);
    expect(b.configuration.sections.map((s) => s.id)).not.toEqual(a.configuration.sections.map((s) => s.id));
    for (let i = 0; i < 10; i += 1) store().duplicateKit(store().kits[0].id);
    expect(store().kits.length).toBeLessThanOrEqual(5);
    expect(getWorkspaceRackCount(store().kits)).toBeLessThanOrEqual(MAX_KITS_PER_ORDER);
  });
});

/* -------------------------------------------------------------------------- */
describe('share links and persistence carry every corner', () => {
  const cfg = config([corner(section('a', 1200, 1500, 4), 'LEFT'), section('b', 1000, 2500, 8), corner(section('c', 700, 2000, 5), 'RIGHT')]);

  it('a v4 kit link round-trips every section with its orientation, in order', () => {
    const query = configurationToShareQuery(cfg);
    expect(query).toContain('v=4');
    const parsed = parseConfigurationFromSearchParams(new URLSearchParams(query));
    expect(parsed.sections!.map(({ id: _id, ...s }) => s)).toEqual(cfg.sections.map(({ id: _id, ...s }) => s));
  });

  it('a v3 workspace link (language switch) round-trips different corners per kit', () => {
    const other = config([corner(section('x', 1000), 'RIGHT')]);
    const link = parseWorkspaceFromSearchParams(new URLSearchParams(workspaceToShareQuery([cfg, other], 1)))!;
    expect(link.activeIndex).toBe(1);
    expect(link.kits.map((k) => corners(k as ShelvingConfiguration))).toEqual([['LEFT', 'NONE', 'RIGHT'], ['RIGHT']]);
  });

  it('a V2.5 link (v2 kits, no corner field) opens as all-straight', () => {
    const v2 = new URLSearchParams('v=2&model=ms-standard&depth=400&sections=1000:2000:5:0:0:0,700:1500:4:1:0:0');
    expect(corners(parseConfigurationFromSearchParams(v2) as ShelvingConfiguration)).toEqual(['NONE', 'NONE']);
    const v2kit = configurationToShareQuery(cfg).replace('v=4', 'v=2').replace(/sections=[^&]*/, 'sections=1000%3A2000%3A5%3A0%3A0%3A0');
    const workspace = new URLSearchParams({ v: '3', active: '1', k1: v2kit });
    expect(corners(parseWorkspaceFromSearchParams(workspace)!.kits[0] as ShelvingConfiguration)).toEqual(['NONE']);
  });

  it('a malformed or misplaced corner discards the whole section list (no positional shift) and the whole v3 link', () => {
    for (const sections of [
      '1000:2000:5:0:0:0:X',
      '1000:2000:5:0:0:0:l',
      '1000:2000:5:0:0:0',
      '1000:2000:5:0:0:0:N:N',
      '1000:2000:5:0:0:0:N,1000:2000:5:0:0:0:L',
      '1000:2000:5:0:0:0:R,1000:2000:5:0:0:0:N',
      '1000:2000:5:0:0:0:N,1000:2000:5:0:0:0:R,1000:2000:5:0:0:0:N',
      '1000:2000:5:0:0:0:L,1000:2000:5:0:0:0:L',
    ]) {
      const parsed = parseConfigurationFromSearchParams(new URLSearchParams(`v=4&model=ms-standard&sections=${sections}`));
      expect(parsed.sections, sections).toBeUndefined();
      const kit = configurationToShareQuery(cfg).replace(/sections=[^&]*/, `sections=${encodeURIComponent(sections)}`);
      expect(parseWorkspaceFromSearchParams(new URLSearchParams({ v: '3', active: '1', k1: kit })), sections).toBeNull();
    }
  });

  it('persistence keeps corners exactly and rejects missing, unknown or misplaced ones', () => {
    const stored = JSON.parse(JSON.stringify(cfg));
    expect(readPersistedConfiguration(stored)).toEqual(stored);
    const without = JSON.parse(JSON.stringify(cfg, (k, v) => (k === 'corner' ? undefined : v)));
    expect(readPersistedConfiguration(without)).toBeUndefined();
    expect(corners(upgradeStraightConfiguration(without)!)).toEqual(['NONE', 'NONE', 'NONE']);
    expect(upgradeStraightConfiguration(stored)).toBeUndefined(); // already has corners: not V2.5 data
    for (const bad of ['UP', 1, null, 'left']) {
      expect(readPersistedConfiguration({ ...stored, sections: [{ ...stored.sections[0], corner: bad }] })).toBeUndefined();
    }
    expect(readPersistedConfiguration({ ...stored, sections: [stored.sections[1], stored.sections[0]] })).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
describe('world geometry (rack-world.ts)', () => {
  const D = 500;

  it('LEFT: the first section turns backward at the left edge — its width runs along z, the depth along x', () => {
    const L = corner(section('L', 1200), 'LEFT');
    const { placements, bounds } = layoutRackWorld([L, section('m', 1000)], D);
    const [p, m] = placements;
    expect(p.footprint).toEqual({ x0: 0, x1: D, z0: 0, z1: 1200 });
    expect(m.footprint).toEqual({ x0: D, x1: D + 1000, z0: 0, z1: D });
    // A pure rotation (never a mirror): the stored width runs along widthAxis, the depth along depthAxis.
    expect(p.widthAxis.x * p.depthAxis.z - p.widthAxis.z * p.depthAxis.x).toBe(1);
    const a = toWorld(p, 0, 0);
    const b = toWorld(p, L.width, 0);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBe(1200);
    expect(Math.abs(b.z - a.z)).toBe(1200); // along z — backward
    const c = toWorld(p, 0, D);
    expect(Math.abs(c.x - a.x)).toBe(D); // the depth runs along x
    // The corner's back stands against the row's first section; its front faces outward.
    expect(worldFaceOf(p, 'rear')).toBe('xMax');
    expect(p.footprint.x1).toBe(m.footprint.x0);
    expect(bounds).toEqual({ x0: 0, x1: D + 1000, z0: 0, z1: 1200 });
  });

  it('RIGHT: the last section turns backward at the right edge', () => {
    const R = corner(section('R', 700), 'RIGHT');
    const { placements, bounds } = layoutRackWorld([section('m', 1000), R], D);
    const p = placements[1];
    expect(p.footprint).toEqual({ x0: 1000, x1: 1000 + D, z0: 0, z1: 700 });
    expect(p.widthAxis).toEqual({ x: 0, z: 1 });
    expect(worldFaceOf(p, 'rear')).toBe('xMin');
    expect(worldFaceOf(p, 'left')).toBe('zMin'); // its left end is the near end
    expect(bounds).toEqual({ x0: 0, x1: 1000 + D, z0: 0, z1: 700 }); // the corner reaches further back than the depth
  });

  it('LEFT + RIGHT with straight sections between, and with none', () => {
    const both = [corner(section('L', 1500), 'LEFT'), section('a', 1000), section('b', 1200), corner(section('R', 1000), 'RIGHT')];
    const { placements, bounds } = layoutRackWorld(both, 400);
    expect(placements.map((p) => [p.footprint.x0, p.footprint.x1])).toEqual([
      [0, 400],
      [400, 1400],
      [1400, 2600],
      [2600, 3000],
    ]);
    expect(bounds.z1).toBe(1500);
    expect(getRackFootprintMm(both, 400)).toEqual({ width: 3000, depth: 1500 });
    expect(getRackFootprintMm([corner(section('L', 1000), 'LEFT'), corner(section('R', 1000), 'RIGHT')], 400)).toEqual({ width: 800, depth: 1000 });
    // Straight: exactly Σ widths × depth, as always.
    expect(getRackFootprintMm([section('a', 1000), section('b', 700)], 400)).toEqual({ width: 1700, depth: 400 });
  });

  it('stored width and depth never swap, and each section keeps exactly its own four uprights', () => {
    const rack = [corner(section('L', 1200), 'LEFT'), section('m', 1000), corner(section('R', 700), 'RIGHT')];
    const before = JSON.stringify(rack);
    const world = layoutRackWorld(rack, D);
    expect(JSON.stringify(rack)).toBe(before);
    for (const p of world.placements) {
      const posts = sectionUprightsMm(p, D);
      expect(posts).toHaveLength(4);
      const xs = posts.map((q) => q.x);
      const zs = posts.map((q) => q.z);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(p.corner === 'NONE' ? p.section.width : D);
      expect(Math.max(...zs) - Math.min(...zs)).toBe(p.corner === 'NONE' ? D : p.section.width);
    }
    // No shared post: every upright position is distinct across the rack (inset by half a post).
    const all = world.placements.flatMap((p) => sectionUprightsMm(p, D, 20)).map((q) => `${q.x},${q.z}`);
    expect(new Set(all).size).toBe(all.length);
  });
});

/* -------------------------------------------------------------------------- */
const num = (el: Element, attr: string) => Number(el.getAttribute(attr));

function measure(svg: SVGSVGElement, i: number) {
  const at = `[data-section-index="${i}"]`;
  const front = Array.from(svg.querySelectorAll(`rect[data-upright="front"]${at}`)).sort((a, b) => num(a, 'x') - num(b, 'x'));
  const rear = Array.from(svg.querySelectorAll(`rect[data-upright="rear"]${at}`)).sort((a, b) => num(a, 'x') - num(b, 'x'));
  return {
    front,
    rear,
    left: num(front[0], 'x'),
    right: num(front[1], 'x') + num(front[1], 'width'),
    top: num(front[0], 'y'),
    bottoms: front.map((r) => num(r, 'y') + num(r, 'height')),
    lips: svg.querySelectorAll(`rect[data-shelf-part="front-lip"]${at}`).length,
  };
}

function renderRack(sections: ShelvingSection[], depth = 400, extra: Record<string, unknown> = {}) {
  const cfg = config(sections, { depth });
  const { container } = render(createElement(ShelvingPreview, { config: cfg, ...extra }));
  return { svg: container.querySelector('svg')!, container, cfg };
}

describe.each([
  ['static preview', {}],
  ['configurator (capacity envelope)', { interactive: true, capacityMm: CAPACITY, activeSectionId: 'L' }],
])('drawing — %s', (_name, extra) => {
  const racks: [string, ShelvingSection[]][] = [
    ['LEFT', [corner(section('L', 1200, 1500, 4), 'LEFT'), section('m', 1000, 2000, 5)]],
    ['RIGHT', [section('L', 1000, 2000, 5), corner(section('R', 1500, 2500, 8), 'RIGHT')]],
    ['LEFT + RIGHT', [corner(section('L', 1000, 2000, 5), 'LEFT'), section('m', 700, 1000, 2), corner(section('R', 1200, 3000, 8), 'RIGHT')]],
    [
      'five sections, both corners, mixed',
      [
        corner(section('L', 1500, 2500, 8, { rearWall: true, rightWall: true }), 'LEFT'),
        section('b', 700, 1000, 2),
        section('c', 1000, 1800, 6, { leftWall: true }),
        section('d', 1200, 2200, 4),
        corner(section('R', 1000, 1500, 3, { leftWall: true }), 'RIGHT'),
      ],
    ],
  ];

  it.each(racks)('%s: true scale, own heights/shelves/uprights, common floor, inside the frame', (_label, sections) => {
    const depth = 400;
    const { svg, cfg } = renderRack(sections, depth, extra);
    const capacity = 'capacityMm' in extra ? CAPACITY : undefined;
    const scale = fitPxPerMm(rackEnvelopeMm(sections, depth, capacity));
    const measured = sections.map((_, i) => measure(svg, i));
    measured.forEach((m, i) => {
      const s = sections[i];
      expect(m.front).toHaveLength(2); // 4 uprights: 2 front + 2 rear, per section
      expect(m.rear).toHaveLength(2);
      // Front span: its width if straight, the kit DEPTH if a corner — never swapped values.
      expect(m.right - m.left).toBeCloseTo((s.corner === 'NONE' ? s.width : depth) * scale, 9);
      // Reach backward: the depth if straight, its own WIDTH if a corner (horizontal part is never compressed).
      expect(num(m.rear[0], 'x') - num(m.front[0], 'x')).toBeCloseTo((s.corner === 'NONE' ? depth : s.width) * scale * COS, 9);
      // Own height, standing on the common floor.
      expect(FLOOR_Y - m.top).toBeCloseTo(s.height * scale, 9);
      for (const b of m.bottoms) expect(b).toBeCloseTo(FLOOR_Y, 9);
      expect(m.lips).toBe(s.shelves);
    });
    // Contiguous front line; two uprights side by side at every junction (never shared).
    for (let i = 1; i < measured.length; i += 1) {
      expect(measured[i].left).toBeCloseTo(measured[i - 1].right, 9);
      expect(num(measured[i].front[0], 'x') - num(measured[i - 1].front[1], 'x')).toBeCloseTo(POST_WIDTH, 9);
    }
    // Every upright inside the drawing and, in the configurator, inside both framed crops.
    const crops = computeFramedCrops(cfg.sections, depth, capacity);
    for (const r of Array.from(svg.querySelectorAll('rect[data-upright]'))) {
      const [x0, y0, x1, y1] = [num(r, 'x'), num(r, 'y'), num(r, 'x') + num(r, 'width'), num(r, 'y') + num(r, 'height')];
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(VIEWBOX_W);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(y1).toBeLessThanOrEqual(VIEWBOX_H);
      if (capacity) {
        for (const crop of [crops.wide, crops.compact]) {
          expect(x0).toBeGreaterThanOrEqual(crop.x);
          expect(x1).toBeLessThanOrEqual(crop.x + crop.w);
          expect(y0).toBeGreaterThanOrEqual(crop.y);
        }
      }
    }
    // Corner width labels state the stored width (↗ = backward), the total states the real front line.
    for (const s of sections.filter((x) => x.corner !== 'NONE')) expect(svg.textContent).toContain(`↗ ${s.width}`);
    expect(svg.querySelector('[data-testid="total-width-tag"]')!.textContent).toContain(String(getRackFootprintMm(sections, depth).width));
  });

  it('walls stand on the face the orientation puts them — a corner draws exactly its selected walls', () => {
    const sections = [corner(section('L', 1000, 2000, 5, { rearWall: true, leftWall: true, rightWall: true }), 'LEFT'), section('m', 1000)];
    const { svg } = renderRack(sections, 400, extra);
    const faces = Array.from(svg.querySelectorAll('[data-section-index="0"] polygon[data-wall]')).map((p) => `${p.getAttribute('data-wall')}:${p.getAttribute('data-face')}`);
    expect(faces.sort()).toEqual(['left:zMax', 'rear:xMax', 'right:zMin']);
    expect(svg.querySelectorAll('[data-section-index="1"] polygon[data-wall]')).toHaveLength(0);
  });
});

describe('drawing — a straight rack is unchanged by V2.6', () => {
  it('draws no corner label, the plain total and the depth tag', () => {
    const { svg } = renderRack([section('a', 1000), section('b', 1200)], 400, { interactive: true, capacityMm: CAPACITY, activeSectionId: 'a' });
    expect(svg.textContent).not.toContain('↗');
    expect(svg.querySelector('[data-testid="total-width-tag"]')!.textContent).toContain('2200');
    expect(svg.querySelector('[data-testid="depth-dimension-tag"]')).not.toBeNull();
    expect(Array.from(svg.querySelectorAll('polygon[data-wall]'))).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('stable scale and frame with corners', () => {
  const rack = (w: number, h = 2000) => [corner(section('L', w, h), 'LEFT'), section('m', 1000), corner(section('R', 1000), 'RIGHT')];

  it('neither a corner width nor a height changes the configurator scale, receding direction or frame', () => {
    const scales = new Set<number>();
    const vecs = new Set<string>();
    const cropKeys = new Set<string>();
    for (const w of [700, 1000, 1200, 1500]) {
      for (const h of [1500, 2000]) {
        const sections = rack(w, h);
        const scale = fitPxPerMm(rackEnvelopeMm(sections, 400, CAPACITY));
        scales.add(scale);
        const frames = layoutSectionFrames(sections, scale, RACK_LEFT_MARGIN, FLOOR_Y, 400);
        if (h === 2000) vecs.add(JSON.stringify(computeRackDepthVec(frames, 400, scale, CAPACITY.width)));
        const crops = computeFramedCrops(sections, 400, CAPACITY);
        cropKeys.add(JSON.stringify([crops.wide.w, crops.wide.h, crops.compact.w, crops.compact.h]));
      }
    }
    expect(scales.size).toBe(1);
    expect(vecs.size).toBe(1);
    expect(cropKeys.size).toBe(1);
  });

  it('a corner width drag moves only its own far end — nothing else in the row', () => {
    const scale = fitPxPerMm(rackEnvelopeMm(rack(1000), 400, CAPACITY));
    const a = layoutSectionFrames(rack(1000), scale, RACK_LEFT_MARGIN, FLOOR_Y, 400);
    const b = layoutSectionFrames(rack(1437), scale, RACK_LEFT_MARGIN, FLOOR_Y, 400);
    expect(b.map((f) => [f.x, f.width, f.top])).toEqual(a.map((f) => [f.x, f.width, f.top]));
    expect(b[0].recedeMm).toBe(1437);
    expect(b.slice(1).map((f) => f.recedeMm)).toEqual(a.slice(1).map((f) => f.recedeMm));
  });

  it('a corner height drag changes only its own top, never its footprint', () => {
    const scale = fitPxPerMm(rackEnvelopeMm(rack(1000), 400, CAPACITY));
    const a = layoutSectionFrames(rack(1000, 2000), scale, RACK_LEFT_MARGIN, FLOOR_Y, 400);
    const b = layoutSectionFrames(rack(1000, 2500), scale, RACK_LEFT_MARGIN, FLOOR_Y, 400);
    expect(b[0].top).toBeCloseTo(FLOOR_Y - 2500 * scale, 9);
    expect([b[0].x, b[0].width, b[0].recedeMm]).toEqual([a[0].x, a[0].width, a[0].recedeMm]);
    expect(b.slice(1)).toEqual(a.slice(1));
  });
});

/* -------------------------------------------------------------------------- */
function fakePointer(clientX: number, clientY: number): ReactPointerEvent<Element> {
  return {
    clientX,
    clientY,
    pointerId: 1,
    preventDefault: () => {},
    currentTarget: { setPointerCapture: () => {}, releasePointerCapture: () => {} },
  } as unknown as ReactPointerEvent<Element>;
}
const CONTAINER = {
  current: { getBoundingClientRect: () => ({ width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect },
} as unknown as RefObject<HTMLElement | null>;

describe('corner width drag — the pointer is projected onto the rotated axis', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const sections = [corner(section('L', 1000), 'LEFT'), section('m', 1000)];
  const scale = fitPxPerMm(rackEnvelopeMm(sections, 400, CAPACITY));
  const frames = layoutSectionFrames(sections, scale, RACK_LEFT_MARGIN, FLOOR_Y, 400);
  const depthVec = computeRackDepthVec(frames, 400, scale, CAPACITY.width);
  const perMm = { x: depthVec.dx / 400, y: depthVec.dy / 400 };

  function drag(axisVectorPx: { x: number; y: number } | undefined, moves: [number, number][]) {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook((props: { v?: { x: number; y: number } }) =>
      useDimensionDrag({ axis: 'width', committedValue: 1000, allowedValues: [700, 1000, 1200, 1500], containerRef: CONTAINER, pxPerMm: scale, axisVectorPx: props.v, onCommit }),
      { initialProps: { v: axisVectorPx } },
    );
    act(() => result.current.onPointerDown(fakePointer(100, 100)));
    const values: number[] = [];
    for (const [dx, dy] of moves) {
      act(() => {
        result.current.onPointerMove(fakePointer(100 + dx, 100 + dy));
        vi.advanceTimersByTime(16);
      });
      values.push(result.current.displayValue);
    }
    return { result, values, onCommit, rerender };
  }

  it('moving along the receding diagonal changes the width 1:1 in millimetres; the far end stays under the pointer', () => {
    const { values } = drag(perMm, [
      [150 * perMm.x, 150 * perMm.y],
      [300 * perMm.x, 300 * perMm.y],
      [-200 * perMm.x, -200 * perMm.y],
    ]);
    expect(values[0]).toBeCloseTo(1150, 6);
    expect(values[1]).toBeCloseTo(1300, 6);
    expect(values[2]).toBeCloseTo(800, 6);
    // The live far end sits exactly where the committed layout of that width puts it.
    const live = layoutSectionFrames([corner(section('L', values[1]), 'LEFT'), section('m', 1000)], scale, RACK_LEFT_MARGIN, FLOOR_Y, 400)[0];
    expect(live.recedeMm * perMm.x - 1000 * perMm.x).toBeCloseTo(300 * perMm.x, 6);
  });

  it('movement perpendicular to the diagonal does not change the width (no jump from the wrong axis)', () => {
    const { values } = drag(perMm, [[perMm.y * 200, -perMm.x * 200]]);
    expect(values[0]).toBeCloseTo(1000, 6);
    expect(projectOnVector(perMm.y, -perMm.x, perMm)).toBeCloseTo(0, 12);
  });

  it('the axis is frozen at pointer-down: a new vector mid-gesture never rescales the drag', () => {
    const { result, rerender } = drag(perMm, []);
    rerender({ v: { x: perMm.x * 3, y: perMm.y * 3 } });
    act(() => {
      result.current.onPointerMove(fakePointer(100 + 100 * perMm.x, 100 + 100 * perMm.y));
      vi.advanceTimersByTime(16);
    });
    expect(result.current.displayValue).toBeCloseTo(1100, 6);
  });

  it('release snaps to the nearest allowed width once and commits once', () => {
    const { result, onCommit } = drag(perMm, [[260 * perMm.x, 260 * perMm.y]]);
    act(() => result.current.onPointerUp(fakePointer(0, 0)));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('width', 1200);
  });

  it('straight sections keep the plain horizontal axis (no vector)', () => {
    const { values } = drag(undefined, [[200 * scale, 999]]);
    expect(values[0]).toBeCloseTo(1200, 6);
  });
});

/* -------------------------------------------------------------------------- */
describe('top view with corners', () => {
  /** Each drawn footprint in viewBox units, by section number. */
  function footprints(container: HTMLElement) {
    return Array.from(container.querySelectorAll('[data-plan-section]')).map((g) => {
      const r = g.querySelector('rect')!;
      return {
        n: Number(g.getAttribute('data-plan-section')),
        corner: g.getAttribute('data-corner'),
        x: Number(r.getAttribute('x')),
        y: Number(r.getAttribute('y')),
        w: Number(r.getAttribute('width')),
        h: Number(r.getAttribute('height')),
      };
    });
  }

  it('draws the real world plan of a corner kit, never a straight row or a notice; a straight rack keeps its own plan', () => {
    const cfg = config([corner(section('L', 1500), 'LEFT'), section('m', 1000), corner(section('R', 1200), 'RIGHT')]);
    const withCorners = render(createElement(TopShelvingPreview, { config: cfg }));
    expect(withCorners.container.querySelector('[data-testid="top-view-corner-plan"] svg')).not.toBeNull();
    expect(withCorners.container.querySelector('[data-testid="top-view-corner-notice"]')).toBeNull();
    const [left, middle, right] = footprints(withCorners.container);
    expect([left.corner, middle.corner, right.corner]).toEqual(['LEFT', 'NONE', 'RIGHT']);

    // One uniform scale on both axes: every footprint is exactly its world
    // footprint (rack-world.ts) times the same factor.
    const { placements } = layoutRackWorld(cfg.sections, cfg.depth);
    const scale = middle.w / 1000;
    placements.forEach((p, i) => {
      const drawn = [left, middle, right][i];
      expect(drawn.w).toBeCloseTo((p.footprint.x1 - p.footprint.x0) * scale, 6);
      expect(drawn.h).toBeCloseTo((p.footprint.z1 - p.footprint.z0) * scale, 6);
    });
    // A corner's width runs backward: it spans the kit depth along the front
    // line and its own width back; the straight section the reverse.
    expect(left.w).toBeCloseTo(cfg.depth * scale, 6);
    expect(left.h).toBeCloseTo(1500 * scale, 6);
    expect(right.h).toBeCloseTo(1200 * scale, 6);
    expect(middle.h).toBeCloseTo(cfg.depth * scale, 6);
    // Side by side along the front line, all standing on it (a U, not a row).
    expect(middle.x).toBeCloseTo(left.x + left.w, 6);
    expect(right.x).toBeCloseTo(middle.x + middle.w, 6);
    for (const f of [left, middle, right]) expect(f.y + f.h).toBeCloseTo(left.y + left.h, 6);

    // Dimensions: each corner's own width beside it, the front line's real
    // length, and no kit depth (neither end is straight).
    expect(withCorners.getByTestId('plan-corner-width-1').textContent).toBe('1500');
    expect(withCorners.getByTestId('plan-corner-width-3').textContent).toBe('1200');
    expect(withCorners.queryByTestId('plan-depth')).toBeNull();
    expect(withCorners.container.textContent).toContain(`${getRackFootprintMm(cfg.sections, cfg.depth).width} мм`);
    // Every section draws its own two end frames.
    expect(withCorners.container.querySelectorAll('[data-plan-frame]')).toHaveLength(6);
    cleanup();

    const leftOnly = render(createElement(TopShelvingPreview, { config: config([corner(section('L', 1000), 'LEFT'), section('m', 1000)]) }));
    expect(leftOnly.getByTestId('plan-depth').textContent).toBe('400');
    cleanup();

    const straight = render(createElement(TopShelvingPreview, { config: config([section('a', 1000)]) }));
    expect(straight.container.querySelector('svg')).not.toBeNull();
    expect(straight.container.querySelector('[data-testid="top-view-corner-plan"]')).toBeNull();
  });

  it('selects a section from its footprint, by pointer or keyboard', () => {
    const onSelectSection = vi.fn();
    const cfg = config([corner(section('L', 1000), 'LEFT'), section('m', 1000)]);
    const view = render(createElement(TopShelvingPreview, { config: cfg, interactive: true, activeSectionId: 'm', onSelectSection }));
    const leftButton = view.container.querySelector('[data-plan-section="1"]')!;
    expect(leftButton.getAttribute('role')).toBe('button');
    expect(leftButton.getAttribute('tabindex')).toBe('0');
    expect(leftButton.getAttribute('aria-label')).toContain('1000');
    expect(leftButton.getAttribute('aria-pressed')).toBe('false');
    expect(view.container.querySelector('[data-plan-section="2"]')!.getAttribute('aria-pressed')).toBe('true');
    leftButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelectSection).toHaveBeenLastCalledWith('L');
    leftButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelectSection).toHaveBeenCalledTimes(2);
  });
});
