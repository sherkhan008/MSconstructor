import type { Metadata } from 'next';
import Link from 'next/link';
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
import { ArrowIcon, CheckIcon, DocumentIcon, LoadIcon, ModulesIcon, TruckIcon } from '@/components/ui/Icons';
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

  // The hero's benefit row: verified facts only — every line is existing,
  // owner-reviewed copy, and the load figure is the model's own catalog value.
  const heroBenefits = [
    heroModel ? { icon: <LoadIcon />, text: `${t(HM['HM-028'], locale)}: ${t(HM['HM-029'], locale, { N: heroModel.maxLoadKg })}` } : null,
    { icon: <ModulesIcon />, text: t(HM['HM-009'], locale) },
    { icon: <TruckIcon />, text: t(HM['HM-017'], locale) },
    { icon: <DocumentIcon />, text: t(HM['HM-021'], locale) },
  ].filter((benefit) => benefit !== null);

  // The configurator call-to-action draws a real ready rack too — the last of
  // the popular ones, as its own fresh configuration instance.
  const ctaCard = cards[cards.length - 1];
  const cta = ctaCard ? { configuration: catalogProductToConfiguration(ctaCard.product), color: ctaCard.color } : null;

  return (
    <>
      <script {...jsonLdScriptProps(organizationJsonLd(locale))} type="application/ld+json" />

      {/* 1. Hero — what is sold, that it is configured here, and its price:
          copy and actions on the left, the rack itself dominant on the right,
          the verified benefits underneath the copy. */}
      <section aria-labelledby="home-hero-title" className="bg-surface">
        <Container className="grid grid-cols-1 gap-8 pb-10 pt-8 sm:pb-12 sm:pt-12 lg:grid-cols-12 lg:items-stretch lg:gap-10 lg:py-14">
          <div className="flex flex-col justify-center lg:col-span-6">
            <p className="eyebrow">{copy.tagline}</p>
            <h1
              id="home-hero-title"
              className="mt-4 font-display text-[2rem] font-extrabold leading-[1.08] min-[390px]:text-[2.25rem] sm:text-5xl lg:text-[3rem] xl:text-[3.25rem]"
            >
              {t(HM['HM-002'], locale)}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-steel sm:text-[1.0625rem]">{t(HM['HM-003'], locale)}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-fab-avoid>
              <LinkButton href={href('/configurator')} variant="accent" size="lg" className="min-h-13 whitespace-normal text-center">
                {t(HM['HM-004'], locale)}
                <ArrowIcon />
              </LinkButton>
              <LinkButton href={href('/catalog')} variant="outline" size="lg" className="min-h-13 whitespace-normal text-center">
                {t(HM['HM-005'], locale)}
              </LinkButton>
            </div>

            <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-6 border-t border-line pt-7 sm:grid-cols-4">
              {heroBenefits.map((benefit) => (
                <li key={benefit.text} className="flex flex-col gap-2.5 text-[13px] font-medium leading-snug text-foreground">
                  {benefit.icon}
                  <span>{benefit.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {hero && (
            <div className="lg:col-span-6">
              <figure className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
                <ShelvingPreview
                  config={hero.configuration}
                  color={hero.color}
                  presentation
                  tightFraming
                  className="aspect-square w-full flex-1 !border-0 min-[480px]:aspect-[4/3]"
                />
                {/* Name, size and price, then the action — left of the
                    bottom-right corner, where the floating WhatsApp button
                    sits on the first screen. */}
                <figcaption className="flex flex-col gap-3 border-t border-line bg-background px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0">
                    <p className="text-base font-semibold">{hero.modelName}</p>
                    <p className="mono mt-0.5 text-sm text-steel">
                      {hero.product.height}×{hero.product.width}×{hero.product.depth} {t(G['G-008'], locale)} ·{' '}
                      {shelvesLabel(hero.product.shelves, locale)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3" data-fab-avoid>
                    {hero.priceTotal !== null && <PriceTag value={hero.priceTotal} size="lg" />}
                    <LinkButton
                      href={href(`/configurator?${configurationToShareQuery(hero.configuration)}`)}
                      variant="primary"
                      className="min-h-11 whitespace-normal text-center"
                    >
                      {t(PR['PR-006'], locale)}
                    </LinkButton>
                  </div>
                </figcaption>
              </figure>
            </div>
          )}
        </Container>
      </section>

      {/* 2. The catalog: the public model(s), then the ready configurations. */}
      <Section tone="white" labelledBy="home-models-title" className="border-t border-line" containerClassName="!pb-10">
        <SectionHeading
          id="home-models-title"
          title={t(HM['HM-024'], locale)}
          action={
            <Link
              href={href('/catalog')}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-foreground underline-offset-4 hover:underline"
            >
              {t(HM['HM-046'], locale)}
            </Link>
          }
        />
        <div className="mt-8 flex flex-col gap-6">
          {showcases.map(({ model, configuration, color }) => (
            <article key={model.slug} className="grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-2">
              <div className="flex flex-col gap-7 p-5 sm:p-8 lg:p-10">
                <div>
                  <h3 className="font-display text-3xl sm:text-4xl">{pick(model.name, locale)}</h3>
                  <p className="mt-3 max-w-xl text-base leading-relaxed text-steel">{pick(model.description, locale)}</p>
                </div>

                <div>
                  <dl className="overflow-hidden rounded-lg border border-line text-sm">
                    {[
                      { label: t(HM['HM-025'], locale), value: dimensionRange(model.heights, locale) },
                      { label: t(HM['HM-026'], locale), value: dimensionRange(model.widths, locale) },
                      { label: t(HM['HM-027'], locale), value: dimensionRange(model.depths, locale) },
                      { label: t(HM['HM-028'], locale), value: t(HM['HM-029'], locale, { N: model.maxLoadKg }) },
                    ].map((spec) => (
                      <div key={spec.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-4 py-2.5 odd:bg-background">
                        <dt className="text-steel">{spec.label}</dt>
                        <dd className="mono font-medium">{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-sm text-steel">{t(HM['HM-031'], locale)}</p>
                </div>

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

      {/* 3. Ready configurations with their live prices. */}
      <Section tone="white" labelledBy="home-popular-title" containerClassName="!pt-4">
        <SectionHeading
          id="home-popular-title"
          title={t(HM['HM-045'], locale)}
          description={startingPrice !== null ? t(PR['PR-005'], locale, { price: formatPrice(startingPrice) }) : undefined}
        />
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* 4. Configurator call to action: copy and actions left, a real rack
          right, on a light panel. */}
      <section aria-labelledby="home-final-title" className="bg-surface pb-12 sm:pb-14 lg:pb-16">
        <Container>
          <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-background md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-14 lg:py-14">
              <h2 id="home-final-title" className="font-display text-[1.75rem] sm:text-4xl">
                {t(HM['HM-001'], locale)}
              </h2>
              {startingPrice !== null && (
                <p className="mt-4 max-w-lg text-base text-steel">{t(HM['HM-006'], locale, { price: formatPrice(startingPrice) })}</p>
              )}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-fab-avoid>
                <LinkButton href={href('/configurator')} variant="accent" size="lg" className="min-h-13 whitespace-normal text-center">
                  {t(HM['HM-004'], locale)}
                  <ArrowIcon />
                </LinkButton>
                <LinkButton
                  href={whatsAppContactUrl(locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline"
                  size="lg"
                  className="min-h-13 whitespace-normal text-center"
                >
                  {t(H['H-006'], locale)}
                </LinkButton>
              </div>
            </div>
            {cta && (
              <div className="relative hidden border-l border-line bg-surface md:block">
                <ShelvingPreview config={cta.configuration} color={cta.color} presentation tightFraming className="!absolute inset-0 h-full !border-0" />
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* 5. The configurator flow — how an order comes together. */}
      <Section tone="default" labelledBy="home-how-title">
        <SectionHeading
          id="home-how-title"
          eyebrow={t(H['H-003'], locale)}
          title={t(HM['HM-034'], locale)}
          action={
            <LinkButton href={href('/configurator')} variant="accent" size="lg" className="!hidden whitespace-normal text-center sm:!inline-flex">
              {t(HM['HM-004'], locale)}
              <ArrowIcon />
            </LinkButton>
          }
        />
        <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step} className="flex gap-4 rounded-lg border border-line bg-surface p-5 sm:last:col-span-2 lg:flex-col lg:gap-5 lg:p-6 lg:last:col-span-1">
              <span className="mono text-2xl font-semibold leading-none text-foreground lg:text-3xl" aria-hidden="true">
                {String(item.step).padStart(2, '0')}
              </span>
              <div>
                <h3 className="text-base">{t(item.title, locale)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-steel">{t(item.description, locale)}</p>
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

      {/* 6. Commercial benefits and where the racks are used. */}
      <Section tone="white" labelledBy="home-why-title">
        <SectionHeading id="home-why-title" title={t(HM['HM-023'], locale)} />
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ADVANTAGES.map((item) => (
            <li key={item.title.ru} className="rounded-lg border border-line bg-surface p-5">
              <span className="block h-[3px] w-8 bg-accent" aria-hidden="true" />
              <h3 className="mt-4 text-base">{t(item.title, locale)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-steel">{t(item.description, locale)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-12">
          <h3 className="text-xl sm:text-2xl">{t(HM['HM-047'], locale)}</h3>
          <ul className="mt-5 flex flex-wrap gap-2">
            {catalog.useCases.map((useCase) => (
              <li key={useCase.id} className="rounded-md border border-line bg-background px-4 py-2.5 text-sm font-medium">
                {pick(useCase, locale)}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* 7. Delivery and payment. */}
      <Section tone="default">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col rounded-xl border border-line bg-surface p-6 sm:p-8 lg:p-10">
            <h2 className="font-display text-2xl sm:text-3xl">{t(HM['HM-048'], locale)}</h2>
            <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-2">
              <p className="rounded-md border-l-[3px] border-accent bg-accent-soft p-5 text-base font-medium leading-relaxed">
                {t(HM['HM-050'], locale)}
              </p>
              <p className="rounded-md border-l-[3px] border-foreground bg-background p-5 text-base leading-relaxed">{t(HM['HM-051'], locale)}</p>
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

          <div className="flex flex-col rounded-xl border border-line bg-surface p-6 sm:p-8 lg:p-10">
            <h2 className="font-display text-2xl sm:text-3xl">{t(HM['HM-054'], locale)}</h2>
            <ul className="mt-7 divide-y divide-line border-y border-line">
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

      {/* 8. Contacts. */}
      <Section tone="white" id="contacts" labelledBy="home-contacts-title">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 id="home-contacts-title" className="font-display text-[1.625rem] sm:text-3xl lg:text-[2rem]">
              {t(HM['HM-060'], locale)}
            </h2>
            <dl className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
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

          <div className="rounded-xl border border-line bg-background p-6 sm:p-8">
            <h3 className="font-display text-xl">{t(HM['HM-066'], locale)}</h3>
            <p className="mt-1 text-sm text-steel">{t(HM['HM-067'], locale)}</p>
            <div className="mt-5">
              <ContactForm />
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
