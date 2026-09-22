import type { Metadata } from 'next';
import { findColor, getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { configurationToShareQuery } from '@/lib/configurator/url';
import { formatPrice } from '@/lib/money';
import { shelvesLabel } from '@/lib/plural';
import { buildMetadata, jsonLdScriptProps, organizationJsonLd } from '@/lib/seo';
import { site, siteCopy } from '@/lib/config/site';
import { filterPubliclyVisibleModels, filterPubliclyVisibleProducts } from '@/lib/config/launch-visibility';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { Container } from '@/components/ui/Container';
import { Section, SectionHeading } from '@/components/ui/Section';
import { LinkButton } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { ProductImage } from '@/components/ui/ProductImage';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ContactForm } from '@/components/contact/ContactForm';
import { ArrowIcon, CheckIcon } from '@/components/ui/Icons';
import { pick, t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { G, H, HM, PR, SE } from '@/lib/i18n/strings';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const copy = siteCopy(locale);
  return buildMetadata({
    title: t(SE['SE-001'], locale, { brand: copy.name }),
    description: copy.shortDescription,
    path: '/',
    locale,
  });
}

const ADVANTAGES = [
  { title: HM['HM-007'], description: HM['HM-008'] },
  { title: HM['HM-009'], description: HM['HM-010'] },
  { title: HM['HM-011'], description: HM['HM-012'] },
  { title: HM['HM-013'], description: HM['HM-014'] },
  { title: HM['HM-015'], description: HM['HM-016'] },
  { title: HM['HM-017'], description: HM['HM-018'] },
  { title: HM['HM-019'], description: HM['HM-020'] },
  { title: HM['HM-021'], description: HM['HM-022'] },
];

const HOW_IT_WORKS = [
  { step: 1, title: HM['HM-035'], description: HM['HM-036'] },
  { step: 2, title: HM['HM-037'], description: HM['HM-038'] },
  { step: 3, title: HM['HM-039'], description: HM['HM-040'] },
  { step: 4, title: HM['HM-041'], description: HM['HM-042'] },
  { step: 5, title: HM['HM-043'], description: HM['HM-044'] },
];

/** The homepage shows the three most popular ready configurations — which
 * three is catalog data (`featured` + `popularity`), never a list of slugs
 * written into this page. */
const POPULAR_CONFIGURATION_COUNT = 3;

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

/** "1000–3000 мм" from a model's supported values. The range is a span, not
 * a claim that every combination inside it is valid — the compatibility rules
 * (src/lib/pricing/ms-standard-compatibility.ts) stay the only authority on
 * which width×depth×height×shelves combinations the customer can actually
 * order, which is why the panel sends them to the configurator to pick. */
function dimensionRange(values: number[], locale: Locale): string {
  return t(HM['HM-030'], locale, { min: Math.min(...values), max: Math.max(...values) });
}

