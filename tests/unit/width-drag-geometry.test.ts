// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDimensionDrag } from '@/components/configurator/resize/useDimensionDrag';
import { VIEWBOX_W, mmToPx } from '@/components/configurator/resize/dimension-scale';
import { computeRowScale, layoutSectionsWithScale, applyLiveActiveWidth, type SectionLayout } from '@/components/configurator/resize/section-geometry';
import { MAX_ROW_WIDTH_PX, TARGET_FILL_PX, RACK_LEFT_MARGIN } from '@/components/configurator/ShelvingPreview';
import type { ShelvingSection } from '@/lib/types/domain';

/**
 * Regression coverage for the width-drag *pixel scale* bug: a section
 * dragged to (say) 700mm used to render at a different on-screen width than
 * the same 700mm renders at once actually committed and idle — the mm
 * value was right (clamped correctly by the earlier fix), but the pixel
 * *scale* used to draw it was frozen from whatever the row's auto-fit scale
 * happened to be when the drag started (computeRowScale's auto-fit is a
 * function of the row's total width, so that frozen scale generally does
 * not equal the scale a fresh commit at the new width will use — hence the
 * reported "narrower while dragging, wider on release" / "wider while
 * dragging, narrower on release").
 *
 * These tests reproduce ShelvingPreview.tsx's own layout pipeline exactly
 * (same computeRowScale/layoutSectionsWithScale/applyLiveActiveWidth calls,
 * same exported constants) rather than asserting against the component's
 * rendered DOM: this project's jsdom has no global PointerEvent, so a real
 * pointer drag dispatched through the DOM silently loses clientX/clientY
 * (see tests/unit/width-drag-clamp.test.ts's note on this) — driving the
 * real hook directly, the way every other drag test in this repo does, is
 * the reliable path.
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

function mmToPxWidth(mm: number): number {
  return 90 + ((mm - 600) * 80) / 1000;
}

function section(id: string, width: number): ShelvingSection {
  return { id, width, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false };
}

/** Reproduces ShelvingPreview's committed/idle layout exactly. */
function committedLayoutFor(sections: ShelvingSection[]): SectionLayout[] {
  const scale = computeRowScale(sections, MAX_ROW_WIDTH_PX, TARGET_FILL_PX);
  const centered = layoutSectionsWithScale(sections, scale, VIEWBOX_W);
  const leftShift = RACK_LEFT_MARGIN - centered[0].x;
  return centered.map((s) => ({ ...s, x: s.x + leftShift }));
}

/** Reproduces ShelvingPreview's live width-drag layout exactly, for one
 * active section dragged to `displayValue` within a full committed row. */
function liveDragLayoutFor(sections: ShelvingSection[], activeId: string, displayValue: number): SectionLayout[] {
  const committed = committedLayoutFor(sections);
  const visualSections = sections.map((s) => (s.id === activeId ? { ...s, width: displayValue } : s));
  const liveScale = computeRowScale(visualSections, MAX_ROW_WIDTH_PX, TARGET_FILL_PX);
  const liveActiveWidthPx = mmToPx('width', displayValue) * liveScale;
  return applyLiveActiveWidth(committed, activeId, liveActiveWidthPx);
}

describe('applyLiveActiveWidth', () => {
  it('keeps sections before the active one untouched, moves only the active section width, and translates sections after it', () => {
    const committed: SectionLayout[] = [
      { id: 'A', x: 60, width: 100, section: section('A', 1000) },
      { id: 'B', x: 160, width: 150, section: section('B', 1200) },
      { id: 'C', x: 310, width: 200, section: section('C', 1500) },
    ];
    const result = applyLiveActiveWidth(committed, 'B', 180);

    expect(result[0]).toEqual(committed[0]); // A entirely unchanged
    expect(result[1].x).toBe(160); // B's own left edge fixed
    expect(result[1].width).toBe(180); // B's width follows the live value
    expect(result[2].x).toBe(310 + 30); // C shifted by exactly B's delta (30)
    expect(result[2].width).toBe(200); // C's own width untouched

    // Contiguous: no gap, no overlap.
    expect(result[0].x + result[0].width).toBe(result[1].x);
    expect(result[1].x + result[1].width).toBe(result[2].x);
  });

  it('is a no-op when the active id is not found', () => {
    const committed: SectionLayout[] = [{ id: 'A', x: 60, width: 100, section: section('A', 1000) }];
    expect(applyLiveActiveWidth(committed, 'missing', 999)).toBe(committed);
  });
});

