'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname } from 'next/navigation';
import { trackEvent } from '@/lib/analytics';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { t } from '@/lib/i18n/format';
import { splitLocalePath } from '@/lib/i18n/locales';
import { H } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Persistent WhatsApp CTA. Hidden on small screens while the configurator's
 * own sticky price bar occupies the same corner of the viewport.
 *
 * A fixed button in the bottom-right corner will otherwise sit on top of
 * whatever scrolls under it — at ~375px that is exactly where a product
 * card's "В корзину" button lands. Rather than nudging the offsets per page
 * (which only moves the collision), the button asks the page: anything
 * marked `data-fab-avoid` that is currently underneath makes it fade out and
 * stop taking pointer events until it scrolls clear. Marking a container is
 * how a page declares "this is an action, never cover it" — see
 * ProductCard, CartClient and OrderForm.
 */
const AVOID_SELECTOR = '[data-fab-avoid]';

function useCoversAnAction(ref: React.RefObject<HTMLElement | null>, pathname: string | null) {
  const [covers, setCovers] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;
    const check = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      setCovers(
        rect.width > 0 && Array.from(document.querySelectorAll(AVOID_SELECTOR)).some((node) => {
          const action = node.getBoundingClientRect();
          return action.width > 0 && action.height > 0 &&
            action.left < rect.right && action.right > rect.left &&
            action.top < rect.bottom && action.bottom > rect.top;
        }),
      );
    };

    const schedule = () => {
      // Commit before this frame paints: a deferred React update could leave
      // the link clickable for one frame after an action scrolls underneath.
      if (!frame) frame = requestAnimationFrame(() => flushSync(check));
    };

    // Layout changes (loaded content, cart updates, expanded summaries) can
    // move actions without scrolling. Observe those events, never poll idle.
    const resize = new ResizeObserver(schedule);
    const observeActions = () => {
      resize.disconnect();
      resize.observe(document.body);
      document.querySelectorAll(AVOID_SELECTOR).forEach(node => resize.observe(node));
    };
    const mutations = new MutationObserver(records => {
      if (records.every(record => record.target === element || element.contains(record.target))) return;
      observeActions();
      schedule();
    });
    observeActions();
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    check();
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, pathname]);

  return covers;
}

export function WhatsAppFloatingButton() {
  const pathname = usePathname();
  const locale = useLocale();
  const hideOnMobile = splitLocalePath(pathname ?? '/').path === '/configurator';
  const ref = useRef<HTMLAnchorElement>(null);
  const coversAnAction = useCoversAnAction(ref, pathname);

  return (
    <a
      ref={ref}
      href={whatsAppContactUrl(locale)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent('whatsapp_clicked', { location: 'floating_button' })}
      aria-label={t(H['H-006'], locale)}
      aria-hidden={coversAnAction}
      tabIndex={coversAnAction ? -1 : undefined}
      // Clears the iOS home indicator / Android gesture bar; the horizontal
      // offset stays on the existing utility classes, so desktop is unchanged.
      style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      className={`no-print fixed right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-success text-white shadow-lg transition-[opacity,transform] duration-150 hover:scale-105 sm:right-6 ${
        coversAnAction ? 'pointer-events-none opacity-0' : 'opacity-100'
      } ${hideOnMobile ? 'hidden sm:grid' : 'grid'}`}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.31 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.04 3.67C14.25 3.67 16.32 4.53 17.88 6.09C19.44 7.65 20.29 9.72 20.29 11.92C20.29 16.46 16.58 20.16 12.03 20.16C10.56 20.16 9.12 19.77 7.85 19.03L7.55 18.86L4.43 19.68L5.27 16.65L5.08 16.33C4.27 15.01 3.83 13.48 3.83 11.91C3.84 7.37 7.5 3.67 12.04 3.67ZM8.53 6.65C8.37 6.65 8.1 6.71 7.87 6.96C7.65 7.21 7 7.81 7 9.02C7 10.23 7.89 11.4 8.01 11.56C8.14 11.72 9.73 14.2 12.2 15.27C14.25 16.15 14.67 15.99 15.12 15.95C15.57 15.91 16.56 15.35 16.76 14.77C16.96 14.19 16.96 13.69 16.9 13.59C16.83 13.48 16.67 13.42 16.42 13.29C16.17 13.16 14.94 12.56 14.71 12.47C14.48 12.39 14.32 12.35 14.16 12.6C14 12.85 13.53 13.42 13.39 13.58C13.25 13.74 13.1 13.76 12.85 13.63C12.6 13.5 11.8 13.24 10.86 12.4C10.12 11.75 9.63 10.94 9.49 10.69C9.35 10.44 9.47 10.31 9.6 10.18C9.71 10.06 9.86 9.87 9.99 9.72C10.11 9.57 10.16 9.47 10.24 9.31C10.32 9.15 10.28 9.01 10.22 8.88C10.16 8.75 9.68 7.51 9.47 7.02C9.27 6.55 9.06 6.58 8.9 6.57C8.75 6.56 8.59 6.55 8.53 6.65Z" />
      </svg>
    </a>
  );
}
