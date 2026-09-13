import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { buildMetadata, breadcrumbJsonLd, faqJsonLd, jsonLdScriptProps, productJsonLd } from '@/lib/seo';
import { formatKg, formatPrice } from '@/lib/money';
import { whatsAppProductUrl } from '@/lib/whatsapp';
import { appUrl } from '@/lib/env';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';
import { ProductImage } from '@/components/ui/ProductImage';
import { ProductCard } from '@/components/catalog/ProductCard';

// Rendered per request from the runtime catalog — no generateStaticParams, so
// neither the image build nor a newly added model depends on a database
// snapshot taken at build time. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ model: string }> }): Promise<Metadata> {
  const { model: slug } = await params;
  const catalog = await getCatalog();
  const model = catalog.models.find((m) => m.slug === slug);
  if (!model) return buildMetadata({ title: 'Модель не найдена', description: '', path: `/catalog/${slug}`, noIndex: true });

  return buildMetadata({ title: model.seo.title, description: model.seo.description, path: `/catalog/${model.slug}`, image: model.image });
}

const SHELF_TYPE_LABEL: Record<string, string> = {
  STANDARD: 'Стандартная',
  REINFORCED: 'Усиленная',
  EXTRA_REINFORCED: 'Особо усиленная',
  PERFORATED: 'Перфорированная',
  GALVANIZED: 'Оцинкованная',
};

const FAQ = [
  { question: 'Нужна ли сварка для сборки?', answer: 'Нет, все стеллажи MS собираются на болтовом соединении без сварки.' },
  { question: 'Можно ли заказать нестандартный размер?', answer: 'Да, свяжитесь с менеджером через WhatsApp для индивидуального расчёта.' },
  { question: 'Какой срок изготовления?', answer: 'Обычно от 2 до 7 дней в зависимости от комплектации и загрузки производства.' },
  { question: 'Предоставляете ли вы документы для бухгалтерии?', answer: 'Да, работаем с НДС и предоставляем полный пакет закрывающих документов.' },
];

export default async function ModelPage({ params }: { params: Promise<{ model: string }> }) {
  const { model: slug } = await params;
  const catalog = await getCatalog();
  const model = catalog.models.find((m) => m.slug === slug);
  if (!model) notFound();

  const products = catalog.products.filter((p) => p.modelSlug === model.slug && p.published);
  const cards = products.map((product) => {
    const configuration = catalogProductToConfiguration(product);
    const result = calculatePrice(configuration, catalog);
    return { product, configuration, priceTotal: result.ok ? result.breakdown.total : null };
  });

  const relatedModels = catalog.models.filter((m) => m.slug !== model.slug);
  const cheapestPrice = cards.reduce<number | null>((min, c) => {
    if (c.priceTotal === null) return min;
    return min === null ? c.priceTotal : Math.min(min, c.priceTotal);
  }, null);

  const productUrl = `${appUrl}/catalog/${model.slug}`;

  return (
    <Container className="py-10">
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: 'Главная', path: '/' },
            { name: 'Каталог', path: '/catalog' },
            { name: model.name.ru, path: `/catalog/${model.slug}` },
          ]),
        )}
        type="application/ld+json"
      />
      {cheapestPrice !== null && (
        <script
          {...jsonLdScriptProps(
            productJsonLd({
              name: model.name.ru,
              description: model.description.ru,
              image: model.image,
              sku: model.slug.toUpperCase(),
              path: `/catalog/${model.slug}`,
              price: cheapestPrice,
            }),
          )}
          type="application/ld+json"
        />
      )}
      <script {...jsonLdScriptProps(faqJsonLd(FAQ))} type="application/ld+json" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {model.gallery.map((src) => (
            <ProductImage key={src} src={src} alt={model.name.ru} className="aspect-[4/3] w-full border border-line object-cover" />
          ))}
        </div>

        <div>
          <h1 className="font-display text-4xl">{model.name.ru}</h1>
          <p className="mt-3 text-steel">{model.description.ru}</p>

          {cheapestPrice !== null && (
            <p className="mono mt-4 text-2xl font-semibold">
              от {formatPrice(cheapestPrice)}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href={`/configurator?model=${model.slug}`} size="lg">
              Настроить в конфигураторе
            </LinkButton>
            <LinkButton
              href={whatsAppProductUrl(model.name.ru, productUrl)}
              target="_blank"
              rel="noopener noreferrer"
              variant="whatsapp"
              size="lg"
            >
              Спросить в WhatsApp
            </LinkButton>
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-6 text-sm">
            <Spec label="Максимальная нагрузка" value={`${model.maxLoadKg} кг/полка`} />
            <Spec label="Высоты" value={model.heights.map((h) => `${h}`).join(', ') + ' мм'} />
            <Spec label="Ширины" value={model.widths.map((w) => `${w}`).join(', ') + ' мм'} />
            <Spec label="Глубины" value={model.depths.map((d) => `${d}`).join(', ') + ' мм'} />
            <Spec label="Полки" value={`от ${model.minShelves} до ${model.maxShelves} шт.`} />
            <Spec label="Типы полок" value={model.shelfTypes.map((t) => SHELF_TYPE_LABEL[t] ?? t).join(', ')} />
          </dl>
        </div>
      </div>

      {cards.length > 0 && (
        <section className="mt-14">
          <h2 className="font-display text-2xl">Готовые конфигурации {model.name.ru}</h2>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ product, configuration, priceTotal }) => (
              <ProductCard key={product.id} product={product} configuration={configuration} modelName={model.name.ru} priceTotal={priceTotal} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-14 grid grid-cols-1 gap-6 border-t border-line pt-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl">Сборка и монтаж</h2>
          <p className="mt-2 text-sm text-steel">
            Стеллаж поставляется в разобранном виде и собирается на болтовом соединении без сварки. Возможна
            самостоятельная сборка по инструкции или профессиональный монтаж бригадой на вашем объекте.
          </p>
        </div>
        <div>
          <h2 className="font-display text-2xl">Доставка</h2>
          <p className="mt-2 text-sm text-steel">
            Самовывоз со склада в Алматы, доставка по городу на следующий день или транспортной компанией в любой
            регион Казахстана. Точная стоимость доставки уточняется менеджером.
          </p>
        </div>
      </section>

      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-2xl">Частые вопросы</h2>
        <dl className="mt-4 space-y-4">
          {FAQ.map((item) => (
            <div key={item.question}>
              <dt className="font-medium">{item.question}</dt>
              <dd className="mt-1 text-sm text-steel">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {relatedModels.length > 0 && (
        <section className="mt-14 border-t border-line pt-8">
          <h2 className="font-display text-2xl">Другие модели</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {relatedModels.map((related) => (
              <Link
                key={related.slug}
                href={`/catalog/${related.slug}`}
                className="flex items-center gap-4 border border-line p-4 transition-colors hover:border-foreground"
              >
                <ProductImage src={related.image} alt={related.name.ru} className="h-16 w-16 shrink-0 object-cover" />
                <div>
                  <h3 className="font-medium">{related.name.ru}</h3>
                  <p className="text-xs text-steel">{formatKg(related.maxLoadKg)} максимум на полку</p>
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
