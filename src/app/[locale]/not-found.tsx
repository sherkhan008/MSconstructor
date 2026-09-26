'use client';

import { useLocale } from '@/components/i18n/LocaleProvider';
import { ErrorPageContent } from '@/components/layout/ErrorPageContent';
import { LinkButton } from '@/components/ui/Button';
import { t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { EP } from '@/lib/i18n/strings';

/**
 * The public 404, inside the site's own header and footer and in the page's
 * language: any unknown address (see [...rest]/page.tsx), a hidden or unknown
 * catalog model, and every other notFound() under the locale segment. A
 * not-found page receives no route params, so the locale comes from the
 * layout's LocaleProvider.
 */
export default function NotFound() {
  const locale = useLocale();
  return (
    <ErrorPageContent code="404" title={t(EP['EP-001'], locale)} text={t(EP['EP-002'], locale)}>
      <LinkButton href={localizePath('/catalog', locale)} className="min-h-12 px-6">
        {t(EP['EP-006'], locale)}
      </LinkButton>
      <LinkButton href={localizePath('/', locale)} variant="outline" className="min-h-12 bg-surface px-6">
        {t(EP['EP-007'], locale)}
      </LinkButton>
    </ErrorPageContent>
  );
}
