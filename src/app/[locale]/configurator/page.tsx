import { notFound } from 'next/navigation';
import { filterPubliclyVisibleModels, isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { buildMetadata } from '@/lib/seo';
import { t } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/locales';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CF, SE } from '@/lib/i18n/strings';
import { ClientOnlyConfigurator } from '@/components/configurator/ClientOnlyConfigurator';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-022'], locale), description: t(SE['SE-023'], locale), path: '/configurator', locale });
}

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export default async function ConfiguratorPage({
  params: routeParams,
  searchParams,
}: {
  params: LocaleParams;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await resolveLocale(routeParams);
  const params = await searchParams;
  const requestedModels = Array.isArray(params.model) ? params.model : params.model ? [params.model] : [];
  if (requestedModels.some(slug => !isModelSlugPubliclyVisible(slug))) notFound();
  const catalog = await getCatalog();
  const publicCatalog = toPublicCatalog(catalog);
  publicCatalog.models = filterPubliclyVisibleModels(publicCatalog.models);

  return (
    <Suspense fallback={<ConfiguratorFallback locale={locale} />}>
      <ClientOnlyConfigurator catalog={publicCatalog} fallback={<ConfiguratorFallback locale={locale} />} />
    </Suspense>
  );
}

function ConfiguratorFallback({ locale }: { locale: Locale }) {
  return (
    <div className="mx-auto flex h-[60vh] w-full max-w-7xl items-center justify-center px-4">
      <p className="tech-label">{t(CF['CF-001'], locale)}</p>
    </div>
  );
}
