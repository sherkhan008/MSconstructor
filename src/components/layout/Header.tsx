'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV_LINKS, site } from '@/lib/config/site';
import { trackEvent } from '@/lib/analytics';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { LinkButton } from '@/components/ui/Button';
import { CartBadge } from './CartBadge';

export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 hairline border-t-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2" onClick={() => setMenuOpen(false)}>
          <span className="grid h-9 w-9 place-items-center border border-foreground bg-foreground text-background">
            <span className="font-display text-lg leading-none">MS</span>
          </span>
          <span className="hidden font-display text-xl leading-none tracking-wide sm:inline">{site.name}</span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Основная навигация">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-blueprint ${
                pathname === link.href ? 'text-blueprint' : 'text-foreground'
              }`}
            >
              {link.labelRu}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={whatsAppContactUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent('whatsapp_clicked', { location: 'header' })}
            aria-label="Написать в WhatsApp"
            className="grid h-9 w-9 place-items-center border border-success text-success transition-colors hover:bg-success hover:text-white"
          >
            <WhatsAppIcon />
          </a>

          <Link
            href="/cart"
            aria-label="Корзина"
            className="relative grid h-9 w-9 place-items-center border border-line text-foreground transition-colors hover:border-foreground"
          >
            <CartIcon />
            <CartBadge />
          </Link>

          <LinkButton href="/configurator" size="sm" className="!hidden sm:!inline-flex">
            Конфигурировать
          </LinkButton>

          <button
            type="button"
            aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-9 w-9 place-items-center border border-line text-foreground lg:hidden"
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="hairline border-t bg-background lg:hidden" aria-label="Мобильная навигация">
          <div className="flex flex-col gap-1 px-4 py-3 sm:px-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`rounded-sm px-2 py-2.5 text-sm font-medium ${
                  pathname === link.href ? 'bg-blueprint-soft text-blueprint' : 'text-foreground'
                }`}
              >
                {link.labelRu}
              </Link>
            ))}
            <a
              href={whatsAppContactUrl()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('whatsapp_clicked', { location: 'header' })}
              className="mono px-2 py-2.5 text-sm text-steel"
            >
              WhatsApp {site.whatsappDisplay}
            </a>
            <LinkButton href="/configurator" className="mt-2" onClick={() => setMenuOpen(false)}>
              Конфигурировать стеллаж
            </LinkButton>
          </div>
        </nav>
      )}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 4.5H16M2 9H16M2 13.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.31 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.04 3.67C14.25 3.67 16.32 4.53 17.88 6.09C19.44 7.65 20.29 9.72 20.29 11.92C20.29 16.46 16.58 20.16 12.03 20.16C10.56 20.16 9.12 19.77 7.85 19.03L7.55 18.86L4.43 19.68L5.27 16.65L5.08 16.33C4.27 15.01 3.83 13.48 3.83 11.91C3.84 7.37 7.5 3.67 12.04 3.67ZM8.53 6.65C8.37 6.65 8.1 6.71 7.87 6.96C7.65 7.21 7 7.81 7 9.02C7 10.23 7.89 11.4 8.01 11.56C8.14 11.72 9.73 14.2 12.2 15.27C14.25 16.15 14.67 15.99 15.12 15.95C15.57 15.91 16.56 15.35 16.76 14.77C16.96 14.19 16.96 13.69 16.9 13.59C16.83 13.48 16.67 13.42 16.42 13.29C16.17 13.16 14.94 12.56 14.71 12.47C14.48 12.39 14.32 12.35 14.16 12.6C14 12.85 13.53 13.42 13.39 13.58C13.25 13.74 13.1 13.76 12.85 13.63C12.6 13.5 11.8 13.24 10.86 12.4C10.12 11.75 9.63 10.94 9.49 10.69C9.35 10.44 9.47 10.31 9.6 10.18C9.71 10.06 9.86 9.87 9.99 9.72C10.11 9.57 10.16 9.47 10.24 9.31C10.32 9.15 10.28 9.01 10.22 8.88C10.16 8.75 9.68 7.51 9.47 7.02C9.27 6.55 9.06 6.58 8.9 6.57C8.75 6.56 8.59 6.55 8.53 6.65Z" />
    </svg>
  );
}