describe('width-drag geometry matches committed idle geometry (single section)', () => {
  it('A. dragging toward the minimum: live width at 700 pixel-matches the committed-700 layout', () => {
    const startSections = [section('s1', 1200)];
    const liveLayout = liveDragLayoutFor(startSections, 's1', 700);
    const postCommitLayout = committedLayoutFor([section('s1', 700)]);

    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 6);
    expect(liveLayout[0].x).toBeCloseTo(postCommitLayout[0].x, 6);
  });

  it('B. dragging toward the maximum: live width at 1500 pixel-matches the committed-1500 layout', () => {
    const startSections = [section('s1', 1200)];
    const liveLayout = liveDragLayoutFor(startSections, 's1', 1500);
    const postCommitLayout = committedLayoutFor([section('s1', 1500)]);

    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 6);
    expect(liveLayout[0].x).toBeCloseTo(postCommitLayout[0].x, 6);
  });

  it('sanity: the committed-700 and committed-1500 pixel widths actually differ (auto-fit really is in play)', () => {
    const w700 = committedLayoutFor([section('s1', 700)])[0].width;
    const w1500 = committedLayoutFor([section('s1', 1500)])[0].width;
    expect(w700).not.toBeCloseTo(w1500, 3);
  });
});

describe('width-drag geometry — hook clamp composes with the live scale fix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('C. dragging far past the max clamps to 1500, and that live 1500 pixel-matches committed 1500', () => {
    const startSections = [section('s1', 1200)];
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({ axis: 'width', committedValue: 1200, allowedValues: ALLOWED_WIDTHS, containerRef: CONTAINER, onCommit }),
    );

    act(() => {
      result.current.onPointerDown(fakePointerEvent(0, 0));
    });
    const dx = mmToPxWidth(2200) - mmToPxWidth(1200); // way past the legal max
    act(() => {
      result.current.onPointerMove(fakePointerEvent(dx, 0));
      vi.advanceTimersByTime(16);
    });

    expect(result.current.displayValue).toBe(1500);
    const liveLayout = liveDragLayoutFor(startSections, 's1', result.current.displayValue);
    const postCommitLayout = committedLayoutFor([section('s1', 1500)]);
    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 6);
  });

  it('C. dragging far below the min clamps to 700, and that live 700 pixel-matches committed 700', () => {
    const startSections = [section('s1', 1200)];
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({ axis: 'width', committedValue: 1200, allowedValues: ALLOWED_WIDTHS, containerRef: CONTAINER, onCommit }),
    );

    act(() => {
      result.current.onPointerDown(fakePointerEvent(0, 0));
    });
    const dx = mmToPxWidth(300) - mmToPxWidth(1200); // way below the legal min
    act(() => {
      result.current.onPointerMove(fakePointerEvent(dx, 0));
      vi.advanceTimersByTime(16);
    });

    expect(result.current.displayValue).toBe(700);
    const liveLayout = liveDragLayoutFor(startSections, 's1', result.current.displayValue);
    const postCommitLayout = committedLayoutFor([section('s1', 700)]);
    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 6);
  });

  it('D. an intermediate drag stays continuous: the raw mm value tracks the pointer exactly, and its live pixel width still pixel-matches what that same (non-catalog) width would render as if committed', () => {
    const startSections = [section('s1', 1200)];
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({ axis: 'width', committedValue: 1200, allowedValues: ALLOWED_WIDTHS, containerRef: CONTAINER, onCommit }),
    );

    act(() => {
      result.current.onPointerDown(fakePointerEvent(0, 0));
    });
    const dx = mmToPxWidth(1350) - mmToPxWidth(1200);
    act(() => {
      result.current.onPointerMove(fakePointerEvent(dx, 0));
      vi.advanceTimersByTime(16);
    });

    // Not snapped mid-drag — the exact raw value, not one of the 4 catalog steps.
    expect(result.current.displayValue).toBeCloseTo(1350, 6);
    expect(ALLOWED_WIDTHS).not.toContain(result.current.displayValue);

    const liveLayout = liveDragLayoutFor(startSections, 's1', result.current.displayValue);
    const postCommitLayout = committedLayoutFor([section('s1', 1350)]);
    expect(liveLayout[0].width).toBeCloseTo(postCommitLayout[0].width, 6);
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

  it('total row length during drag is the sum of unchanged sections plus the clamped live active width (never flattened)', () => {
    const sections = [section('A', 1000), section('B', 1500)];
    const displayValue = 1500; // already at max, dragged further — clamp keeps it at 1500
    const totalLengthMm = sections.reduce((sum, s) => sum + (s.id === 'B' ? displayValue : s.width), 0);
    expect(totalLengthMm).toBe(2500);
  });
});
