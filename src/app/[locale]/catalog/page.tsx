import type { Metadata } from 'next';
import { findColor, getCatalog, stripModelSecrets } from '@/lib/data/repository';
import { filterPubliclyVisibleModels, filterPubliclyVisibleProducts } from '@/lib/config/launch-visibility';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { buildMetadata, breadcrumbJsonLd, jsonLdScriptProps } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { CatalogRackPreview } from '@/components/catalog/CatalogRackPreview';
import { ProductCard } from '@/components/catalog/ProductCard';
import { FilterForm } from '@/components/catalog/FilterForm';
import { pick, t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CT, SE } from '@/lib/i18n/strings';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-010'], locale), description: t(SE['SE-011'], locale), path: '/catalog', locale });
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CatalogPage({
  params: routeParams,
  searchParams,
}: {
  params: LocaleParams;
  searchParams: Promise<SearchParams>;
}) {
  const locale = await resolveLocale(routeParams);
  const params = await searchParams;
  const modelFilter = first(params.model);
  const useCaseFilter = first(params.useCase);
  const availabilityFilter = first(params.availability);
  const sort = first(params.sort) ?? 'recommended';

  const catalog = await getCatalog();

  let products = filterPubliclyVisibleProducts(catalog.products).filter((p) => p.published);
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
      modelName: model ? pick(model.name, locale) : product.modelSlug,
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
          breadcrumbJsonLd(
            [
              { name: t(CT['CT-003'], locale), path: '/' },
              { name: t(CT['CT-004'], locale), path: '/catalog' },
            ],
            locale,
          ),
        )}
        type="application/ld+json"
      />

      <h1 className="font-display text-4xl">{t(CT['CT-001'], locale)}</h1>
      <p className="mt-2 max-w-2xl text-steel">{t(CT['CT-002'], locale)}</p>

      <div className="mt-6 border border-line bg-surface-muted p-4">
        <FilterForm
          // FilterForm is a Client Component ('use client'): whatever it
          // receives is serialized into the page's HTML/RSC payload, so the
          // raw internal ProductModel (markupPercent/markupFixed) must never
          // reach it. stripModelSecrets() is the same boundary
          // toPublicCatalog() uses — see src/lib/data/repository.ts.
          models={filterPubliclyVisibleModels(catalog.models).map(stripModelSecrets)}
          useCases={catalog.useCases}
          defaults={{ model: modelFilter, useCase: useCaseFilter, availability: availabilityFilter, sort }}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-10 text-steel">{t(CT['CT-018'], locale)}</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(({ product, configuration, modelName, priceTotal }) => (
            <ProductCard
              key={product.id}
              product={product}
              configuration={configuration}
              modelName={modelName}
              priceTotal={priceTotal} visual={<CatalogRackPreview config={configuration} color={findColor(catalog, product.color)} modelName={modelName} locale={locale} className="h-48 w-full border-b border-line" />}
            />
          ))}
        </div>
      )}
    </Container>
  );
}