export default async function HomePage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const copy = siteCopy(locale);
  const href = (path: string) => localizePath(path, locale);
  const catalog = await getCatalog();
  const publicModels = filterPubliclyVisibleModels(catalog.models);
  const featuredProducts = filterPubliclyVisibleProducts(catalog.products)
    .filter((p) => p.featured)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, POPULAR_CONFIGURATION_COUNT);

  const cards = featuredProducts.map((product) => {
    const configuration = catalogProductToConfiguration(product);
    const result = calculatePrice(configuration, catalog);
    const model = catalog.models.find((m) => m.slug === product.modelSlug);
    return {
      product,
      configuration,
      color: findColor(catalog, product.color),
      modelName: model ? pick(model.name, locale) : product.modelSlug,
      priceTotal: result.ok ? result.breakdown.total : null,
    };
  });

  // Each public model gets one feature panel, rendered from its own catalog
  // row: the dimension ranges below are the model's supported values, and the
  // visual is its most popular real configuration drawn by the configurator's
  // own renderer — no separate compatibility table, no static product shot.
  const showcases = publicModels.map((model) => {
    const product = featuredProducts.find((p) => p.modelSlug === model.slug);
    return {
      model,
      // A fresh configuration instance per showcase, never the object a
      // ProductCard below is already holding.
      configuration: product ? catalogProductToConfiguration(product) : null,
      color: product ? findColor(catalog, product.color) : undefined,
    };
  });

  const startingPrice = cards.reduce<number | null>((min, card) => {
    if (card.priceTotal === null) return min;
    return min === null ? card.priceTotal : Math.min(min, card.priceTotal);
  }, null);

  // The hero shows the single most popular ready rack: its own drawing, its
  // own dimensions and its own server-calculated price, one click from the
  // configurator preloaded with exactly that rack. A fresh configuration
  // instance again, so it shares no state with the cards below.
  const heroCard = cards[0];
  const hero = heroCard
    ? {
        ...heroCard,
        configuration: catalogProductToConfiguration(heroCard.product),
      }
    : null;
  const heroModel = publicModels[0];

  const heroFacts = [
    t(HM['HM-001'], locale),
    heroModel ? `${t(HM['HM-028'], locale)}: ${t(HM['HM-029'], locale, { N: heroModel.maxLoadKg })}` : null,
    t(HM['HM-017'], locale),
  ].filter((fact): fact is string => fact !== null);

  return (
    <>
      <script {...jsonLdScriptProps(organizationJsonLd(locale))} type="application/ld+json" />

      {/* 1. Hero — what is sold, that it is configured here, and its price. */}
      <section aria-labelledby="home-hero-title" className="border-b border-line bg-surface">
        <Container className="grid grid-cols-1 items-center gap-10 py-10 sm:py-14 lg:grid-cols-12 lg:gap-12 lg:py-20">
          <div className="lg:col-span-7">
            <p className="eyebrow">{copy.tagline}</p>
            <h1
              id="home-hero-title"
              className="mt-4 font-display text-[2.1875rem] leading-[1.04] min-[390px]:text-[2.375rem] sm:text-6xl lg:text-[4rem] xl:text-[4.75rem]"
            >
              {t(HM['HM-002'], locale)}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-steel sm:text-lg">{t(HM['HM-003'], locale)}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-fab-avoid>
              <LinkButton href={href('/configurator')} variant="accent" size="lg" className="min-h-14 whitespace-normal text-center">
                {t(HM['HM-004'], locale)}
                <ArrowIcon />
              </LinkButton>
              <LinkButton href={href('/catalog')} variant="outline" size="lg" className="min-h-14 whitespace-normal text-center">
                {t(HM['HM-005'], locale)}
              </LinkButton>
            </div>

            <ul className="mt-9 grid grid-cols-1 gap-3 border-t border-line pt-6 sm:grid-cols-3 sm:gap-5">
              {heroFacts.map((fact) => (
                <li key={fact} className="flex items-start gap-3 text-sm font-medium leading-snug text-foreground">
                  <CheckIcon />
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </div>

          {hero && (
            <div className="lg:col-span-5">
              <figure className="border border-line bg-surface shadow-[0_24px_48px_-32px_rgba(28,32,36,0.35)]">
                <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4 sm:px-6">
                  <span className="font-display text-xl">{hero.modelName}</span>
                  <span className="mono text-sm text-steel">
                    {hero.product.height}×{hero.product.width}×{hero.product.depth} {t(G['G-008'], locale)} ·{' '}
                    {shelvesLabel(hero.product.shelves, locale)}
                  </span>
                </figcaption>
                <ShelvingPreview
                  config={hero.configuration}
                  color={hero.color}
                  presentation
                  className="aspect-square w-full !border-0 min-[480px]:aspect-[4/3]"
                />
                {/* Price, then the action, both left-aligned: the bottom-right
                    corner is where the floating WhatsApp button sits, and an
                    action there would hide it on the first screen. */}
                <div className="flex flex-col items-start gap-3 border-t border-line bg-background px-5 py-4 sm:px-6">
                  {hero.priceTotal !== null && <PriceTag value={hero.priceTotal} size="xl" />}
                  <div className="w-full sm:w-auto" data-fab-avoid>
                    <LinkButton
                      href={href(`/configurator?${configurationToShareQuery(hero.configuration)}`)}
                      variant="primary"
                      className="min-h-11 w-full whitespace-normal text-center sm:w-auto"
                    >
                      {t(PR['PR-006'], locale)}
                    </LinkButton>
                  </div>
                </div>
              </figure>
            </div>
          )}
        </Container>
      </section>

      {/* 2. The configurator flow — the primary conversion path. */}
      <Section tone="dark" labelledBy="home-how-title">
        <SectionHeading
          id="home-how-title"
          dark
          eyebrow={t(H['H-003'], locale)}
          title={t(HM['HM-034'], locale)}
          action={
            <LinkButton href={href('/configurator')} variant="accent" size="lg" className="!hidden whitespace-normal text-center sm:!inline-flex">
              {t(HM['HM-004'], locale)}
              <ArrowIcon />
            </LinkButton>
          }
        />
        <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden border border-line-dark bg-line-dark sm:grid-cols-2 lg:grid-cols-5">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step} className="flex gap-4 bg-surface-dark p-6 sm:last:col-span-2 lg:flex-col lg:gap-6 lg:p-7 lg:last:col-span-1">
              <span className="mono text-3xl font-semibold leading-none text-accent lg:text-4xl" aria-hidden="true">
                {String(item.step).padStart(2, '0')}
              </span>
              <div>
                <h3 className="text-xl">{t(item.title, locale)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-steel-soft">{t(item.description, locale)}</p>
              </div>
            </li>
          ))}
        </ol>
        {/* On phones the CTA follows the steps instead of preceding them. */}
        <div className="mt-8 sm:hidden" data-fab-avoid>
          <LinkButton href={href('/configurator')} variant="accent" size="lg" className="w-full whitespace-normal text-center">
            {t(HM['HM-004'], locale)}
            <ArrowIcon />
          </LinkButton>
        </div>
      </Section>

      {/* 3. The public model(s). */}
      <Section tone="white" labelledBy="home-models-title">
        <SectionHeading id="home-models-title" title={t(HM['HM-024'], locale)} />
        <div className="mt-10 flex flex-col gap-8">
          {showcases.map(({ model, configuration, color }) => (
            <article key={model.slug} className="grid grid-cols-1 border border-line bg-surface lg:grid-cols-2">
              <div className="flex flex-col gap-8 p-6 sm:p-8 lg:p-12">
                <div>
                  <h3 className="font-display text-4xl sm:text-5xl">{pick(model.name, locale)}</h3>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-steel">{pick(model.description, locale)}</p>
                </div>

                <dl className="grid grid-cols-1 gap-px border border-line bg-line min-[400px]:grid-cols-2">
                  {[
                    { label: t(HM['HM-025'], locale), value: dimensionRange(model.heights, locale) },
                    { label: t(HM['HM-026'], locale), value: dimensionRange(model.widths, locale) },
                    { label: t(HM['HM-027'], locale), value: dimensionRange(model.depths, locale) },
                    { label: t(HM['HM-028'], locale), value: t(HM['HM-029'], locale, { N: model.maxLoadKg }) },
                  ].map((spec) => (
                    <div key={spec.label} className="bg-surface p-4 sm:p-5">
                      <dt className="text-sm text-steel">{spec.label}</dt>
                      <dd className="mono mt-1.5 text-lg font-semibold leading-snug">{spec.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="-mt-4 text-sm text-steel">{t(HM['HM-031'], locale)}</p>

                <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-fab-avoid>
                  <LinkButton href={href(`/configurator?model=${model.slug}`)} variant="accent" size="lg" className="whitespace-normal text-center">
                    {t(HM['HM-032'], locale)}
                  </LinkButton>
                  <LinkButton href={href(`/catalog/${model.slug}`)} variant="outline" size="lg" className="whitespace-normal text-center">
                    {t(HM['HM-033'], locale)}
                  </LinkButton>
                </div>
              </div>

              <div className="border-t border-line lg:border-l lg:border-t-0">
                {configuration ? (
                  <ShelvingPreview config={configuration} color={color} presentation className="aspect-square h-full w-full !border-0 min-[480px]:aspect-[4/3]" />
                ) : (
                  <ProductImage src={model.image} alt={pick(model.name, locale)} className="aspect-[4/3] w-full object-cover" />
                )}
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* 4. Ready configurations with their live prices. */}
      <Section tone="muted" labelledBy="home-popular-title">
        <SectionHeading
          id="home-popular-title"
          title={t(HM['HM-045'], locale)}
          description={startingPrice !== null ? t(PR['PR-005'], locale, { price: formatPrice(startingPrice) }) : undefined}
          action={
            <LinkButton href={href('/catalog')} variant="outline" className="min-h-11 bg-surface">
              {t(HM['HM-046'], locale)}
            </LinkButton>
          }
        />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {cards.map(({ product, configuration, color, modelName, priceTotal }) => (
            <ProductCard
              key={product.id}
              product={product}
              configuration={configuration}
              modelName={modelName}
              priceTotal={priceTotal}
              // Drawn from this card's own configuration, so the rack a
              // customer sees is the one they price, configure and buy.
              visual={
                <div className="h-52 w-full overflow-hidden border-b border-line bg-surface">
                  <ShelvingPreview
                    config={configuration}
                    color={color}
                    className="h-full w-full origin-top-left scale-[1.35] !border-0"
                  />
                </div>
              }
            />
          ))}
        </div>
      </Section>

      {/* 5. Commercial benefits and where the racks are used. */}
      <Section tone="white" labelledBy="home-why-title">
        <SectionHeading id="home-why-title" title={t(HM['HM-023'], locale)} />
        <ul className="mt-10 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {ADVANTAGES.map((item) => (
            <li key={item.title.ru} className="bg-surface p-6">
              <span className="block h-[3px] w-8 bg-accent" aria-hidden="true" />
              <h3 className="mt-5 text-xl">{t(item.title, locale)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-steel">{t(item.description, locale)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-14">
          <h3 className="text-2xl sm:text-3xl">{t(HM['HM-047'], locale)}</h3>
          <ul className="mt-5 flex flex-wrap gap-2">
            {catalog.useCases.map((useCase) => (
              <li key={useCase.id} className="border border-line bg-background px-4 py-2.5 text-sm font-medium">
                {pick(useCase, locale)}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* 6. Delivery and payment. */}
      <Section tone="muted">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col border border-line bg-surface p-6 sm:p-8 lg:p-10">
            <h2 className="font-display text-3xl sm:text-4xl">{t(HM['HM-048'], locale)}</h2>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
              <p className="border-l-[3px] border-accent bg-accent-soft p-5 text-base font-medium leading-relaxed">
                {t(HM['HM-050'], locale)}
              </p>
              <p className="border-l-[3px] border-foreground bg-background p-5 text-base leading-relaxed">{t(HM['HM-051'], locale)}</p>
            </div>
            <ul className="mt-6 space-y-2 text-sm text-steel">
              <li className="flex gap-3">
                <CheckIcon />
                {t(HM['HM-049'], locale)}
              </li>
              <li className="flex gap-3">
                <CheckIcon />
                {t(HM['HM-052'], locale)}
              </li>
            </ul>
            <LinkButton href={href('/delivery')} variant="outline" className="mt-8 min-h-11 self-start whitespace-normal text-center">
              {t(HM['HM-053'], locale)}
            </LinkButton>
          </div>

          <div className="flex flex-col border border-line bg-surface p-6 sm:p-8 lg:p-10">
            <h2 className="font-display text-3xl sm:text-4xl">{t(HM['HM-054'], locale)}</h2>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {[HM['HM-055'], HM['HM-056'], HM['HM-057'], HM['HM-058']].map((entry) => (
                <li key={entry.ru} className="py-3.5 text-base">
                  {t(entry, locale)}
                </li>
              ))}
            </ul>
            <LinkButton href={href('/payment')} variant="outline" className="mt-8 min-h-11 self-start whitespace-normal text-center">
              {t(HM['HM-059'], locale)}
            </LinkButton>
          </div>
        </div>
      </Section>

      {/* 7. Contacts. */}
      <Section tone="white" id="contacts" labelledBy="home-contacts-title">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 id="home-contacts-title" className="font-display text-3xl sm:text-4xl">
              {t(HM['HM-060'], locale)}
            </h2>
            <dl className="mt-8 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2">
              <div className="bg-surface p-5">
                <dt className="text-sm text-steel">{t(HM['HM-061'], locale)}</dt>
                <dd className="mono mt-1 text-lg">
                  <a
                    href={whatsAppContactUrl(locale)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center text-success hover:underline"
                  >
                    {site.whatsappDisplay}
                  </a>
                </dd>
              </div>
              <div className="bg-surface p-5">
                <dt className="text-sm text-steel">{t(HM['HM-062'], locale)}</dt>
                <dd className="mt-1">
                  <a href={`mailto:${site.email}`} className="inline-flex min-h-9 items-center break-all hover:underline">
                    {site.email}
                  </a>
                </dd>
              </div>
              <div className="bg-surface p-5">
                <dt className="text-sm text-steel">{t(HM['HM-063'], locale)}</dt>
                <dd className="mt-1">{copy.address}</dd>
              </div>
              <div className="bg-surface p-5">
                <dt className="text-sm text-steel">{t(HM['HM-064'], locale)}</dt>
                <dd className="mt-1">{copy.workingHours}</dd>
              </div>
            </dl>
          </div>

          <div className="border border-line bg-background p-6 sm:p-8">
            <h3 className="font-display text-2xl">{t(HM['HM-066'], locale)}</h3>
            <p className="mt-1 text-sm text-steel">{t(HM['HM-067'], locale)}</p>
            <div className="mt-5">
              <ContactForm />
            </div>
          </div>
        </div>
      </Section>

      {/* 8. Final configurator CTA. */}
      <section aria-labelledby="home-final-title" className="bg-surface pb-16 sm:pb-20 lg:pb-24">
        <Container>
          <div className="relative overflow-hidden border-t-4 border-accent bg-surface-dark px-6 py-12 text-background sm:px-10 sm:py-14 lg:px-14 lg:py-16 [&_:focus-visible]:outline-accent">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="eyebrow !text-steel-soft">{t(H['H-003'], locale)}</p>
                <h2 id="home-final-title" className="mt-4 font-display text-3xl sm:text-5xl">
                  {t(HM['HM-001'], locale)}
                </h2>
                {startingPrice !== null && (
                  <p className="mt-4 text-base text-steel-soft sm:text-lg">
                    {t(HM['HM-006'], locale, { price: formatPrice(startingPrice) })}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0" data-fab-avoid>
                <LinkButton href={href('/configurator')} variant="accent" size="lg" className="min-h-14 whitespace-normal text-center">
                  {t(HM['HM-004'], locale)}
                  <ArrowIcon />
                </LinkButton>
                <LinkButton
                  href={whatsAppContactUrl(locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline-dark"
                  size="lg"
                  className="min-h-14 whitespace-normal text-center"
                >
                  {t(H['H-006'], locale)}
                </LinkButton>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
