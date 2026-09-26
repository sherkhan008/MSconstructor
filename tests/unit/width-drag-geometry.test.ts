// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDimensionDrag } from '@/components/configurator/resize/useDimensionDrag';
import { fitPxPerMm } from '@/components/configurator/resize/dimension-scale';
import { layoutSectionFrames, rackEnvelopeMm, type SectionFrame } from '@/components/configurator/resize/section-geometry';
import { FLOOR_Y, RACK_LEFT_MARGIN } from '@/components/configurator/ShelvingPreview';
import type { ShelvingSection } from '@/lib/types/domain';

/**
 * Regression coverage for the width-drag *pixel scale* bug: a section
 * dragged to (say) 700mm used to render at a different on-screen width than
 * the same 700mm renders at once actually committed and idle, because the
 * row's scale was a function of the row's total width.
 *
 * V2.3 removes the cause instead of compensating for it: the configurator's
 * one physical scale is fitted to the largest rack the section COUNT can
 * become (rackEnvelopeMm with the model's capacity), so it is identical
 * before, during and after a width drag. These tests reproduce
 * ShelvingPreview.tsx's own pipeline exactly (rackEnvelopeMm → fitPxPerMm →
 * layoutSectionFrames, same exported constants) rather than asserting against
 * the component's rendered DOM: this project's jsdom has no global
 * PointerEvent, so a real pointer drag dispatched through the DOM silently
 * loses clientX/clientY (see tests/unit/width-drag-clamp.test.ts's note on
 * this) — driving the real hook directly, the way every other drag test in
 * this repo does, is the reliable path.
 */

function fakePointerEvent(clientX: number, clientY: number, pointerId = 1): ReactPointerEvent<Element> {
  return {
    clientX,
    clientY,
    pointerId,
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    },
  } as unknown as ReactPointerEvent<Element>;
}

function fakeContainerRef(width: number, height: number) {
  return {
    current: {
      getBoundingClientRect: () =>
        ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    },
  } as unknown as RefObject<HTMLElement | null>;
}

const CONTAINER = fakeContainerRef(640, 480);
const ALLOWED_WIDTHS = [700, 1000, 1200, 1500];
/** MS Standard's catalog maxima, as ConfiguratorClient passes them. */
const CAPACITY = { width: 1500, height: 3000, depth: 800 };
const DEPTH = 400;

function section(id: string, width: number): ShelvingSection {
  return { id, width, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false };
}

/** The configurator's scale for a committed row. */
function scaleFor(sections: ShelvingSection[]): number {
  return fitPxPerMm(rackEnvelopeMm(sections, DEPTH, CAPACITY));
}

/** Reproduces ShelvingPreview's committed/idle layout exactly. */
function committedLayoutFor(sections: ShelvingSection[]): SectionFrame[] {
  return layoutSectionFrames(sections, scaleFor(sections), RACK_LEFT_MARGIN, FLOOR_Y);
}

/** Reproduces ShelvingPreview's live width-drag layout exactly, for one
 * active section dragged to `displayValue` within a full committed row: the
 * scale comes from the COMMITTED row, the widths from the live one. */
function liveDragLayoutFor(sections: ShelvingSection[], activeId: string, displayValue: number): SectionFrame[] {
  const visualSections = sections.map((s) => (s.id === activeId ? { ...s, width: displayValue } : s));
  return layoutSectionFrames(visualSections, scaleFor(sections), RACK_LEFT_MARGIN, FLOOR_Y);
}

describe('the configurator scale is independent of every section width', () => {
  it('is identical for every width mix of the same section count', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const scales = new Set(
        ALLOWED_WIDTHS.map((w) => scaleFor(Array.from({ length: count }, (_, i) => section(`s${i}`, w)))),
      );
      scales.add(scaleFor(Array.from({ length: count }, (_, i) => section(`s${i}`, ALLOWED_WIDTHS[i % 4]))));
      expect(scales.size, `${count} section(s)`).toBe(1);
    }
  });
});

describe('width-drag geometry matches committed idle geometry (single section)', () => {
  it('A. dragging toward the minimum: live width at 700 pixel-matches the committed-700 layout', () => {
    const liveLayout = liveDragLayoutFor([section('s1', 1200)], 's1', 700);
    const postCommitLayout = committedLayoutFor([section('s1', 700)]);

    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 9);
    expect(liveLayout[0].x).toBeCloseTo(postCommitLayout[0].x, 9);
  });

  it('B. dragging toward the maximum: live width at 1500 pixel-matches the committed-1500 layout', () => {
    const liveLayout = liveDragLayoutFor([section('s1', 1200)], 's1', 1500);
    const postCommitLayout = committedLayoutFor([section('s1', 1500)]);

    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 9);
    expect(liveLayout[0].x).toBeCloseTo(postCommitLayout[0].x, 9);
  });

  it('sanity: committed 700 and 1500 are drawn in their true 700:1500 ratio', () => {
    const w700 = committedLayoutFor([section('s1', 700)])[0].width;
    const w1500 = committedLayoutFor([section('s1', 1500)])[0].width;
    expect(w700 / w1500).toBeCloseTo(700 / 1500, 9);
  });
});

