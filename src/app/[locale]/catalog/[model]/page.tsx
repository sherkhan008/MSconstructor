import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { findColor, getCatalog } from '@/lib/data/repository';
import { isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { calculatePrice } from '@/lib/pricing';
import { getAllowedDepthsForWidth, getMaxShelvesForHeight } from '@/lib/pricing/ms-standard-compatibility';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { absoluteUrl, buildMetadata, breadcrumbJsonLd, faqJsonLd, jsonLdScriptProps, productJsonLd } from '@/lib/seo';
import { formatKg, formatPrice } from '@/lib/money';
import { shelvesLabel } from '@/lib/plural';
import { whatsAppProductUrl } from '@/lib/whatsapp';
import { pick, t, type Entry } from '@/lib/i18n/format';
import { isLocale, localizePath, type Locale } from '@/lib/i18n/locales';
import { modelSeo } from '@/lib/i18n/catalog-seo';
import { resolveLocale } from '@/lib/i18n/page';
import { CT, FQ, G, H, HM, PR, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';
import { ArrowIcon, CheckIcon } from '@/components/ui/Icons';
import { ProductImage } from '@/components/ui/ProductImage';
import { WhatsAppIcon } from '@/components/layout/Header';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { CatalogRackPreview } from '@/components/catalog/CatalogRackPreview';
import { ModelFacts } from '@/components/catalog/ModelFacts';
import { ProductCard } from '@/components/catalog/ProductCard';

// Rendered per request from the runtime catalog — no generateStaticParams, so
// neither the image build nor a newly added model depends on a database
// snapshot taken at build time. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; model: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale: rawLocale, model: slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'kk';
  const catalog = await getCatalog();
  const model = catalog.models.find((m) => m.slug === slug);
  if (!model || !isModelSlugPubliclyVisible(model.slug)) {
    return buildMetadata({ title: t(SE['SE-040'], locale), description: '', path: `/catalog/${slug}`, locale, noIndex: true });
  }

  const seo = modelSeo(model, locale);
  return buildMetadata({ title: seo.title, description: seo.description, path: `/catalog/${model.slug}`, locale, image: model.image });
}

const SHELF_TYPE_LABEL: Record<string, Entry> = {
  STANDARD: PR['PR-016'],
  REINFORCED: PR['PR-017'],
  EXTRA_REINFORCED: PR['PR-018'],
  PERFORATED: PR['PR-019'],
  GALVANIZED: PR['PR-020'],
};

/** Shown on the page and as FAQPage structured data, in the page locale. */
const FAQ = [
  { question: FQ['FQ-002'], answer: FQ['FQ-003'] },
  { question: FQ['FQ-004'], answer: FQ['FQ-005'] },
  { question: FQ['FQ-010'], answer: FQ['FQ-011'] },
  { question: FQ['FQ-006'], answer: FQ['FQ-007'] },
  { question: FQ['FQ-008'], answer: FQ['FQ-009'] },
];

/** What the construction gives the customer — the same owner-approved
 * statements the homepage lists, limited to the rack itself. */
const FEATURES = [
  { title: HM['HM-007'], description: HM['HM-008'] },
  { title: HM['HM-009'], description: HM['HM-010'] },
  { title: HM['HM-011'], description: HM['HM-012'] },
  { title: HM['HM-013'], description: HM['HM-014'] },
];

const PAYMENT_METHODS = [HM['HM-055'], HM['HM-056'], HM['HM-057'], HM['HM-058']];

export default async function ModelPage({ params }: { params: Params }) {
  const { model: slug } = await params;
  const locale = await resolveLocale(params);
  const href = (path: string) => localizePath(path, locale);
  const catalog = await getCatalog();
  const model = catalog.models.find((m) => m.slug === slug);
  if (!model || !isModelSlugPubliclyVisible(model.slug)) notFound();

  const modelName = pick(model.name, locale);
  const modelDescription = pick(model.description, locale);
  const mm = t(G['G-008'], locale);
  const faq = FAQ.map((item) => ({ question: t(item.question, locale), answer: t(item.answer, locale) }));

  const products = catalog.products
    .filter((p) => p.modelSlug === model.slug && p.published)
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.popularity - a.popularity);
  const cards = products.map((product) => {
    const configuration = catalogProductToConfiguration(product);
    const result = calculatePrice(configuration, catalog);
    return { product, configuration, priceTotal: result.ok ? result.breakdown.total : null };
  });

  const relatedModels = catalog.models.filter((m) => m.slug !== model.slug && isModelSlugPubliclyVisible(m.slug));
  const cheapestPrice = cards.reduce<number | null>((min, c) => {
    if (c.priceTotal === null) return min;
    return min === null ? c.priceTotal : Math.min(min, c.priceTotal);
  }, null);

  // The hero drawing is the model's most popular ready rack, drawn by the
  // configurator's own preview. A fresh configuration instance, so it shares
  // no object with the ProductCard of the same rack further down.
  const heroProduct = products[0];
  const heroConfiguration = heroProduct ? catalogProductToConfiguration(heroProduct) : null;

  const useCases = model.useCases
    .map((id) => catalog.useCases.find((useCase) => useCase.id === id))
    .filter((useCase): useCase is { id: string; ru: string; kk: string } => useCase !== undefined);

  // MS Standard's real cross-dimensional rules come from the single
  // authoritative matrix (src/lib/pricing/ms-standard-compatibility.ts):
  // which depths each section width supports, and how many shelves each
  // height takes. Any other model has no such matrix — its flat supported
  // lists are shown instead.
  const isMsStandard = model.slug === 'ms-standard';
  const widthDepths = isMsStandard ? model.widths.map((width) => ({ width, depths: getAllowedDepthsForWidth(width) })) : [];
  const heightShelves = isMsStandard
    ? model.heights.map((height) => ({ height, max: getMaxShelvesForHeight(height) ?? model.maxShelves }))
    : [];
  const shelfTypes = model.shelfTypes.map((type) => (SHELF_TYPE_LABEL[type] ? t(SHELF_TYPE_LABEL[type], locale) : type)).join(', ');

  const productUrl = absoluteUrl(localizePath(`/catalog/${model.slug}`, locale));
  const configuratorHref = href(`/configurator?model=${model.slug}`);

  return (
    <>
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd(
            [
              { name: t(CT['CT-003'], locale), path: '/' },
              { name: t(CT['CT-004'], locale), path: '/catalog' },
              { name: modelName, path: `/catalog/${model.slug}` },
            ],
            locale,
          ),
        )}
        type="application/ld+json"
      />
      {cheapestPrice !== null && (
        <script
          {...jsonLdScriptProps(
            productJsonLd({
              locale,
              name: modelName,
              description: modelDescription,
              image: model.image,
              sku: model.slug.toUpperCase(),
              path: `/catalog/${model.slug}`,
              price: cheapestPrice,
            }),
          )}
          type="application/ld+json"
        />
      )}
      <script {...jsonLdScriptProps(faqJsonLd(faq))} type="application/ld+json" />

      {/* 1. Hero — what the model is, what it costs, and the way into the configurator. */}
      <section aria-labelledby="model-title" className="border-b border-line bg-surface">
        <Container className="pb-10 pt-3 sm:pb-14 sm:pt-5 lg:pb-16">
          <ol className="flex flex-wrap items-center gap-x-2 text-sm text-steel">
            <li className="flex items-center gap-2">
              <Link href={href('/')} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
                {t(CT['CT-003'], locale)}
              </Link>
              <span aria-hidden="true">/</span>
            </li>
            <li className="flex items-center gap-2">
              <Link href={href('/catalog')} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
                {t(CT['CT-004'], locale)}
              </Link>
              <span aria-hidden="true">/</span>
            </li>
            <li aria-current="page" className="font-medium text-foreground">
              {modelName}
            </li>
          </ol>

          {/* Mobile reads name → rack → price and action → description → facts;
              from lg the text stacks in the left column beside the drawing. */}
          <div className="mt-3 grid grid-cols-1 gap-6 sm:mt-5 lg:grid-cols-12 lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-12 lg:gap-y-0">
            <div className="lg:col-span-6 lg:row-start-1">
              <p className="text-sm font-medium text-steel sm:text-base">{pick(model.shortDescription, locale)}</p>
              <h1 id="model-title" className="mt-2 font-display text-[2.75rem] leading-none sm:text-6xl lg:text-[4.25rem]">
                {modelName}
              </h1>
            </div>

            {heroConfiguration && heroProduct && (
              <figure className="border border-line bg-surface lg:col-span-6 lg:col-start-7 lg:row-span-4 lg:row-start-1 lg:self-start">
                <ShelvingPreview
                  config={heroConfiguration}
                  color={findColor(catalog, heroProduct.color)}
                  presentation
                  className="aspect-[4/3] w-full !border-0"
                />
                <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-3 sm:px-5">
                  <span className="font-display text-lg">{modelName}</span>
                  <span className="mono text-sm text-steel">
                    {heroProduct.height}×{heroProduct.width}×{heroProduct.depth} {mm} · {shelvesLabel(heroProduct.shelves, locale)}
                  </span>
                </figcaption>
              </figure>
            )}

            <div className="flex flex-col gap-4 border-y border-line py-5 lg:col-span-6 lg:row-start-3">
              {cheapestPrice !== null && (
                <p className="mono text-[1.375rem] font-semibold leading-tight min-[390px]:text-[1.75rem] sm:text-3xl">
                  {t(PR['PR-005'], locale, { price: formatPrice(cheapestPrice) })}
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-fab-avoid>
                <LinkButton href={configuratorHref} variant="accent" className="min-h-12 whitespace-normal px-5 text-center">
                  {t(PR['PR-006'], locale)}
                  <ArrowIcon />
                </LinkButton>
                <LinkButton
                  href={whatsAppProductUrl(modelName, productUrl, locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline"
                  className="min-h-12 whitespace-normal px-5 text-center"
                >
                  <span className="text-success">
                    <WhatsAppIcon />
                  </span>
                  {t(PR['PR-007'], locale)}
                </LinkButton>
              </div>
            </div>

            <p className="max-w-xl text-base leading-relaxed text-steel sm:text-lg lg:col-span-6 lg:row-start-2 lg:mb-7 lg:mt-5">{modelDescription}</p>

            <div className="lg:col-span-6 lg:row-start-4 lg:mt-6">
              <ModelFacts heights={model.heights} widths={model.widths} depths={model.depths} maxLoadKg={model.maxLoadKg} locale={locale} />
              <p className="mt-3 text-sm text-steel">{t(HM['HM-031'], locale)}</p>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Construction and where the rack is used. */}
      <section aria-labelledby="model-features-title" className="bg-background">
        <Container className="py-12 sm:py-16">
          <h2 id="model-features-title" className="font-display text-3xl sm:text-4xl">
            {t(HM['HM-023'], locale)}
          </h2>
          <ul className="mt-8 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((item) => (
              <li key={item.title.ru} className="bg-surface p-5 sm:p-6">
                <span className="block h-[3px] w-8 bg-accent" aria-hidden="true" />
                <h3 className="mt-4 text-xl">{t(item.title, locale)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-steel">{t(item.description, locale)}</p>
              </li>
            ))}
          </ul>

          {useCases.length > 0 && (
            <div className="mt-10">
              <h3 className="text-xl sm:text-2xl">{t(HM['HM-047'], locale)}</h3>
              <ul className="mt-4 flex flex-wrap gap-2">
                {useCases.map((useCase) => (
                  <li key={useCase.id} className="border border-line bg-surface px-4 py-2.5 text-sm font-medium">
                    {pick(useCase, locale)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Container>
      </section>

      {/* 3. Supported sizes, straight from the model's compatibility data. */}
      <section aria-labelledby="model-sizes-title" className="border-y border-line bg-surface">
        <Container className="py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-4">
              <h2 id="model-sizes-title" className="font-display text-3xl sm:text-4xl">
                {t(HM['HM-015'], locale)}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-steel">{t(HM['HM-016'], locale)}</p>
              <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-steel">{t(PR['PR-008'], locale)}</dt>
                  <dd className="mono text-right font-semibold">{t(PR['PR-009'], locale, { N: model.maxLoadKg })}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-steel">{t(PR['PR-013'], locale)}</dt>
                  <dd className="mono text-right font-semibold">{t(PR['PR-014'], locale, { min: model.minShelves, max: model.maxShelves })}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-steel">{t(PR['PR-015'], locale)}</dt>
                  <dd className="text-right font-semibold">{shelfTypes}</dd>
                </div>
              </dl>
              <div className="mt-6 hidden lg:block" data-fab-avoid>
                <LinkButton href={configuratorHref} variant="primary" className="min-h-11 whitespace-normal text-center">
                  {t(PR['PR-006'], locale)}
                </LinkButton>
              </div>
            </div>

            {isMsStandard ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:col-span-8">
                <SizeTable
                  caption={`${t(HM['HM-026'], locale)}, ${mm}`}
                  valueHeader={t(PR['PR-012'], locale)}
                  rows={widthDepths.map(({ width, depths }) => ({ key: width, label: String(width), values: depths.map(String) }))}
                />
                <SizeTable
                  caption={`${t(HM['HM-025'], locale)}, ${mm}`}
                  valueHeader={t(PR['PR-013'], locale)}
                  rows={heightShelves.map(({ height, max }) => ({ key: height, label: String(height), values: [`${model.minShelves}–${max}`] }))}
                />
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-px self-start border border-line bg-line sm:grid-cols-2 lg:col-span-8">
                <Spec label={t(PR['PR-010'], locale)} value={`${model.heights.join(', ')} ${mm}`} />
                <Spec label={t(PR['PR-011'], locale)} value={`${model.widths.join(', ')} ${mm}`} />
                <Spec label={t(PR['PR-012'], locale)} value={`${model.depths.join(', ')} ${mm}`} />
              </dl>
            )}
          </div>
        </Container>
      </section>

      {/* 4. Ready configurations with their live prices. */}
      {cards.length > 0 && (
        <section aria-labelledby="model-ready-title" className="bg-background">
          <Container className="py-12 sm:py-16">
            <h2 id="model-ready-title" className="font-display text-3xl sm:text-4xl">
              {t(PR['PR-021'], locale, { model: modelName })}
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
              {cards.map(({ product, configuration, priceTotal }) => (
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
          </Container>
        </section>
      )}

      {/* 5. Assembly, delivery and payment. */}
      <section className="border-t border-line bg-surface">
        <Container className="py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-px border border-line bg-line lg:grid-cols-3">
            <div className="bg-surface p-6 sm:p-8">
              <h2 className="font-display text-2xl sm:text-3xl">{t(PR['PR-022'], locale)}</h2>
              <p className="mt-3 text-base leading-relaxed text-steel">{t(PR['PR-023'], locale)}</p>
            </div>
            <div className="flex flex-col items-start bg-surface p-6 sm:p-8">
              <h2 className="font-display text-2xl sm:text-3xl">{t(PR['PR-024'], locale)}</h2>
              <p className="mt-3 text-base leading-relaxed text-steel">{t(PR['PR-025'], locale)}</p>
              <Link href={href('/delivery')} className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-4 text-sm font-medium underline-offset-4 hover:underline">
                {t(HM['HM-053'], locale)} <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="flex flex-col items-start bg-surface p-6 sm:p-8">
              <h2 className="font-display text-2xl sm:text-3xl">{t(HM['HM-054'], locale)}</h2>
              <ul className="mt-3 space-y-2 text-base text-steel">
                {PAYMENT_METHODS.map((entry) => (
                  <li key={entry.ru} className="flex gap-3">
                    <CheckIcon />
                    {t(entry, locale)}
                  </li>
                ))}
              </ul>
              <Link href={href('/payment')} className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-4 text-sm font-medium underline-offset-4 hover:underline">
                {t(HM['HM-059'], locale)} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* 6. Questions before buying. */}
      <section aria-labelledby="model-faq-title" className="border-t border-line bg-background">
        <Container className="py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-12">
            <h2 id="model-faq-title" className="font-display text-3xl sm:text-4xl lg:col-span-4">
              {t(FQ['FQ-001'], locale)}
            </h2>
            <div className="divide-y divide-line border-y border-line lg:col-span-8">
              {faq.map((item) => (
                <details key={item.question} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-base font-medium [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <span aria-hidden="true" className="mono shrink-0 text-xl leading-none text-steel transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="pb-5 pr-8 text-base leading-relaxed text-steel">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {relatedModels.length > 0 && (
        <section aria-labelledby="model-related-title" className="border-t border-line bg-surface">
          <Container className="py-12 sm:py-16">
            <h2 id="model-related-title" className="font-display text-3xl">
              {t(PR['PR-026'], locale)}
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {relatedModels.map((related) => (
                <Link
                  key={related.slug}
                  href={href(`/catalog/${related.slug}`)}
                  className="flex items-center gap-4 border border-line p-4 transition-colors hover:border-foreground"
                >
                  <ProductImage src={related.image} alt={pick(related.name, locale)} className="h-16 w-16 shrink-0 object-cover" />
                  <div>
                    <h3 className="font-medium">{pick(related.name, locale)}</h3>
                    <p className="text-xs text-steel">{t(PR['PR-027'], locale, { weight: formatKg(related.maxLoadKg) })}</p>
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* 7. Final configurator CTA. */}
      <section aria-labelledby="model-final-title" className="bg-surface pb-16 pt-4 sm:pb-20">
        <Container>
          <div className="border-t-4 border-accent bg-surface-dark px-6 py-10 text-background sm:px-10 sm:py-12 lg:px-14 [&_:focus-visible]:outline-accent">
            <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="eyebrow !text-steel-soft">{t(H['H-003'], locale)}</p>
                <h2 id="model-final-title" className="mt-4 font-display text-3xl sm:text-4xl">
                  {t(HM['HM-001'], locale)}
                </h2>
                {cheapestPrice !== null && (
                  <p className="mt-3 text-base text-steel-soft sm:text-lg">
                    {modelName} · {t(PR['PR-005'], locale, { price: formatPrice(cheapestPrice) })}
                  </p>
                )}
              </div>
              <div className="lg:shrink-0" data-fab-avoid>
                <LinkButton href={configuratorHref} variant="accent" size="lg" className="min-h-14 w-full whitespace-normal text-center sm:w-auto">
                  {t(PR['PR-006'], locale)}
                  <ArrowIcon />
                </LinkButton>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

/** One authoritative size rule as a two-column list: a dimension on the left,
 * what it allows on the right. A real table for assistive tech; on narrow
 * screens it stays two short columns rather than a squeezed wide grid. */
function SizeTable({
  caption,
  valueHeader,
  rows,
}: {
  caption: string;
  valueHeader: string;
  rows: { key: number; label: string; values: string[] }[];
}) {
  return (
    <table className="w-full self-start border border-line text-sm">
      <thead className="bg-background">
        <tr className="border-b border-line">
          <th scope="col" className="w-[42%] px-4 py-3 text-left font-medium text-steel">
            {caption}
          </th>
          <th scope="col" className="px-4 py-3 text-left font-medium text-steel">
            {valueHeader}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className="mono px-4 py-2.5 text-left text-base font-semibold">
              {row.label}
            </th>
            <td className="px-4 py-2.5">
              <ul className="flex flex-wrap gap-1.5">
                {row.values.map((value) => (
                  <li key={value} className="mono border border-line px-2 py-0.5 text-[0.8125rem]">
                    {value}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-4 sm:p-5">
      <dt className="text-sm text-steel">{label}</dt>
      <dd className="mono mt-1.5 font-semibold">{value}</dd>
    </div>
  );
}
