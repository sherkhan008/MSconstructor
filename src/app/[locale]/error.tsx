'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { ErrorPageContent } from '@/components/layout/ErrorPageContent';
import { Button, LinkButton } from '@/components/ui/Button';
import { t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { EP } from '@/lib/i18n/strings';

/**
 * An unexpected error while rendering a public page: shown inside the site's
 * header and footer, in the page's language, with a retry and a way back to
 * the catalog. The error itself is never displayed — no message, digest or
 * stack reaches the customer (the server logs it).
 */
export default function PublicPageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useLocale();
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      // A server-rendered segment only re-renders with fresh data after a refresh.
      router.refresh();
      reset();
    });

  return (
    <ErrorPageContent title={t(EP['EP-003'], locale)} text={t(EP['EP-004'], locale)}>
      <Button type="button" onClick={retry} className="min-h-12 px-6">
        {t(EP['EP-005'], locale)}
      </Button>
      <LinkButton href={localizePath('/catalog', locale)} variant="outline" className="min-h-12 bg-surface px-6">
        {t(EP['EP-006'], locale)}
      </LinkButton>
      <LinkButton href={localizePath('/', locale)} variant="ghost" className="min-h-12 px-6">
        {t(EP['EP-007'], locale)}
      </LinkButton>
    </ErrorPageContent>
  );
}
