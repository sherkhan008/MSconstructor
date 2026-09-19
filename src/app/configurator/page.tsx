import { notFound } from 'next/navigation';
import { filterPubliclyVisibleModels, isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { buildMetadata } from '@/lib/seo';
import { ClientOnlyConfigurator } from '@/components/configurator/ClientOnlyConfigurator';

export const metadata: Metadata = buildMetadata({
  title: 'Конфигуратор стеллажей MS — расчёт цены онлайн',
  description:
    'Соберите стеллаж MS под свои задачи: модель, размеры, полки, нагрузка, стенки, аксессуары. Цена рассчитывается мгновенно.',
  path: '/configurator',
});

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export default async function ConfiguratorPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedModels = Array.isArray(params.model) ? params.model : params.model ? [params.model] : [];
  if (requestedModels.some(slug => !isModelSlugPubliclyVisible(slug))) notFound();
  const catalog = await getCatalog();
  const publicCatalog = toPublicCatalog(catalog);
  publicCatalog.models = filterPubliclyVisibleModels(publicCatalog.models);

  return (
    <Suspense fallback={<ConfiguratorFallback />}>
      <ClientOnlyConfigurator catalog={publicCatalog} fallback={<ConfiguratorFallback />} />
    </Suspense>
  );
}

function ConfiguratorFallback() {
  return (
    <div className="mx-auto flex h-[60vh] w-full max-w-7xl items-center justify-center px-4">
      <p className="tech-label">Загрузка конфигуратора…</p>
    </div>
  );
}
