'use client';

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { DimensionAxis } from './dimension-scale';

export interface ResizeHandleProps {
  axis: DimensionAxis;
  ariaLabel: string;
  /** Value announced via aria-valuenow — the committed value, not the drag preview. */
  value: number;
  min: number | undefined;
  max: number | undefined;
  /** Position of the handle centre, in percent of the preview container. */
  xPercent: number;
  yPercent: number;
  cursorClassName: string;
  isDragging: boolean;
  /** Whole-preview hover state (not hover of this 44px hit area itself) —
   * the marker only needs to be findable once the pointer is already
   * somewhere over the rack, never before. */
  previewHovered: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * The draggable knob for one axis of ShelvingPreview's resize interaction.
 * A real <button> rather than an SVG element: it gets native focus/keyboard
 * semantics for free, and — because it is sized in real CSS pixels — it can
 * guarantee the ~44px touch target that a viewBox-scaled SVG shape cannot.
 * It is positioned with plain percentages because ShelvingPreview's viewBox
 * is fixed at the same 4:3 ratio as the container it renders into.
 */
export function ResizeHandle({
  axis,
  ariaLabel,
  value,
  min,
  max,
  xPercent,
  yPercent,
  cursorClassName,
  isDragging,
  previewHovered,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: ResizeHandleProps) {
  return (
    <button
      type="button"
      data-axis={axis}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} мм`}
      aria-orientation={axis === 'height' ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
      className={[
        'group absolute z-10 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none select-none place-items-center rounded-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-blueprint focus-visible:ring-offset-2',
        cursorClassName,
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'h-2.5 w-2.5 rounded-full border bg-surface transition-opacity',
          // Hidden until the *whole preview* is hovered — never gated on
          // finding this 44px hit area first. Keyboard focus on this exact
          // handle (group-focus-visible) and an active drag on this exact
          // axis (isDragging) can still reveal it on their own. Coarse
          // pointers (touch) have no hover concept, so always show there.
          isDragging
            ? 'border-dimension-accent bg-dimension-accent-soft opacity-100'
            : previewHovered
              ? 'border-steel-soft opacity-100'
              : 'border-steel-soft opacity-0 group-focus-visible:opacity-100 pointer-coarse:opacity-100',
        ].join(' ')}
      />
    </button>
  );
}
