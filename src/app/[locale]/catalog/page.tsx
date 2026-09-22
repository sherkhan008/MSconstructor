import type { Metadata } from 'next';
import { findColor, getCatalog, stripModelSecrets } from '@/lib/data/repository';
import { filterPubliclyVisibleModels, filterPubliclyVisibleProducts } from '@/lib/config/launch-visibility';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { formatPrice } from '@/lib/money';
import { shelvesLabel } from '@/lib/plural';
import { siteCopy } from '@/lib/config/site';
import { buildMetadata, breadcrumbJsonLd, jsonLdScriptProps } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';
import { ArrowIcon, CheckIcon } from '@/components/ui/Icons';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { CatalogRackPreview } from '@/components/catalog/CatalogRackPreview';
import { ModelFacts } from '@/components/catalog/ModelFacts';
import { ProductCard } from '@/components/catalog/ProductCard';
import { FilterForm } from '@/components/catalog/FilterForm';
import { pick, t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CT, G, HM, PR, SE } from '@/lib/i18n/strings';

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
  const href = (path: string) => localizePath(path, locale);
  const mm = t(G['G-008'], locale);
  const params = await searchParams;
  const modelFilter = first(params.model);
  const useCaseFilter = first(params.useCase);
  const availabilityFilter = first(params.availability);
  const sort = first(params.sort) ?? 'recommended';

  const catalog = await getCatalog();
  const publicModels = filterPubliclyVisibleModels(catalog.models);
  const publicProducts = filterPubliclyVisibleProducts(catalog.products).filter((p) => p.published);

  let products = publicProducts;
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

  // One panel per public model, independent of the listing filters: what the
  // model is, its supported dimension spans, its lowest server-calculated
  // ready-configuration price and the two ways forward. The drawing is the
  // model's most popular real configuration, rendered by the configurator's
  // own preview — no product photo, no static rack.
  const models = publicModels.map((model) => {
    const own = publicProducts
      .filter((p) => p.modelSlug === model.slug)
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.popularity - a.popularity);
    const fromPrice = own.reduce<number | null>((min, product) => {
      const result = calculatePrice(catalogProductToConfiguration(product), catalog);
      if (!result.ok) return min;
      return min === null ? result.breakdown.total : Math.min(min, result.breakdown.total);
    }, null);
    return {
      slug: model.slug,
      name: pick(model.name, locale),
      shortDescription: pick(model.shortDescription, locale),
      description: pick(model.description, locale),
      heights: model.heights,
      widths: model.widths,
      depths: model.depths,
      maxLoadKg: model.maxLoadKg,
      fromPrice,
      configuration: own[0] ? catalogProductToConfiguration(own[0]) : null,
      color: own[0] ? findColor(catalog, own[0].color) : undefined,
    };
  });

  // The listing is grouped by model, in the order of the panels above, so
  // every group heading names the model its racks belong to.
  const groups = publicModels
    .map((model) => ({
      slug: model.slug,
      name: pick(model.name, locale),
      cards: sorted.filter((card) => card.product.modelSlug === model.slug),
    }))
    .filter((group) => group.cards.length > 0);

  return (
    <>
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

      {/* 1. Intro and the public model(s). */}
      <section aria-labelledby="catalog-title" className="border-b border-line bg-surface">
        <Container className="py-8 sm:py-12 lg:py-14">
          <div className="max-w-3xl">
            <p className="eyebrow">{siteCopy(locale).tagline}</p>
            <h1 id="catalog-title" className="mt-4 font-display text-[1.75rem] leading-[1.05] min-[390px]:text-[2rem] sm:text-5xl lg:text-[3.25rem]">
              {t(CT['CT-001'], locale)}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-steel sm:text-lg">{t(CT['CT-002'], locale)}</p>
          </div>

          <div className="mt-8 flex flex-col gap-6 sm:mt-10">
            {models.map((model) => (
              <article
                key={model.slug}
                aria-labelledby={`model-${model.slug}-title`}
                className="grid grid-cols-1 border border-line bg-surface lg:grid-cols-12"
              >
                <div className="flex flex-col p-4 min-[390px]:p-5 sm:p-8 lg:col-span-6 lg:p-10">
                  <p className="text-sm font-medium text-steel">{model.shortDescription}</p>
                  <h2 id={`model-${model.slug}-title`} className="mt-2 font-display text-4xl sm:text-5xl">
                    {model.name}
                  </h2>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-steel">{model.description}</p>

                  <ModelFacts
                    heights={model.heights}
                    widths={model.widths}
                    depths={model.depths}
                    maxLoadKg={model.maxLoadKg}
                    locale={locale}
                    className="mt-7"
                  />
                  <p className="mt-3 text-sm text-steel">{t(HM['HM-031'], locale)}</p>

                  <div className="mt-7 flex flex-col gap-4 border-t border-line pt-6">
                    {model.fromPrice !== null && (
                      <p className="mono text-[1.25rem] font-semibold min-[390px]:text-2xl sm:text-3xl">{t(PR['PR-005'], locale, { price: formatPrice(model.fromPrice) })}</p>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-fab-avoid>
                      <LinkButton
                        href={href(`/configurator?model=${model.slug}`)}
                        variant="accent"
                        className="min-h-12 whitespace-normal px-5 text-center"
                      >
                        {t(HM['HM-032'], locale)}
                        <ArrowIcon />
                      </LinkButton>
                      <LinkButton href={href(`/catalog/${model.slug}`)} variant="outline" className="min-h-12 whitespace-normal px-5 text-center">
                        {t(HM['HM-033'], locale)}
                      </LinkButton>
                    </div>
                  </div>
                </div>

                {/* From lg the drawing gets half the panel, a frame that starts
                    at the rack (tightFraming) and a caption strip, so the rack
                    fills its column instead of floating in a tall, mostly
                    empty cell. */}
                {model.configuration && (
                  <figure className="order-first flex flex-col border-b border-line lg:order-none lg:col-span-6 lg:border-b-0 lg:border-l">
                    <ShelvingPreview
                      config={model.configuration}
                      color={model.color}
                      presentation
                      tightFraming
                      className="aspect-[4/3] w-full !border-0 lg:aspect-auto lg:min-h-0 lg:flex-1"
                    />
                    <figcaption className="hidden flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-3 lg:flex">
                      <span className="font-display text-lg">{model.name}</span>
                      <span className="mono text-sm text-steel">
                        {model.configuration.height}×{model.configuration.sections.map((section) => section.width).join('+')}×{model.configuration.depth} {mm} ·{' '}
                        {shelvesLabel(model.configuration.shelves, locale)}
                      </span>
                    </figcaption>
                  </figure>
                )}
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* 2. Ready configurations with their live prices. */}
      <section className="bg-background">
        <Container className="py-12 sm:py-16">
          <div className="border-b border-line pb-5">
            <FilterForm
              // FilterForm is a Client Component ('use client'): whatever it
              // receives is serialized into the page's HTML/RSC payload, so the
              // raw internal ProductModel (markupPercent/markupFixed) must never
              // reach it. stripModelSecrets() is the same boundary
              // toPublicCatalog() uses — see src/lib/data/repository.ts.
              models={publicModels.map(stripModelSecrets)}
              useCases={catalog.useCases}
              defaults={{ model: modelFilter, useCase: useCaseFilter, availability: availabilityFilter, sort }}
            />
          </div>

          {groups.length === 0 ? (
            <p className="mt-10 text-steel">{t(CT['CT-018'], locale)}</p>
          ) : (
            groups.map((group) => (
              <div key={group.slug} className="mt-10">
                <h2 className="font-display text-2xl sm:text-3xl">{t(PR['PR-021'], locale, { model: group.name })}</h2>
                <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                  {group.cards.map(({ product, configuration, modelName, priceTotal }) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      configuration={configuration}
                      modelName={modelName}
                      priceTotal={priceTotal}
                      visual={
                        <CatalogRackPreview
                          config={configuration}
                          color={findColor(catalog, product.color)}
                          modelName={modelName}
                          locale={locale}
                          className="h-48 w-full border-b border-line"
                        />
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </Container>
      </section>

      {/* 3. Any size from the configurator, and how the rack is received. */}
      <section aria-labelledby="catalog-sizes-title" className="border-t border-line bg-surface">
        <Container className="py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-px border border-line bg-line lg:grid-cols-2">
            <div className="flex flex-col items-start bg-surface p-6 sm:p-8 lg:p-10">
              <h2 id="catalog-sizes-title" className="font-display text-3xl sm:text-4xl">
                {t(HM['HM-015'], locale)}
              </h2>
              <p className="mt-3 max-w-md text-base leading-relaxed text-steel">{t(HM['HM-016'], locale)}</p>
              <div className="mt-7 w-full sm:w-auto" data-fab-avoid>
                <LinkButton href={href('/configurator')} variant="accent" size="lg" className="min-h-12 w-full whitespace-normal text-center sm:w-auto">
                  {t(HM['HM-004'], locale)}
                  <ArrowIcon />
                </LinkButton>
              </div>
            </div>
            <div className="flex flex-col items-start bg-surface p-6 sm:p-8 lg:p-10">
              <h2 className="font-display text-3xl sm:text-4xl">{t(HM['HM-048'], locale)}</h2>
              <ul className="mt-5 space-y-3 text-base leading-relaxed">
                <li className="flex gap-3 font-medium">
                  <CheckIcon />
                  {t(HM['HM-050'], locale)}
                </li>
                <li className="flex gap-3">
                  <CheckIcon />
                  {t(HM['HM-051'], locale)}
                </li>
              </ul>
              <LinkButton href={href('/delivery')} variant="outline" className="mt-7 min-h-11 whitespace-normal text-center">
                {t(HM['HM-053'], locale)}
              </LinkButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
