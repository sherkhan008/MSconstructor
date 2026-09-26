'use client';

import { usePathname } from 'next/navigation';
import './globals.css';
import { fontVariables } from './fonts';
import { ErrorPageContent } from '@/components/layout/ErrorPageContent';
import { Button, buttonClassName } from '@/components/ui/Button';
import { t } from '@/lib/i18n/format';
import { HTML_LANG, localizePath, type Locale } from '@/lib/i18n/locales';
import { EP } from '@/lib/i18n/strings';

/**
 * Last resort: an error in a root layout itself, where neither the site's
 * layout nor its LocaleProvider exists any more. It renders its own document,
 * picks the language from the address exactly as the middleware does (/ru…
 * is Russian, the unprefixed site is Kazakh; the admin panel is Russian) and,
 * like every error page, never shows the error itself.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname() ?? '/';
  const locale: Locale = /^\/(ru|admin)(\/|$)/.test(pathname) ? 'ru' : 'kk';

  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <main className="flex-1">
          <ErrorPageContent title={t(EP['EP-003'], locale)} text={t(EP['EP-004'], locale)}>
            <Button type="button" onClick={reset} className="min-h-12 px-6">
              {t(EP['EP-005'], locale)}
            </Button>
            {/* Plain links: after a layout failure a full page load is the reliable way back. */}
            <a
              href={localizePath('/catalog', locale)}
              className={`${buttonClassName('outline')} min-h-12 bg-surface px-6`}
            >
              {t(EP['EP-006'], locale)}
            </a>
            <a
              href={localizePath('/', locale)}
              className={`${buttonClassName('ghost')} min-h-12 px-6`}
            >
              {t(EP['EP-007'], locale)}
            </a>
          </ErrorPageContent>
        </main>
      </body>
    </html>
  );
}
