// @vitest-environment jsdom
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_FRAME,
  FLOOR_Y,
  RACK_LEFT_MARGIN,
  ShelvingPreview,
  WIDE_FRAME,
  computeFramedCrop,
  framedCropWidth,
  type FrameProfile,
} from '@/components/configurator/ShelvingPreview';
import { VIEWBOX_H, VIEWBOX_W, depthVectorPx, fitPxPerMm } from '@/components/configurator/resize/dimension-scale';
import { layoutSectionFrames, rackEnvelopeMm } from '@/components/configurator/resize/section-geometry';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { uniformRow, type LooseSection, type UniformRowInput } from '../helpers/uniform-row';

/**
 * The configurator workspace crops the 640×480 viewBox down to the part the
 * rack actually occupies, which is what lets the drawing render markedly
 * larger without a single drawing coordinate changing. There are two crop
 * profiles — the approved 4:3 desktop framing and a tighter 6:5 phone
 * framing — and three properties of both are load-bearing:
 *
 *  1. The crop's size depends on the section COUNT and (compact only) the
 *     committed depth — never on section widths or heights. The crop drives
 *     the stage's zoom, so a crop that tracked widths or heights would
 *     rescale the whole drawing at the exact moment a drag commits (or,
 *     following a live drag, in the middle of it), sliding the rack out from
 *     under the pointer (see the "right upright does not jump on release"
 *     e2e specs). V2.3: it frames the physical envelope — the largest rack
 *     that section count can become — at the drawing's one uniform scale.
 *  2. It still contains everything that gets drawn — the row, the shelf-count
 *     column past its right edge, the height dimension on its left, and the
 *     width dimension stack under the floor — for every configuration the
 *     catalog allows.
 *  3. The compact profile really is tighter than the wide one, so the phone
 *     framing is the larger rack it is meant to be.
 */

