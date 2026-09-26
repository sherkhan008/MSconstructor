// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDimensionDrag } from '@/components/configurator/resize/useDimensionDrag';
import { useConfiguratorStore, DEFAULT_CONFIGURATION } from '@/store/configurator-store';

/**
 * These exercise the hook directly rather than through simulated DOM pointer
 * events: jsdom's PointerEvent support is unreliable across versions, and
 * the hook only ever reads clientX/clientY/pointerId and calls
 * setPointerCapture/releasePointerCapture/preventDefault — a minimal fake
 * event covers exactly what the implementation touches.
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

// The fake container matches the preview's viewBox 1:1 (640x480), so
// viewBox-unit deltas equal client-pixel deltas in these tests.
const CONTAINER = fakeContainerRef(640, 480);

/** viewBox units per millimetre handed to the hook — the preview's physical
 * scale. These are the old curve's slopes (80px per 1000mm of width, 180px per
 * 2500mm of height, 55px per 500mm of depth), so the pointer deltas below
 * keep meaning the same millimetres. */
const PX_PER_MM = { width: 0.08, height: 0.072, depth: 0.11 } as const;

describe('useDimensionDrag — width axis', () => {
  it('commits the nearest allowed width once, on pointer release', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    // Several intermediate moves toward 1200 — none of these should commit anything.
    act(() => result.current.onPointerMove(fakePointerEvent(5, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(12, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(20, 0)));
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.isDragging).toBe(true);

    act(() => result.current.onPointerUp(fakePointerEvent(20, 0)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('width', 1200);
    expect(result.current.isDragging).toBe(false);
  });

  it('never produces a value outside the model-specific allowed set', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200], // this model does not offer 1500
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(400, 0))); // a huge drag to the right
    act(() => result.current.onPointerUp(fakePointerEvent(400, 0)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('width', 1200);
  });
});

describe('useDimensionDrag — height axis', () => {
  it('increases height when dragged upward and commits the snapped value', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'height',
        committedValue: 2000,
        allowedValues: [1600, 1850, 2000, 2200, 2400, 3000],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.height,
        onCommit,
      }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(0, -18))); // dragging up
    act(() => result.current.onPointerUp(fakePointerEvent(0, -18)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('height', 2200);
  });

  it('decreases height when dragged downward', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'height',
        committedValue: 2000,
        allowedValues: [1600, 1850, 2000, 2200, 2400, 3000],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.height,
        onCommit,
      }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(0, 13.5))); // dragging down
    act(() => result.current.onPointerUp(fakePointerEvent(0, 13.5)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('height', 1850);
  });
});

describe('useDimensionDrag — depth axis', () => {
  it('converts diagonal pointer movement into a snapped depth value', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'depth',
        committedValue: 400,
        allowedValues: [300, 400, 500, 600],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.depth,
        onCommit,
      }),
    );

    const angleRad = (40 * Math.PI) / 180;
    const t = 13.75; // solved so the projected delta lands exactly on 500mm
    const dx = t * Math.cos(angleRad);
    const dy = -t * Math.sin(angleRad);

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(dx, dy)));
    act(() => result.current.onPointerUp(fakePointerEvent(dx, dy)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('depth', 500);
  });

  it('moving perpendicular to the depth diagonal leaves the value unchanged and skips the commit', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'depth',
        committedValue: 400,
        allowedValues: [300, 400, 500, 600],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.depth,
        onCommit,
      }),
    );

    // Perpendicular to the ~40° depth diagonal — projects to ~0 delta.
    const angleRad = (40 * Math.PI) / 180;
    const perpX = -Math.sin(angleRad) * 50;
    const perpY = -Math.cos(angleRad) * 50;

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(perpX, perpY)));
    act(() => result.current.onPointerUp(fakePointerEvent(perpX, perpY)));

    // The projected delta is ~0, so the snapped value is still 400 — and since
    // nothing actually changed, no commit (and no pricing recalculation) fires.
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('useDimensionDrag — pointercancel and unmount', () => {
  it('treats pointercancel the same as pointerup', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(20, 0)));
    act(() => result.current.onPointerCancel(fakePointerEvent(20, 0)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(result.current.isDragging).toBe(false);
  });

  it('does not throw or leave a stuck drag state when unmounted mid-drag', () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(20, 0)));
    expect(() => unmount()).not.toThrow();
  });
});

