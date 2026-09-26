'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  DEPTH_ANGLE_DEG,
  VIEWBOX_H,
  VIEWBOX_W,
  clamp,
  findNearestAllowed,
  maxAllowed,
  minAllowed,
  stepAllowed,
  type DimensionAxis,
} from './dimension-scale';
import { t, type Entry } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Pointer- and keyboard-driven dimension resizing for one axis of the
 * ShelvingPreview. Two values matter here, deliberately kept separate:
 *
 *  - a continuous "temp" value that drives the live preview while the
 *    pointer is down (never snapped, so the resize feels smooth), and
 *  - the committed catalog value, only written to the configurator store
 *    once — on pointer release or a discrete keyboard step.
 *
 * No pricing or compatibility logic lives here: `onCommit` is the only way
 * this hook talks to the outside world, and the caller decides what that
 * commit means (ConfiguratorClient wires it straight to the same
 * `setField` the dimension buttons already use).
 */

export interface UseDimensionDragOptions {
  axis: DimensionAxis;
  /** Current store value in millimetres. For `width` this is the active section's own width. */
  committedValue: number;
  /** Compatible values for the selected model — from ProductModel, not invented here. */
  allowedValues: number[];
  /** The element whose rendered box corresponds 1:1 to the preview's viewBox. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The preview's uniform physical scale — viewBox units per millimetre
   * (for depth: along its receding diagonal). Pointer movement is converted
   * with exactly the scale the rack is drawn at, so the dragged edge stays
   * under the pointer. Captured at pointer-down for the whole gesture. */
  pxPerMm: number;
  onCommit: (axis: DimensionAxis, value: number) => void;
  /** Called once per commit (drag release or keyboard step) with a human-readable message. */
  onAnnounce?: (message: string) => void;
}

export interface UseDimensionDragResult {
  isDragging: boolean;
  /** committedValue while idle, the live continuous value while dragging. */
  displayValue: number;
  /** Nearest catalog value to displayValue while dragging; null while idle. */
  snapTarget: number | null;
  min: number | undefined;
  max: number | undefined;
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: (e: ReactPointerEvent<Element>) => void;
  onKeyDown: (e: ReactKeyboardEvent<Element>) => void;
}

/** Screen-reader announcement after a committed resize, per axis (CF-012…CF-014). */
const RESIZED_ANNOUNCEMENT: Record<DimensionAxis, Entry> = {
  height: CF['CF-012'],
  width: CF['CF-013'],
  depth: CF['CF-014'],
};

interface GestureScale {
  unitsPerClientX: number;
  unitsPerClientY: number;
  pxPerMm: number;
}

/** Pointer movement along the axis, in viewBox units. */
function projectDelta(axis: DimensionAxis, dxViewBox: number, dyViewBox: number): number {
  if (axis === 'height') {
    // SVG y grows downward; dragging up (negative dy) must increase height.
    return -dyViewBox;
  }
  if (axis === 'width') {
    // The handle sits at the active section's own right edge — 1:1 with pointer movement.
    return dxViewBox;
  }
  const angleRad = (DEPTH_ANGLE_DEG * Math.PI) / 180;
  const dirX = Math.cos(angleRad);
  const dirY = -Math.sin(angleRad);
  return dxViewBox * dirX + dyViewBox * dirY;
}

