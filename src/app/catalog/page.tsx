import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { buildMetadata, breadcrumbJsonLd, jsonLdScriptProps } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { ProductCard } from '@/components/catalog/ProductCard';
import { FilterForm } from '@/components/catalog/FilterForm';

export const metadata: Metadata = buildMetadata({
  title: 'Каталог металлических стеллажей MS — цены и характеристики',
  description:
    'Каталог складских, архивных и усиленных металлических стеллажей MS. Фильтры по модели, размерам и назначению, расчёт цены онлайн.',
  path: '/catalog',
});

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const modelFilter = first(params.model);
  const useCaseFilter = first(params.useCase);
  const availabilityFilter = first(params.availability);
  const sort = first(params.sort) ?? 'recommended';

  const catalog = await getCatalog();

  let products = catalog.products.filter((p) => p.published);
  if (modelFilter) products = products.filter((p) => p.modelSlug === modelFilter);
  if (useCaseFilter) products = products.filter((p) => p.useCases.includes(useCaseFilter));
  if (availabilityFilter === 'in_stock') products = products.filter((p) => p.inStock);

  const cards = products.map((product) => {
    const configuration = catalogProductToConfiguration(product);
    const result = calculatePrice(configuration, catalog);
    const model = catalog.models.find((m) => m.slug === product.modelSlug);
    return {
      product,
      configuration,
      modelName: model?.name.ru ?? product.modelSlug,
      priceTotal: result.ok ? result.breakdown.total : null,
    };
  });

  const sorted = [...cards].sort((a, b) => {
    switch (sort) {
      case 'price_asc':
        return (a.priceTotal ?? Infinity) - (b.priceTotal ?? Infinity);
      case 'price_desc':
        return (b.priceTotal ?? -Infinity) - (a.priceTotal ?? -Infinity);
      case 'popularity':
        return b.product.popularity - a.product.popularity;
      case 'newest':
        return new Date(b.product.createdAt).getTime() - new Date(a.product.createdAt).getTime();
      default:
        return (b.product.featured ? 1 : 0) - (a.product.featured ? 1 : 0) || b.product.popularity - a.product.popularity;
    }
  });

  return (
    <Container className="py-10">
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: 'Главная', path: '/' },
            { name: 'Каталог', path: '/catalog' },
          ]),
        )}
        type="application/ld+json"
      />

      <h1 className="font-display text-4xl">Каталог стеллажей MS</h1>
      <p className="mt-2 max-w-2xl text-steel">
        Готовые конфигурации с расчитанной ценой. Любую из них можно настроить под себя в конфигураторе.
      </p>

      <div className="mt-6 border border-line bg-surface-muted p-4">
        <FilterForm
          models={catalog.models}
          useCases={catalog.useCases}
          defaults={{ model: modelFilter, useCase: useCaseFilter, availability: availabilityFilter, sort }}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-10 text-steel">По выбранным фильтрам ничего не найдено. Попробуйте изменить параметры.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(({ product, configuration, modelName, priceTotal }) => (
            <ProductCard
              key={product.id}
              product={product}
              configuration={configuration}
              modelName={modelName}
              priceTotal={priceTotal}
            />
          ))}
        </div>
      )}
    </Container>
  );
}