describe('useDimensionDrag — keyboard stepping', () => {
  it('ArrowRight/ArrowUp move to the next allowed value', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} } as never));
    expect(onCommit).toHaveBeenCalledWith('width', 1200);
  });

  it('ArrowDown/ArrowLeft move to the previous allowed value', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1200,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onKeyDown({ key: 'ArrowLeft', preventDefault: () => {} } as never));
    expect(onCommit).toHaveBeenCalledWith('width', 1000);
  });

  it('Home selects the minimum and End selects the maximum', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'height',
        committedValue: 2200,
        allowedValues: [1600, 1850, 2000, 2200, 2400, 3000],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.height,
        onCommit,
      }),
    );

    act(() => result.current.onKeyDown({ key: 'Home', preventDefault: () => {} } as never));
    expect(onCommit).toHaveBeenLastCalledWith('height', 1600);

    act(() => result.current.onKeyDown({ key: 'End', preventDefault: () => {} } as never));
    expect(onCommit).toHaveBeenLastCalledWith('height', 3000);
  });

  it('ignores unrelated keys', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit,
      }),
    );

    act(() => result.current.onKeyDown({ key: 'Tab', preventDefault: () => {} } as never));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('useDimensionDrag — configurator store synchronization', () => {
  beforeEach(() => {
    useConfiguratorStore.setState({
      config: DEFAULT_CONFIGURATION,
      activeSectionId: DEFAULT_CONFIGURATION.sections[0].id,
      priceResult: null,
      pricingError: null,
    });
  });

  it('a committed width drag value is written straight through to the active section in the zustand store', () => {
    const activeId = DEFAULT_CONFIGURATION.sections[0].id;
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: useConfiguratorStore.getState().config.sections[0].width,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        pxPerMm: PX_PER_MM.width,
        onCommit: (axis, value) => {
          if (axis === 'width') useConfiguratorStore.getState().updateSection(activeId, { width: value });
          else if (axis === 'height') useConfiguratorStore.getState().updateSection(activeId, { height: value });
          else useConfiguratorStore.getState().setField(axis, value);
        },
      }),
    );

    expect(useConfiguratorStore.getState().config.sections[0].width).toBe(1000);

    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    act(() => result.current.onPointerMove(fakePointerEvent(20, 0)));
    act(() => result.current.onPointerUp(fakePointerEvent(20, 0)));

    expect(useConfiguratorStore.getState().config.sections[0].width).toBe(1200);
    // Every other field must be preserved untouched.
    expect(useConfiguratorStore.getState().config.sections[0].height).toBe(DEFAULT_CONFIGURATION.sections[0].height);
    expect(useConfiguratorStore.getState().config.sections[0].shelves).toBe(DEFAULT_CONFIGURATION.sections[0].shelves);
    expect(useConfiguratorStore.getState().config.depth).toBe(DEFAULT_CONFIGURATION.depth);
    expect(useConfiguratorStore.getState().config.sections.length).toBe(1);
  });
});

