// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDimensionDrag } from '@/components/configurator/resize/useDimensionDrag';
import { useLivePrice } from '@/components/configurator/useLivePrice';
import { useConfiguratorStore, DEFAULT_CONFIGURATION } from '@/store/configurator-store';

/**
 * Verifies the drag-to-resize feature's most important performance/cost
 * property: dragging must never call the pricing API per pointer pixel.
 * The configurator only ever writes to the store once, on commit (release
 * or a keyboard step) — so useLivePrice, which reacts to store changes,
 * should fire at most once per drag, not once per pointermove.
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

const CONTAINER = {
  current: {
    getBoundingClientRect: () =>
      ({ width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  },
} as unknown as RefObject<HTMLElement | null>;

async function settleDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('drag-to-resize does not spam the pricing API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConfiguratorStore.setState({
      config: DEFAULT_CONFIGURATION,
      activeSectionId: DEFAULT_CONFIGURATION.sections[0].id,
      priceResult: null,
      pricingError: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ ok: true, breakdown: { total: 100 }, bom: [], configuration: DEFAULT_CONFIGURATION }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fires once on mount, stays silent through many pointer moves, then fires once more after commit', async () => {
    const activeId = DEFAULT_CONFIGURATION.sections[0].id;
    const { result } = renderHook(() => {
      const config = useConfiguratorStore((s) => s.config);
      useLivePrice(config);
      return useDimensionDrag({
        axis: 'width',
        committedValue: config.sections[0].width,
        allowedValues: [700, 1000, 1200, 1500],
        containerRef: CONTAINER,
        onCommit: (axis, value) => {
          if (axis === 'width') useConfiguratorStore.getState().updateSection(activeId, { width: value });
          else if (axis === 'height') useConfiguratorStore.getState().setAllSectionHeights(value);
          else useConfiguratorStore.getState().setField(axis, value);
        },
      });
    });

    // Initial mount triggers exactly one price calculation for the default config.
    await settleDebounce();
    expect(fetch).toHaveBeenCalledTimes(1);
    (fetch as ReturnType<typeof vi.fn>).mockClear();

    // Simulate a real, "many pixels" drag — the store is untouched throughout.
    act(() => result.current.onPointerDown(fakePointerEvent(0, 0)));
    for (let i = 1; i <= 30; i += 1) {
      act(() => result.current.onPointerMove(fakePointerEvent(i, 0)));
    }
    await settleDebounce();
    expect(fetch).not.toHaveBeenCalled();

    // Commit on release — exactly one price recalculation follows.
    act(() => result.current.onPointerUp(fakePointerEvent(30, 0)));
    expect(useConfiguratorStore.getState().config.sections[0].width).not.toBe(DEFAULT_CONFIGURATION.sections[0].width);

    await settleDebounce();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
