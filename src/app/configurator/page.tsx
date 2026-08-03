import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { buildMetadata } from '@/lib/seo';
import { ConfiguratorClient } from '@/components/configurator/ConfiguratorClient';

export const metadata: Metadata = buildMetadata({
  title: 'Конфигуратор стеллажей MS — расчёт цены онлайн',
  description:
    'Соберите стеллаж MS под свои задачи: модель, размеры, полки, нагрузка, стенки, аксессуары. Цена рассчитывается мгновенно.',
  path: '/configurator',
});

export default async function ConfiguratorPage() {
  const catalog = await getCatalog();
  const publicCatalog = toPublicCatalog(catalog);

  return (
    <Suspense fallback={<ConfiguratorFallback />}>
      <ConfiguratorClient catalog={publicCatalog} />
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