describe('useDimensionDrag — physical scale, frozen for the whole gesture (V2.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One pointer move, then the rAF flush that publishes displayValue. */
  function move(result: { current: { onPointerMove: (e: ReactPointerEvent<Element>) => void } }, x: number, y: number) {
    act(() => {
      result.current.onPointerMove(fakePointerEvent(x, y));
      vi.advanceTimersByTime(16);
    });
  }
  /** A container whose on-screen size can be changed mid-drag. */
  function resizableContainer(initial: { width: number; height: number }) {
    const size = { ...initial };
    const ref = {
      current: {
        getBoundingClientRect: () =>
          ({ ...size, top: 0, left: 0, right: size.width, bottom: size.height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
      },
    } as unknown as RefObject<HTMLElement | null>;
    return { ref, size };
  }

  it('maps pointer movement linearly through pxPerMm: Δmm = Δpx / pxPerMm, at any starting value', () => {
    for (const committedValue of [700, 1000, 1200]) {
      const { result } = renderHook(() =>
        useDimensionDrag({
          axis: 'width',
          committedValue,
          allowedValues: [700, 1000, 1200, 1500],
          containerRef: CONTAINER,
          pxPerMm: 0.064,
          onCommit: vi.fn(),
        }),
      );
      act(() => result.current.onPointerDown(fakePointerEvent(100, 100)));
      // 6.4 viewBox units at 0.064 px/mm is exactly 100 mm.
      move(result, 106.4, 100);
      move(result, 106.4, 100);
      expect(result.current.displayValue).toBeCloseTo(committedValue + 100, 6);
      act(() => result.current.onPointerUp(fakePointerEvent(106.4, 100)));
    }
  });

  it('a pxPerMm change mid-gesture does not change the pointer-to-mm mapping of that gesture', () => {
    let pxPerMm = 0.064;
    const { result, rerender } = renderHook(() =>
      useDimensionDrag({
        axis: 'height',
        committedValue: 2000,
        allowedValues: [1000, 1500, 2000, 2500, 3000],
        containerRef: CONTAINER,
        pxPerMm,
        onCommit: vi.fn(),
      }),
    );
    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    move(result, 0, -12.8); // 200 mm up
    expect(result.current.displayValue).toBeCloseTo(2200, 6);

    // Something re-renders the preview at a different scale mid-drag.
    pxPerMm = 0.032;
    rerender();
    move(result, 0, -12.8);
    expect(result.current.displayValue).toBeCloseTo(2200, 6);
    move(result, 0, -25.6); // 400 mm at the frozen scale
    expect(result.current.displayValue).toBeCloseTo(2400, 6);
    act(() => result.current.onPointerUp(fakePointerEvent(0, -25.6)));

    // The next gesture picks the new scale up.
    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    move(result, 0, -12.8); // 400 mm at 0.032
    expect(result.current.displayValue).toBeCloseTo(2400, 6);
  });

  it('a container that re-lays out mid-gesture does not change the pointer-to-mm mapping of that gesture', () => {
    const { ref, size } = resizableContainer({ width: 640, height: 480 });
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'width',
        committedValue: 1000,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: ref,
        pxPerMm: 0.064,
        onCommit: vi.fn(),
      }),
    );
    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    move(result, 12.8, 0); // 200 mm
    expect(result.current.displayValue).toBeCloseTo(1200, 6);

    size.width = 320; // the stage halves on screen mid-drag
    size.height = 240;
    move(result, 12.8, 0);
    expect(result.current.displayValue).toBeCloseTo(1200, 6);
  });

  it('clamps height to the allowed range while dragging, so the rack never outgrows its reserved frame', () => {
    const { result } = renderHook(() =>
      useDimensionDrag({
        axis: 'height',
        committedValue: 2000,
        allowedValues: [1000, 1500, 2000, 2500, 3000],
        containerRef: CONTAINER,
        pxPerMm: 0.064,
        onCommit: vi.fn(),
      }),
    );
    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    move(result, 0, -500);
    expect(result.current.displayValue).toBe(3000);
    move(result, 0, 500);
    expect(result.current.displayValue).toBe(1000);
    // Back inside the range the value tracks the pointer again, unsnapped.
    move(result, 0, -6.4);
    expect(result.current.displayValue).toBeCloseTo(2100, 6);
  });
});
