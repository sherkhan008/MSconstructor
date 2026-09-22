'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV_LINKS, linkLabel, site, siteCopy } from '@/lib/config/site';
import { trackEvent } from '@/lib/analytics';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { H } from '@/lib/i18n/strings';
import { LinkButton } from '@/components/ui/Button';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { CartBadge } from './CartBadge';
import { LanguageSwitcher } from './LanguageSwitcher';

const MOBILE_MENU_ID = 'mobile-navigation';

/** Square 44px icon control — the header's touch-target size. */
const ICON_BUTTON = 'relative grid h-11 w-11 shrink-0 place-items-center border transition-colors';

export function Header() {
  const pathname = usePathname();
  const locale = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const href = (path: string) => localizePath(path, locale);
  // A section is current on its own page and on the pages below it
  // (/catalog/ms-standard keeps "Каталог" marked).
  const isCurrent = (path: string) => pathname === href(path) || (pathname?.startsWith(`${href(path)}/`) ?? false);

  // While the mobile menu is open: Escape closes it (focus returns to the
  // toggle), and the page behind it does not scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link href={href('/')} className="flex min-w-0 shrink-0 items-center gap-2.5" onClick={closeMenu}>
          <span className="grid h-10 w-10 shrink-0 place-items-center border-b-[3px] border-accent bg-foreground text-background">
            <span className="font-display text-lg leading-none">MS</span>
          </span>
          <span className="hidden font-display text-base leading-none tracking-wide min-[370px]:inline sm:text-lg lg:max-xl:hidden xl:text-xl">
            {siteCopy(locale).name}
          </span>
        </Link>

        <nav className="hidden h-full items-stretch gap-1 lg:flex" aria-label={t(H['H-001'], locale)}>
          {NAV_LINKS.map((link) => {
            const current = isCurrent(link.href);
            return (
              <Link
                key={link.href}
                href={href(link.href)}
                aria-current={current ? 'page' : undefined}
                className={`relative flex items-center whitespace-nowrap px-3 text-[0.9375rem] font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:content-[''] ${
                  current ? 'text-foreground after:bg-accent' : 'text-steel after:bg-transparent hover:text-foreground'
                }`}
              >
                {linkLabel(link, locale)}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher />

          <a
            href={whatsAppContactUrl(locale)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent('whatsapp_clicked', { location: 'header' })}
            aria-label={t(H['H-006'], locale)}
            className={`${ICON_BUTTON} !hidden border-line text-success hover:border-success xl:!grid`}
          >
            <WhatsAppIcon />
          </a>

          <Link
            href={href('/cart')}
            aria-label={t(H['H-007'], locale)}
            aria-current={isCurrent('/cart') ? 'page' : undefined}
            className={`${ICON_BUTTON} border-line text-foreground hover:border-foreground`}
          >
            <CartIcon />
            <CartBadge />
          </Link>

          <LinkButton href={href('/configurator')} variant="accent" className="!hidden min-h-11 md:!inline-flex">
            {t(H['H-008'], locale)}
          </LinkButton>

          <button
            ref={toggleRef}
            type="button"
            aria-label={menuOpen ? t(H['H-010'], locale) : t(H['H-009'], locale)}
            aria-expanded={menuOpen}
            aria-controls={MOBILE_MENU_ID}
            onClick={() => setMenuOpen((open) => !open)}
            className={`${ICON_BUTTON} lg:hidden ${
              menuOpen ? 'border-foreground bg-foreground text-background' : 'border-line text-foreground hover:border-foreground'
            }`}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {menuOpen && (
        // Dims the page under the open menu; tapping it closes the menu.
        <div aria-hidden="true" className="absolute inset-x-0 top-full h-[100dvh] bg-foreground/40 lg:hidden" onClick={closeMenu} />
      )}
      {menuOpen && (
        <nav
          id={MOBILE_MENU_ID}
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--header-height))] overflow-y-auto border-b border-line bg-surface shadow-lg lg:hidden"
          aria-label={t(H['H-011'], locale)}
        >
          <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pb-6 pt-2 sm:px-6">
            <ul className="flex flex-col">
              {NAV_LINKS.map((link) => {
                const current = isCurrent(link.href);
                return (
                  <li key={link.href} className="border-b border-line">
                    <Link
                      href={href(link.href)}
                      onClick={closeMenu}
                      aria-current={current ? 'page' : undefined}
                      className={`flex min-h-14 items-center justify-between gap-4 border-l-[3px] pl-3 pr-1 text-base font-medium ${
                        current ? 'border-accent text-foreground' : 'border-transparent text-foreground'
                      }`}
                    >
                      {linkLabel(link, locale)}
                      <ChevronIcon />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <a
              href={whatsAppContactUrl(locale)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('whatsapp_clicked', { location: 'header' })}
              className="mt-2 flex min-h-12 items-center gap-3 pl-3 text-base text-success"
            >
              <WhatsAppIcon />
              <span className="mono">WhatsApp {site.whatsappDisplay}</span>
            </a>
            <LinkButton
              href={href('/configurator')}
              variant="accent"
              size="lg"
              className="mt-3 w-full whitespace-normal text-center"
              onClick={closeMenu}
            >
              {t(H['H-012'], locale)}
            </LinkButton>
          </div>
        </nav>
      )}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 4.5H16M2 9H16M2 13.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-steel-soft">
      <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2 2H3.6L4.5 12.5C4.6 13.4 5.35 14 6.25 14H14C14.85 14 15.6 13.4 15.75 12.55L16.75 6.5H4.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
      />
      <circle cx="7" cy="16.5" r="1" fill="currentColor" />
      <circle cx="13.5" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.31 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.04 3.67C14.25 3.67 16.32 4.53 17.88 6.09C19.44 7.65 20.29 9.72 20.29 11.92C20.29 16.46 16.58 20.16 12.03 20.16C10.56 20.16 9.12 19.77 7.85 19.03L7.55 18.86L4.43 19.68L5.27 16.65L5.08 16.33C4.27 15.01 3.83 13.48 3.83 11.91C3.84 7.37 7.5 3.67 12.04 3.67ZM8.53 6.65C8.37 6.65 8.1 6.71 7.87 6.96C7.65 7.21 7 7.81 7 9.02C7 10.23 7.89 11.4 8.01 11.56C8.14 11.72 9.73 14.2 12.2 15.27C14.25 16.15 14.67 15.99 15.12 15.95C15.57 15.91 16.56 15.35 16.76 14.77C16.96 14.19 16.96 13.69 16.9 13.59C16.83 13.48 16.67 13.42 16.42 13.29C16.17 13.16 14.94 12.56 14.71 12.47C14.48 12.39 14.32 12.35 14.16 12.6C14 12.85 13.53 13.42 13.39 13.58C13.25 13.74 13.1 13.76 12.85 13.63C12.6 13.5 11.8 13.24 10.86 12.4C10.12 11.75 9.63 10.94 9.49 10.69C9.35 10.44 9.47 10.31 9.6 10.18C9.71 10.06 9.86 9.87 9.99 9.72C10.11 9.57 10.16 9.47 10.24 9.31C10.32 9.15 10.28 9.01 10.22 8.88C10.16 8.75 9.68 7.51 9.47 7.02C9.27 6.55 9.06 6.58 8.9 6.57C8.75 6.56 8.59 6.55 8.53 6.65Z" />
    </svg>
  );
}
