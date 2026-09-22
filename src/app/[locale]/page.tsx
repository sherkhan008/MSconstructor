import type { Metadata } from 'next';
import Link from 'next/link';
import { findColor, getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { formatPrice } from '@/lib/money';
import { buildMetadata, jsonLdScriptProps, organizationJsonLd } from '@/lib/seo';
import { site, siteCopy } from '@/lib/config/site';
import { filterPubliclyVisibleModels, filterPubliclyVisibleProducts } from '@/lib/config/launch-visibility';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { ProductImage } from '@/components/ui/ProductImage';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ContactForm } from '@/components/contact/ContactForm';
import { pick, t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { HM, SE } from '@/lib/i18n/strings';

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

const USE_CASE_ICONS: Record<string, string> = {
  warehouse: '🏭',
  archive: '🗄️',
  office: '🏢',
  garage: '🚗',
  storage: '📦',
  shop: '🛒',
  workshop: '🔧',
  medical: '🏥',
  education: '🎓',
};

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

  return (
    <>
      <script {...jsonLdScriptProps(organizationJsonLd(locale))} type="application/ld+json" />

      {/* Hero */}
      <section className="blueprint-grid hairline border-t-0 border-x-0">
        <Container className="grid grid-cols-1 items-center gap-8 py-14 lg:grid-cols-2 lg:py-20">
          <div>
            <Badge tone="blueprint">{t(HM['HM-001'], locale)}</Badge>
            <h1 className="mt-4 font-display text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">{t(HM['HM-002'], locale)}</h1>
            <p className="mt-4 max-w-lg text-base text-steel">{t(HM['HM-003'], locale)}</p>
            <div className="mt-6 flex flex-wrap gap-3" data-fab-avoid>
              <LinkButton href={href('/configurator')} size="lg">
                {t(HM['HM-004'], locale)}
              </LinkButton>
              <LinkButton href={href('/catalog')} variant="outline" size="lg">
                {t(HM['HM-005'], locale)}
              </LinkButton>
            </div>
            {startingPrice !== null && (
              <p className="tech-label mt-6">{t(HM['HM-006'], locale, { price: formatPrice(startingPrice) })}</p>
            )}
          </div>
          {showcases[0]?.configuration && (
            <ShelvingPreview
              config={showcases[0].configuration}
              color={showcases[0].color}
              presentation
              className="aspect-[4/3] w-full"
            />
          )}
        </Container>
      </section>

      {/* Advantages */}
      <section>
        <Container className="py-14">
          <h2 className="font-display text-3xl">{t(HM['HM-023'], locale)}</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ADVANTAGES.map((item) => (
              <div key={item.title.ru} className="border border-line p-4">
                <h3 className="font-medium">{t(item.title, locale)}</h3>
                <p className="mt-1 text-sm text-steel">{t(item.description, locale)}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Product categories */}
      <section className="bg-surface-muted">
        <Container className="py-14">
          <h2 className="font-display text-3xl">{t(HM['HM-024'], locale)}</h2>
          <div className="mt-6 flex flex-col gap-6">
            {showcases.map(({ model, configuration, color }) => (
              <article key={model.slug} className="border border-line bg-surface">
                <div className="grid grid-cols-1 lg:grid-cols-2">
                  <div className="flex flex-col gap-6 p-6 sm:p-8 lg:p-10">
                    <div>
                      <h3 className="font-display text-3xl sm:text-4xl">{pick(model.name, locale)}</h3>
                      <p className="mt-3 max-w-xl text-steel">{pick(model.description, locale)}</p>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-6 sm:grid-cols-4 lg:grid-cols-2">
                      {[
                        { label: t(HM['HM-025'], locale), value: dimensionRange(model.heights, locale) },
                        { label: t(HM['HM-026'], locale), value: dimensionRange(model.widths, locale) },
                        { label: t(HM['HM-027'], locale), value: dimensionRange(model.depths, locale) },
                        { label: t(HM['HM-028'], locale), value: t(HM['HM-029'], locale, { N: model.maxLoadKg }) },
                      ].map((spec) => (
                        <div key={spec.label}>
                          <dt className="tech-label">{spec.label}</dt>
                          <dd className="mono mt-1 text-base">{spec.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-steel">{t(HM['HM-031'], locale)}</p>

                    <div className="mt-auto flex flex-col gap-3 sm:flex-row" data-fab-avoid>
                      <LinkButton href={href(`/configurator?model=${model.slug}`)} size="lg">
                        {t(HM['HM-032'], locale)}
                      </LinkButton>
                      <LinkButton href={href(`/catalog/${model.slug}`)} variant="outline" size="lg">
                        {t(HM['HM-033'], locale)}
                      </LinkButton>
                    </div>
                  </div>

                  <div className="border-t border-line lg:border-l lg:border-t-0">
                    {configuration ? (
                      <ShelvingPreview config={configuration} color={color} className="aspect-[4/3] w-full" />
                    ) : (
                      <ProductImage src={model.image} alt={pick(model.name, locale)} className="aspect-[4/3] w-full object-cover" />
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section>
        <Container className="py-14">
          <h2 className="font-display text-3xl">{t(HM['HM-034'], locale)}</h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {HOW_IT_WORKS.map((item) => (
              <li key={item.step} className="border border-line p-4">
                <span className="mono text-2xl font-semibold text-blueprint">{String(item.step).padStart(2, '0')}</span>
                <h3 className="mt-2 font-medium">{t(item.title, locale)}</h3>
                <p className="mt-1 text-sm text-steel">{t(item.description, locale)}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Popular configurations */}
      <section className="bg-surface-muted">
        <Container className="py-14">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl">{t(HM['HM-045'], locale)}</h2>
            <Link href={href('/catalog')} className="tech-label text-blueprint hover:underline">
              {t(HM['HM-046'], locale)}
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
                  <div className="h-48 w-full overflow-hidden border-b border-line bg-surface">
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
        </Container>
      </section>

      {/* Use cases */}
      <section>
        <Container className="py-14">
          <h2 className="font-display text-3xl">{t(HM['HM-047'], locale)}</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {catalog.useCases.map((useCase) => (
              <div key={useCase.id} className="flex flex-col items-center gap-2 border border-line p-4 text-center">
                <span className="text-2xl" aria-hidden="true">{USE_CASE_ICONS[useCase.id] ?? '📦'}</span>
                <span className="text-sm font-medium">{pick(useCase, locale)}</span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Delivery and payment */}
      <section>
        <Container className="grid grid-cols-1 gap-6 py-14 lg:grid-cols-2">
          <div className="border border-line p-6">
            <h2 className="font-display text-2xl">{t(HM['HM-048'], locale)}</h2>
            <ul className="mt-4 space-y-2 text-sm text-steel">
              <li>• {t(HM['HM-049'], locale)}</li>
              <li>• {t(HM['HM-050'], locale)}</li>
              <li>• {t(HM['HM-051'], locale)}</li>
              <li>• {t(HM['HM-052'], locale)}</li>
            </ul>
            <LinkButton href={href('/delivery')} variant="outline" className="mt-4">
              {t(HM['HM-053'], locale)}
            </LinkButton>
          </div>
          <div className="border border-line p-6">
            <h2 className="font-display text-2xl">{t(HM['HM-054'], locale)}</h2>
            <ul className="mt-4 space-y-2 text-sm text-steel">
              <li>• {t(HM['HM-055'], locale)}</li>
              <li>• {t(HM['HM-056'], locale)}</li>
              <li>• {t(HM['HM-057'], locale)}</li>
              <li>• {t(HM['HM-058'], locale)}</li>
            </ul>
            <LinkButton href={href('/payment')} variant="outline" className="mt-4">
              {t(HM['HM-059'], locale)}
            </LinkButton>
          </div>
        </Container>
      </section>

      {/* Contacts */}
      <section id="contacts" className="bg-surface-muted">
        <Container className="grid grid-cols-1 gap-8 py-14 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl">{t(HM['HM-060'], locale)}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="tech-label">{t(HM['HM-061'], locale)}</dt>
                <dd className="mono text-base">
                  <a href={whatsAppContactUrl(locale)} target="_blank" rel="noopener noreferrer" className="text-success hover:underline">
                    {site.whatsappDisplay}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="tech-label">{t(HM['HM-062'], locale)}</dt>
                <dd>
                  <a href={`mailto:${site.email}`}>{site.email}</a>
                </dd>
              </div>
              <div>
                <dt className="tech-label">{t(HM['HM-063'], locale)}</dt>
                <dd>{copy.address}</dd>
              </div>
              <div>
                <dt className="tech-label">{t(HM['HM-064'], locale)}</dt>
                <dd>{copy.workingHours}</dd>
              </div>
            </dl>
          </div>

          <div className="border border-line bg-surface p-6">
            <h3 className="font-display text-xl">{t(HM['HM-066'], locale)}</h3>
            <p className="mt-1 text-sm text-steel">{t(HM['HM-067'], locale)}</p>
            <div className="mt-4">
              <ContactForm />
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
