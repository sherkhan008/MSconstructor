import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { findColor, getCatalog } from '@/lib/data/repository';
import { isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { absoluteUrl, buildMetadata, breadcrumbJsonLd, faqJsonLd, jsonLdScriptProps, productJsonLd } from '@/lib/seo';
import { formatKg, formatPrice } from '@/lib/money';
import { whatsAppProductUrl } from '@/lib/whatsapp';
import { pick, t, type Entry } from '@/lib/i18n/format';
import { isLocale, localizePath, type Locale } from '@/lib/i18n/locales';
import { modelSeo } from '@/lib/i18n/catalog-seo';
import { resolveLocale } from '@/lib/i18n/page';
import { CT, FQ, G, PR, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';
import { ProductImage } from '@/components/ui/ProductImage';
import { CatalogRackPreview } from '@/components/catalog/CatalogRackPreview';
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

export default async function ModelPage({ params }: { params: Params }) {
  const { model: slug } = await params;
  const locale = await resolveLocale(params);
  const catalog = await getCatalog();
  const model = catalog.models.find((m) => m.slug === slug);
  if (!model || !isModelSlugPubliclyVisible(model.slug)) notFound();

  const modelName = pick(model.name, locale);
  const modelDescription = pick(model.description, locale);
  const mm = t(G['G-008'], locale);
  const faq = FAQ.map((item) => ({ question: t(item.question, locale), answer: t(item.answer, locale) }));

  const products = catalog.products.filter((p) => p.modelSlug === model.slug && p.published);
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

  const productUrl = absoluteUrl(localizePath(`/catalog/${model.slug}`, locale));

  return (
    <Container className="py-10">
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {cards[0] && <CatalogRackPreview config={cards[0].configuration} color={findColor(catalog, cards[0].product.color)} modelName={modelName} locale={locale} className="aspect-[4/3] w-full border border-line" />}
        </div>

        <div>
          <h1 className="font-display text-4xl">{modelName}</h1>
          <p className="mt-3 text-steel">{modelDescription}</p>

          {cheapestPrice !== null && (
            <p className="mono mt-4 text-2xl font-semibold">
              {t(PR['PR-005'], locale, { price: formatPrice(cheapestPrice) })}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3" data-fab-avoid>
            <LinkButton href={localizePath(`/configurator?model=${model.slug}`, locale)} size="lg">
              {t(PR['PR-006'], locale)}
            </LinkButton>
            <LinkButton
              href={whatsAppProductUrl(modelName, productUrl, locale)}
              target="_blank"
              rel="noopener noreferrer"
              variant="whatsapp"
              size="lg"
            >
              {t(PR['PR-007'], locale)}
            </LinkButton>
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-6 text-sm">
            <Spec label={t(PR['PR-008'], locale)} value={t(PR['PR-009'], locale, { N: model.maxLoadKg })} />
            <Spec label={t(PR['PR-010'], locale)} value={`${model.heights.join(', ')} ${mm}`} />
            <Spec label={t(PR['PR-011'], locale)} value={`${model.widths.join(', ')} ${mm}`} />
            <Spec label={t(PR['PR-012'], locale)} value={`${model.depths.join(', ')} ${mm}`} />
            <Spec label={t(PR['PR-013'], locale)} value={t(PR['PR-014'], locale, { min: model.minShelves, max: model.maxShelves })} />
            <Spec
              label={t(PR['PR-015'], locale)}
              value={model.shelfTypes.map((type) => (SHELF_TYPE_LABEL[type] ? t(SHELF_TYPE_LABEL[type], locale) : type)).join(', ')}
            />
          </dl>
        </div>
      </div>

      {cards.length > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-2xl">{t(PR['PR-021'], locale, { model: modelName })}</h2>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ product, configuration, priceTotal }) => (
              <ProductCard key={product.id} product={product} configuration={configuration} modelName={modelName} priceTotal={priceTotal} visual={<CatalogRackPreview config={configuration} color={findColor(catalog, product.color)} modelName={modelName} locale={locale} className="h-48 w-full border-b border-line" />} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-14 grid grid-cols-1 gap-6 border-t border-line pt-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl">{t(PR['PR-022'], locale)}</h2>
          <p className="mt-2 text-sm text-steel">{t(PR['PR-023'], locale)}</p>
        </div>
        <div>
          <h2 className="font-display text-2xl">{t(PR['PR-024'], locale)}</h2>
          <p className="mt-2 text-sm text-steel">{t(PR['PR-025'], locale)}</p>
        </div>
      </section>

      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-2xl">{t(FQ['FQ-001'], locale)}</h2>
        <dl className="mt-4 space-y-4">
          {faq.map((item) => (
            <div key={item.question}>
              <dt className="font-medium">{item.question}</dt>
              <dd className="mt-1 text-sm text-steel">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {relatedModels.length > 0 && (
        <section className="mt-14 border-t border-line pt-8">
          <h2 className="font-display text-2xl">{t(PR['PR-026'], locale)}</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {relatedModels.map((related) => (
              <Link
                key={related.slug}
                href={localizePath(`/catalog/${related.slug}`, locale)}
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
        </section>
      )}
    </Container>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="tech-label">{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}