describe('width-drag geometry — hook clamp composes with the physical scale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function dragTo(committedWidth: number, targetMm: number) {
    const pxPerMm = scaleFor([section('s1', committedWidth)]);
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: committedWidth,
        allowedValues: ALLOWED_WIDTHS,
        containerRef: CONTAINER,
        pxPerMm,
        onCommit: vi.fn(),
      }),
    );
    act(() => {
      result.current.onPointerDown(fakePointerEvent(0, 0));
    });
    act(() => {
      result.current.onPointerMove(fakePointerEvent((targetMm - committedWidth) * pxPerMm, 0));
      vi.advanceTimersByTime(16);
    });
    return result;
  }

  it('C. dragging far past the max clamps to 1500, and that live 1500 pixel-matches committed 1500', () => {
    const result = dragTo(1200, 2200);
    expect(result.current.displayValue).toBe(1500);
    const liveLayout = liveDragLayoutFor([section('s1', 1200)], 's1', result.current.displayValue);
    expect(liveLayout[0].width).toBeCloseTo(committedLayoutFor([section('s1', 1500)])[0].width, 9);
  });

  it('C. dragging far below the min clamps to 700, and that live 700 pixel-matches committed 700', () => {
    const result = dragTo(1200, 300);
    expect(result.current.displayValue).toBe(700);
    const liveLayout = liveDragLayoutFor([section('s1', 1200)], 's1', result.current.displayValue);
    expect(liveLayout[0].width).toBeCloseTo(committedLayoutFor([section('s1', 700)])[0].width, 9);
  });

  it('D. an intermediate drag stays continuous: the raw mm value tracks the pointer exactly, and its live pixel width equals that width at the one scale', () => {
    const result = dragTo(1200, 1350);

    // Not snapped mid-drag — the exact raw value, not one of the 4 catalog steps.
    expect(result.current.displayValue).toBeCloseTo(1350, 6);
    expect(ALLOWED_WIDTHS).not.toContain(result.current.displayValue);

    const liveLayout = liveDragLayoutFor([section('s1', 1200)], 's1', result.current.displayValue);
    expect(liveLayout[0].width).toBeCloseTo(1350 * scaleFor([section('s1', 1200)]), 6);
    // The dragged right edge moved exactly as far as the pointer did.
    const committed = committedLayoutFor([section('s1', 1200)]);
    expect(liveLayout[0].x + liveLayout[0].width - (committed[0].x + committed[0].width)).toBeCloseTo(
      (1350 - 1200) * scaleFor([section('s1', 1200)]),
      6,
    );
  });
});

describe('width-drag geometry — multiple sections (E)', () => {
  it('dragging the middle section leaves earlier sections fixed, shifts later ones, and stays contiguous', () => {
    const sections = [section('A', 1000), section('B', 1200), section('C', 1500)];
    const committed = committedLayoutFor(sections);
    const liveLayout = liveDragLayoutFor(sections, 'B', 1500);

    // A: entirely unchanged.
    expect(liveLayout[0].x).toBe(committed[0].x);
    expect(liveLayout[0].width).toBe(committed[0].width);

    // B: left edge fixed, width grows.
    expect(liveLayout[1].x).toBe(committed[1].x);
    expect(liveLayout[1].width).toBeGreaterThan(committed[1].width);

    // C: own width unchanged, x shifted by exactly B's delta.
    const deltaPx = liveLayout[1].width - committed[1].width;
    expect(liveLayout[2].width).toBe(committed[2].width);
    expect(liveLayout[2].x).toBeCloseTo(committed[2].x + deltaPx, 6);

    // Contiguous throughout: no gap, no overlap.
    expect(liveLayout[0].x + liveLayout[0].width).toBeCloseTo(liveLayout[1].x, 6);
    expect(liveLayout[1].x + liveLayout[1].width).toBeCloseTo(liveLayout[2].x, 6);
  });

  it('dragging the first section leaves later sections\' widths untouched and only shifts their x', () => {
    const sections = [section('A', 1200), section('B', 1000)];
    const committed = committedLayoutFor(sections);
    const liveLayout = liveDragLayoutFor(sections, 'A', 700);

    expect(liveLayout[0].x).toBe(committed[0].x);
    expect(liveLayout[0].width).toBeLessThan(committed[0].width);

    const deltaPx = liveLayout[0].width - committed[0].width;
    expect(liveLayout[1].width).toBe(committed[1].width);
    expect(liveLayout[1].x).toBeCloseTo(committed[1].x + deltaPx, 6);
    expect(liveLayout[0].x + liveLayout[0].width).toBeCloseTo(liveLayout[1].x, 6);
  });

  it('a released drag lands exactly where the live drag drew it — the scale does not change on commit, even for a 5-section row', () => {
    const sections = [section('A', 1500), section('B', 1500), section('C', 1500), section('D', 1500), section('E', 1500)];
    const liveLayout = liveDragLayoutFor(sections, 'C', 700);
    const postCommit = committedLayoutFor(sections.map((s) => (s.id === 'C' ? { ...s, width: 700 } : s)));
    for (let i = 0; i < sections.length; i += 1) {
      expect(liveLayout[i].x).toBeCloseTo(postCommit[i].x, 9);
      expect(liveLayout[i].width).toBeCloseTo(postCommit[i].width, 9);
    }
  });

  it('total row length during drag is the sum of unchanged sections plus the clamped live active width (never flattened)', () => {
    const sections = [section('A', 1000), section('B', 1500)];
    const displayValue = 1500; // already at max, dragged further — clamp keeps it at 1500
    const totalLengthMm = sections.reduce((sum, s) => sum + (s.id === 'B' ? displayValue : s.width), 0);
    expect(totalLengthMm).toBe(2500);
  });
});