function baseConfig(overrides: Partial<UniformRowInput> = {}): ShelvingConfiguration {
  return uniformRow({
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 4,
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

function sections(widths: number[]): LooseSection[] {
  return widths.map((width, i) => ({ id: `sec-${i + 1}`, width, rearWall: false, leftWall: false, rightWall: false }));
}

/** MS Standard's catalog maxima, as ConfiguratorClient passes them. */
const CAPACITY = { width: 1500, height: 3000, depth: 800 };

/** Both crop profiles as the stage publishes them, compact and wide. */
function stageVars(config: ShelvingConfiguration): string {
  const { container } = render(
    createElement(ShelvingPreview, { config, framed: true, interactive: true, activeSectionId: 'sec-1', capacityMm: CAPACITY }),
  );
  const stage = container.querySelector<HTMLElement>('[data-testid="preview-stage"]');
  if (!stage) throw new Error('framed preview stage not found');
  return (['c', 'w'] as const)
    .flatMap((p) => (['w', 'h', 'l', 't'] as const).map((k) => stage.style.getPropertyValue(`--stage-${p}-${k}`)))
    .join('|');
}

const CATALOG_WIDTHS = [700, 1000, 1200, 1500];
const CATALOG_HEIGHTS = [1500, 2000, 2500, 3000];
const CATALOG_DEPTHS = [300, 400, 500, 600, 700, 800];
const PROFILES: [string, FrameProfile][] = [
  ['wide', WIDE_FRAME],
  ['compact', COMPACT_FRAME],
];

/** The configurator's physical scale and envelope for `count` sections. */
function scaleFor(height: number, depth: number, count: number) {
  const row = baseConfig({ height, depth, sections: sections(Array.from({ length: count }, () => 1000)) });
  const envelope = rackEnvelopeMm(row.sections, depth, CAPACITY);
  return { envelope, pxPerMm: fitPxPerMm(envelope) };
}

/** The preview's own content budget, for whichever profile is being checked
 * — ShelvingPreview's exact `cropFor`. */
function cropFor(profile: FrameProfile, height: number, depth: number, count: number) {
  const { envelope, pxPerMm } = scaleFor(height, depth, count);
  const envelopeTop = FLOOR_Y - envelope.height * pxPerMm;
  const envelopeRearTop = envelopeTop + depthVectorPx(envelope.depth, pxPerMm).dy;
  const top = FLOOR_Y - height * pxPerMm;
  const { dx, dy } = depthVectorPx(depth, pxPerMm);
  return computeFramedCrop(
    profile,
    Math.min(envelopeTop - profile.top, envelopeRearTop - 8, top - profile.top, top + dy - 8),
    FLOOR_Y + profile.bottom,
    count,
    dx,
    envelope.rowWidth * pxPerMm,
  );
}

describe('framed workspace crop', () => {
  it('never changes when a section width or height changes — only the count and depth move it', () => {
    for (const count of [1, 2, 3, 5, 10]) {
      const variants = new Set(
        CATALOG_WIDTHS.flatMap((w) =>
          CATALOG_HEIGHTS.map((height) => stageVars(baseConfig({ height, sections: sections(Array.from({ length: count }, () => w)) }))),
        ),
      );
      expect(variants.size, `${count} section(s)`).toBe(1);
    }
  });

  it('is identical for a mixed-width row and a uniform row of the same section count', () => {
    expect(stageVars(baseConfig({ sections: sections([700, 1500, 1000]) }))).toBe(
      stageVars(baseConfig({ sections: sections([1000, 1000, 1000]) })),
    );
  });

  it('is identical for a mixed-height row and a uniform row of the same section count', () => {
    const mixed = baseConfig({
      sections: [
        { id: 'sec-1', width: 1000, height: 1500, shelves: 4, rearWall: false, leftWall: false, rightWall: false },
        { id: 'sec-2', width: 1200, height: 2500, shelves: 8, rearWall: false, leftWall: false, rightWall: false },
      ],
    });
    expect(stageVars(mixed)).toBe(stageVars(baseConfig({ sections: sections([1000, 1000]) })));
  });

  it('zooms in on the rack in both profiles — the stage is always larger than its frame', () => {
    for (const [name, profile] of PROFILES) {
      for (const height of CATALOG_HEIGHTS) {
        expect(VIEWBOX_W / cropFor(profile, height, 400, 1).w, `${name} ${height}`).toBeGreaterThan(1.3);
      }
    }
  });

  it('the phone profile is strictly tighter than the approved desktop one', () => {
    for (const height of CATALOG_HEIGHTS) {
      for (const depth of CATALOG_DEPTHS) {
        for (const count of [1, 2, 5]) {
          const wide = cropFor(WIDE_FRAME, height, depth, count).w;
          const compact = cropFor(COMPACT_FRAME, height, depth, count).w;
          expect(compact, `${height}/${depth}/${count}`).toBeLessThan(wide);
        }
      }
    }
  });

  it('stays inside the viewBox at the frame ratio, for every height and section count', () => {
    for (const [name, profile] of PROFILES) {
      for (const height of CATALOG_HEIGHTS) {
        for (const count of [1, 2, 5, 10]) {
          const crop = cropFor(profile, height, 400, count);
          expect(crop.x, name).toBeGreaterThanOrEqual(0);
          expect(crop.y, name).toBeGreaterThanOrEqual(0);
          expect(crop.x + crop.w).toBeLessThanOrEqual(VIEWBOX_W + 0.001);
          expect(crop.y + crop.h).toBeLessThanOrEqual(VIEWBOX_H + 0.001);
          expect(crop.w / crop.h).toBeCloseTo(profile.aspect, 6);
        }
      }
    }
  });

  it('is wide enough for the widest row its section count can be dragged to, plus the shelf-count column', () => {
    for (const [name, profile] of PROFILES) {
      for (const depth of CATALOG_DEPTHS) {
        for (const count of [1, 2, 3, 5, 10]) {
          const { envelope, pxPerMm } = scaleFor(2000, depth, count);
          const { dx } = depthVectorPx(depth, pxPerMm);
          const rowCeiling = envelope.rowWidth * pxPerMm;
          const cropRight = profile.left + framedCropWidth(profile, count, dx, rowCeiling);
          for (const rowWidths of [
            Array.from({ length: count }, () => CAPACITY.width), // the widest row
            Array.from({ length: count }, (_, i) => CATALOG_WIDTHS[i % CATALOG_WIDTHS.length]),
          ]) {
            const row = baseConfig({ sections: sections(rowWidths) }).sections;
            const laid = layoutSectionFrames(row, pxPerMm, RACK_LEFT_MARGIN, FLOOR_Y);
            const rowEnd = laid[laid.length - 1].x + laid[laid.length - 1].width;
            // Row, the shelf-count column at its real offset, and that column's
            // own 44px touch radius at the narrowest supported viewport.
            const shelfColumn = rowEnd + 24 + Math.min(dx, 30);
            // Its own 44px touch radius, expressed in viewBox units at the
            // narrowest supported phone frame (320px).
            const touchRadius = (22 * framedCropWidth(profile, count, dx, rowCeiling)) / 320;
            expect(shelfColumn + touchRadius, `${name} ${count}×${depth}`).toBeLessThanOrEqual(cropRight + 0.001);
            // The last section's rear uprights sit inside the crop too.
            expect(rowEnd + dx, `${name} ${count}×${depth}`).toBeLessThanOrEqual(cropRight);
          }
        }
      }
    }
  });

  it('contains the rear plane and the whole vertical dimension stack at every height and depth', () => {
    for (const [name, profile] of PROFILES) {
      for (const height of CATALOG_HEIGHTS) {
        for (const depth of CATALOG_DEPTHS) {
          const { pxPerMm } = scaleFor(height, depth, 1);
          const top = FLOOR_Y - height * pxPerMm;
          const rearTop = top + depthVectorPx(depth, pxPerMm).dy;
          const crop = cropFor(profile, height, depth, 1);
          expect(crop.y, `${name} ${height}/${depth}`).toBeLessThanOrEqual(rearTop);
          // The add buttons' own touch circle above the rack…
          expect(crop.y).toBeLessThanOrEqual(top - 24);
          // …and the total-width tag, which ends at FLOOR_Y + 89.5.
          expect(crop.y + crop.h, `${name} ${height}/${depth}`).toBeGreaterThanOrEqual(FLOOR_Y + 89.5);
        }
      }
    }
  });
});
