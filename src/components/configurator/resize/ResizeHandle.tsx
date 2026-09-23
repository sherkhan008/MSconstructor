'use client';

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { DimensionAxis } from './dimension-scale';
import { t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

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
  /** True while the pointer is over this axis's dedicated discovery zone
   * (e.g. the top rack edge for height, a section's right upright for
   * width, the rear upright/depth edge for depth) — never just "somewhere
   * over the white preview canvas". See ShelvingPreview for the zone
   * geometry; this component only renders whatever it's told. */
  zoneHovered: boolean;
  /** Also fed by ShelvingPreview's zone-hover handlers: once the pointer
   * moves off the underlying zone and onto this button itself (a separate,
   * overlapping DOM element, so the zone's own pointerleave would otherwise
   * fire), these keep the marker visible instead of letting it vanish right
   * as the user tries to grab it. */
  onPointerEnter?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerLeave?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * Small glyph shown inside each marker so the resize direction is legible
 * at a glance, not just implied by a plain dot: ↕ for height (vertical),
 * ↔ for width (horizontal), ↗/↙ stacked for depth — matching the rack's
 * actual perspective direction (the depth diagonal runs up-right toward the
 * rear, down-left toward the front; see ShelvingPreview's depthVec).
 */
const AXIS_ICON: Record<DimensionAxis, string> = {
  height: '↕',
  width: '↔',
  depth: '↗↙',
};

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
  zoneHovered,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: ResizeHandleProps) {
  const locale = useLocale();
  return (
    <button
      type="button"
      data-axis={axis}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={t(CF['CF-011'], locale, { V: value })}
      aria-orientation={axis === 'height' ? 'vertical' : 'horizontal'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
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
          // A resize *point*, not a knob: an 18px disc inside the unchanged
          // 44px touch target, small enough to sit on a dimension edge
          // without covering the value next to it.
          'grid h-[18px] w-[18px] place-items-center rounded-full border text-[9px] font-bold leading-none transition-opacity',
          // Hidden until the pointer is over this axis's own discovery zone
          // (see ShelvingPreview) — never gated on the whole white canvas.
          // Keyboard focus on this exact handle (group-focus-visible) and an
          // active drag on this exact axis (isDragging) can still reveal it
          // on their own. Coarse pointers (touch) have no hover concept, so
          // always show there.
          //
          // Graphite throughout, matching the rest of the technical drawing
          // layer: a hairline steel ring at rest, and a solid graphite disc
          // while this axis is actually being dragged — inverted rather than
          // recoloured, so the canvas keeps one neutral palette.
          isDragging
            ? 'border-foreground bg-foreground text-surface opacity-100'
            : zoneHovered
              ? 'border-foreground bg-surface text-foreground opacity-100'
              : 'border-line-strong bg-surface text-steel opacity-0 group-focus-visible:border-foreground group-focus-visible:text-foreground group-focus-visible:opacity-100 pointer-coarse:opacity-100',
        ].join(' ')}
      >
        {AXIS_ICON[axis]}
      </span>
    </button>
  );
}