export function useDimensionDrag({
  axis,
  committedValue,
  allowedValues,
  containerRef,
  pxPerMm,
  onCommit,
  onAnnounce,
}: UseDimensionDragOptions): UseDimensionDragResult {
  const locale = useLocale();
  const [isDragging, setIsDragging] = useState(false);
  const [tempValue, setTempValue] = useState(committedValue);
  const [snapTarget, setSnapTarget] = useState<number | null>(null);

  const draggingRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });
  const startValueRef = useRef(committedValue);
  const latestRef = useRef<{ tempValue: number; snapTarget: number }>({
    tempValue: committedValue,
    snapTarget: committedValue,
  });
  const rafRef = useRef<number | null>(null);

  const allowedRef = useRef(allowedValues);
  allowedRef.current = allowedValues;
  const committedRef = useRef(committedValue);
  committedRef.current = committedValue;
  const pxPerMmRef = useRef(pxPerMm);
  pxPerMmRef.current = pxPerMm;

  // The whole client-px → viewBox → mm conversion of one gesture, frozen at
  // pointer-down: the container's size (so a stage that re-lays out mid-drag
  // cannot rescale the pointer) and the drawing's pxPerMm (so a scale that
  // changed mid-drag could not either). Released with the pointer.
  const gestureRef = useRef<GestureScale | null>(null);
  const captureGestureScale = useCallback((): GestureScale | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    const scale = pxPerMmRef.current;
    if (!rect || rect.width === 0 || rect.height === 0 || !(scale > 0)) return null;
    return { unitsPerClientX: VIEWBOX_W / rect.width, unitsPerClientY: VIEWBOX_H / rect.height, pxPerMm: scale };
  }, [containerRef]);

  // Cancel any in-flight animation frame on unmount so a late callback never
  // calls setState after this component is gone.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      draggingRef.current = false;
    },
    [],
  );

  const flush = useCallback(() => {
    rafRef.current = null;
    setTempValue(latestRef.current.tempValue);
    setSnapTarget(latestRef.current.snapTarget);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      startClientRef.current = { x: e.clientX, y: e.clientY };
      gestureRef.current = captureGestureScale();
      startValueRef.current = committedRef.current;
      latestRef.current = {
        tempValue: committedRef.current,
        snapTarget: findNearestAllowed(committedRef.current, allowedRef.current),
      };
      setIsDragging(true);
      setTempValue(committedRef.current);
      setSnapTarget(latestRef.current.snapTarget);
    },
    [captureGestureScale],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      // Normally captured at pointer-down; only a container that had no size
      // yet at that moment is measured here instead — and then kept.
      gestureRef.current ??= captureGestureScale();
      const gesture = gestureRef.current;
      if (!gesture) return;

      const dxViewBox = (e.clientX - startClientRef.current.x) * gesture.unitsPerClientX;
      const dyViewBox = (e.clientY - startClientRef.current.y) * gesture.unitsPerClientY;
      const rawMm = startValueRef.current + projectDelta(axis, dxViewBox, dyViewBox) / gesture.pxPerMm;

      // Every axis is a catalog value with a hard min/max — once the pointer
      // drags past the allowed max/min, the rack must stop growing/shrinking
      // right there instead of following the pointer past the legal boundary
      // (and outside the frame reserved for the largest catalog rack) and
      // snapping back on release. The pointer itself keeps moving
      // (startClientRef/startValueRef never rebase), so re-entering the legal
      // range resumes smooth tracking with no extra drag needed.
      let newMm = rawMm;
      const min = minAllowed(allowedRef.current);
      const max = maxAllowed(allowedRef.current);
      if (min !== undefined && max !== undefined) {
        newMm = clamp(rawMm, min, max);
      }

      latestRef.current = { tempValue: newMm, snapTarget: findNearestAllowed(newMm, allowedRef.current) };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [axis, captureGestureScale, flush],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      gestureRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may already be released by the browser — safe to ignore.
      }

      const finalValue = latestRef.current.snapTarget;
      setIsDragging(false);
      setSnapTarget(null);
      if (finalValue !== committedRef.current) {
        onCommit(axis, finalValue);
        onAnnounce?.(t(RESIZED_ANNOUNCEMENT[axis], locale, { V: finalValue }));
      }
    },
    [axis, locale, onAnnounce, onCommit],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<Element>) => {
      const allowed = allowedRef.current;
      let next: number | undefined;

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        next = stepAllowed(committedRef.current, allowed, 1);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        next = stepAllowed(committedRef.current, allowed, -1);
      } else if (e.key === 'Home') {
        next = minAllowed(allowed);
      } else if (e.key === 'End') {
        next = maxAllowed(allowed);
      } else {
        return;
      }

      e.preventDefault();
      if (next !== undefined && next !== committedRef.current) {
        onCommit(axis, next);
        onAnnounce?.(t(RESIZED_ANNOUNCEMENT[axis], locale, { V: next }));
      }
    },
    [axis, locale, onAnnounce, onCommit],
  );

  return {
    isDragging,
    displayValue: isDragging ? tempValue : committedValue,
    snapTarget: isDragging ? snapTarget : null,
    min: minAllowed(allowedValues),
    max: maxAllowed(allowedValues),
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown,
  };
}
