// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDimensionDrag } from '@/components/configurator/resize/useDimensionDrag';

/**
 * Regression coverage for the width-drag overshoot bug: dragging a section
 * past its own catalog max/min used to let the live/continuous value (and
 * therefore the rendered geometry) keep following the pointer past the
 * legal boundary, snapping back to the real max/min only on release — a
 * large visible jump. The fix clamps the live width value itself to
 * [minAllowed(allowedValues), maxAllowed(allowedValues)] while dragging, so
 * geometry never exceeds what release would actually commit.
 *
 * WIDTH_MM_RANGE (600..1600mm -> 90..170px) is the shared, untouched visual
 * scale used to convert pointer pixels to millimetres; these tests compute
 * pointer deltas from that exact mapping so "raw pointer equivalent of
 * 1600mm" means something precise, not an arbitrary pixel count.
 */

function mmToPxWidth(mm: number): number {
  return 90 + ((mm - 600) * 80) / 1000;
}

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

// Matches the preview's 640x480 viewBox 1:1, so viewBox-unit deltas equal
// client-pixel deltas — same convention as tests/unit/useDimensionDrag.test.ts.
const CONTAINER = fakeContainerRef(640, 480);
const ALLOWED_WIDTHS = [700, 1000, 1200, 1500];

describe('useDimensionDrag — width axis is clamped to the catalog range while dragging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function drag(committedValue: number, dx: number) {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue,
        allowedValues: ALLOWED_WIDTHS,
        containerRef: CONTAINER,
        onCommit,
      }),
    );
    act(() => {
      result.current.onPointerDown(fakePointerEvent(0, 0));
    });
    act(() => {
      result.current.onPointerMove(fakePointerEvent(dx, 0));
      vi.advanceTimersByTime(16); // flush the rAF-batched displayValue/snapTarget state
    });
    return { result, onCommit };
  }

  it('A. clamps at the maximum: committed 1500, dragged to a 1600mm-equivalent position, stays at 1500', () => {
    const dx = mmToPxWidth(1600) - mmToPxWidth(1500); // = 8
    const { result } = drag(1500, dx);
    expect(result.current.displayValue).toBe(1500);
    expect(result.current.snapTarget).toBe(1500);
  });

  it('B. clamps at the minimum: committed 1000, dragged to a 650mm-equivalent position, stays at 700', () => {
    const dx = mmToPxWidth(650) - mmToPxWidth(1000); // = -28
    const { result } = drag(1000, dx);
    expect(result.current.displayValue).toBe(700);
    expect(result.current.snapTarget).toBe(700);
  });

  it('C. stays continuous inside the range: committed 1000, dragged to a 1375mm-equivalent position', () => {
    const dx = mmToPxWidth(1375) - mmToPxWidth(1000); // = 30
    const { result } = drag(1000, dx);
    expect(result.current.displayValue).toBeCloseTo(1375, 6);
    expect(result.current.snapTarget).toBe(1500); // nearest of [700,1000,1200,1500] to 1375
  });

  it('D. no-op release at the max: committed 1500, dragged past max, release does not call onCommit', () => {
    const dx = mmToPxWidth(1600) - mmToPxWidth(1500);
    const { result, onCommit } = drag(1500, dx);
    act(() => {
      result.current.onPointerUp(fakePointerEvent(dx, 0));
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('E. a real change still commits exactly once: committed 1200, dragged near 1500, release commits 1500', () => {
    const dx = mmToPxWidth(1450) - mmToPxWidth(1200);
    const { result, onCommit } = drag(1200, dx);
    act(() => {
      result.current.onPointerUp(fakePointerEvent(dx, 0));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('width', 1500);
  });
});

describe('width clamp composes correctly into ShelvingPreview\'s total-row sum (multi-section)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ShelvingPreview.tsx computes the live total row width as
  // `otherSections.width summed + activeSection's widthDrag.displayValue`
  // (see its `visualSections`/`totalLengthMm`) — never a global clamp on the
  // row total. This drives the real hook exactly like ShelvingPreview does
  // (same axis, same allowedValues) and replicates that one-line sum, so a
  // regression that clamped the *row total* instead of just the active
  // section would be caught here without needing a full DOM pointer-drag
  // simulation of the whole component (jsdom in this project has no global
  // PointerEvent, so `clientX`/`clientY` do not survive a dispatched
  // pointermove — see tests/unit/useDimensionDrag.test.ts's own note on
  // this, which is why every drag test in this repo drives the hook
  // directly instead).
  it('F. one other 1000mm section + an active 1500mm section dragged past max sums to 2500, not a flattened 1500', () => {
    const otherSectionWidth = 1000;
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1500,
        allowedValues: ALLOWED_WIDTHS,
        containerRef: CONTAINER,
        onCommit,
      }),
    );

    act(() => {
      result.current.onPointerDown(fakePointerEvent(0, 0));
    });
    const dx = mmToPxWidth(1600) - mmToPxWidth(1500); // drag the already-max active section further out
    act(() => {
      result.current.onPointerMove(fakePointerEvent(dx, 0));
      vi.advanceTimersByTime(16);
    });

    expect(result.current.displayValue).toBe(1500);
    const totalLengthMm = otherSectionWidth + result.current.displayValue;
    expect(totalLengthMm).toBe(2500);
    expect(totalLengthMm).not.toBe(1500);
  });
});
