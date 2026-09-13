'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Small modal shell shared by the price edit dialog and the history panel.
 *
 * Deliberately minimal (no dependency added for this): a labelled
 * `role="dialog"`, Escape to close, backdrop click to close, focus moved into
 * the panel on open and returned to the trigger on close, and background
 * scrolling locked. On a phone it sits at the bottom of the screen and can
 * never grow past the viewport — the actions stay reachable.
 */
export function AdminModal({
  title,
  subtitle,
  onClose,
  children,
  labelId,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  labelId: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Prefer the first real control so a keyboard user starts where they act.
    const focusable = panel?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full flex-col border border-line bg-background shadow-lg outline-none sm:max-w-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={labelId} className="font-display text-lg">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-sm text-steel">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-steel hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}
