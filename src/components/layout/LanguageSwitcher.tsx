'use client';

import { usePathname } from 'next/navigation';
import type { MouseEvent } from 'react';
import { switchLocaleHref, type Locale } from '@/lib/i18n/locales';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { currentSwitchSearch } from '@/components/i18n/switch-query';

/**
 * ҚАЗ / RU switch. Each option links to the SAME page in the other language
 * (/catalog ↔ /ru/catalog, /configurator?… ↔ /ru/configurator?…), never to
 * the homepage. The server-rendered href carries no query string (the header
 * is shared by every page and must not opt pages out of static rendering);
 * on click it is completed with the page's allow-listed query parameters
 * (see SWITCHABLE_QUERY_KEYS; the configurator supplies its current state,
 * see switch-query.ts) right before the browser follows it.
 *
 * A full document navigation is intentional: `<html lang>` is rendered by the
 * server for the target locale. Cart and configurator state live in
 * localStorage and survive it untouched.
 *
 * The labels are each language's own short name, identical on both locales,
 * so they are not translated copy.
 */
const OPTIONS: { locale: Locale; label: string }[] = [
  { locale: 'kk', label: 'ҚАЗ' },
  { locale: 'ru', label: 'RU' },
];

export function LanguageSwitcher() {
  const pathname = usePathname() ?? '/';
  const current = useLocale();

  function handleClick(event: MouseEvent<HTMLAnchorElement>, target: Locale) {
    if (target === current) {
      event.preventDefault();
      return;
    }
    event.currentTarget.href = switchLocaleHref(pathname, currentSwitchSearch(), target);
  }

  return (
    <div className="inline-flex shrink-0 border border-line" data-testid="language-switcher">
      {OPTIONS.map(({ locale, label }, index) => {
        const active = locale === current;
        return (
          <a
            key={locale}
            href={switchLocaleHref(pathname, '', locale)}
            hrefLang={locale}
            lang={locale}
            aria-current={active ? 'true' : undefined}
            onClick={(event) => handleClick(event, locale)}
            className={`relative grid h-11 min-w-10 place-items-center px-2 text-xs font-semibold tracking-wide transition-colors ${
              index > 0 ? 'border-l border-line' : ''
            } ${active ? 'bg-foreground text-background' : 'bg-surface text-foreground hover:bg-surface-muted'}`}
          >
            {label}
          </a>
        );
      })}
    </div>
  );
}
