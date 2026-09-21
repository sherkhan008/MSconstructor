import type { Metadata } from 'next';
import Link from 'next/link';
import { findColor, getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { formatPrice } from '@/lib/money';
import { buildMetadata, jsonLdScriptProps, organizationJsonLd } from '@/lib/seo';
import { site } from '@/lib/config/site';
import { filterPubliclyVisibleModels, filterPubliclyVisibleProducts } from '@/lib/config/launch-visibility';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { ProductImage } from '@/components/ui/ProductImage';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ContactForm } from '@/components/contact/ContactForm';

export const metadata: Metadata = buildMetadata({
  title: `${site.name} — модульные металлические стеллажи | Казахстан`,
  description: site.shortDescription,
  path: '/',
});

const ADVANTAGES = [
  { title: 'До 150 кг на полку', description: 'MS Стандарт для склада, архива и офиса' },
  { title: 'Модульная конструкция', description: 'Наращивайте секции и полки по мере роста склада' },
  { title: 'Регулируемый шаг полок', description: 'Настройте высоту под конкретные грузы без сверления' },
  { title: 'Быстрая сборка', description: 'Болтовое соединение — без сварки, силами одной бригады' },
  { title: 'Размеры на выбор', description: 'Стандартные высоты, ширины и глубины — подберите сочетание в конфигураторе' },
  { title: 'Доставка по Казахстану', description: 'Самовывоз, доставка по городу и в регионы' },
  { title: 'Физическим и юридическим лицам', description: 'Работаем с частными клиентами, компаниями и госорганизациями' },
  { title: 'Документы с НДС', description: 'Полный пакет закрывающих документов для бухгалтерии' },
];

const HOW_IT_WORKS = [
  { step: 1, title: 'Выберите модель', description: 'MS Стандарт для ваших задач' },
  { step: 2, title: 'Задайте размеры', description: 'Высота, ширина, глубина и число полок' },
  { step: 3, title: 'Добавьте аксессуары', description: 'Стенки, разделители, контейнеры и сборку' },
  { step: 4, title: 'Получите цену', description: 'Расчёт происходит мгновенно на сервере' },
  { step: 5, title: 'Оформите заказ', description: 'Онлайн, по телефону или в WhatsApp' },
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
function dimensionRange(values: number[]): string {
  return `${Math.min(...values)}–${Math.max(...values)} мм`;
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

export default async function HomePage() {
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
      modelName: model?.name.ru ?? product.modelSlug,
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
      <script {...jsonLdScriptProps(organizationJsonLd())} type="application/ld+json" />

      {/* Hero */}
      <section className="blueprint-grid hairline border-t-0 border-x-0">
        <Container className="grid grid-cols-1 items-center gap-8 py-14 lg:grid-cols-2 lg:py-20">
          <div>
            <Badge tone="blueprint">Конфигуратор с расчётом цены онлайн</Badge>
            <h1 className="mt-4 font-display text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
              Соберите стеллаж MS и получите цену мгновенно
            </h1>
            <p className="mt-4 max-w-lg text-base text-steel">
              Модульные металлические стеллажи для склада, архива, гаража и офиса. Задайте размеры, нагрузку и
              комплектацию — итоговая стоимость рассчитывается сразу.
            </p>
            <div className="mt-6 flex flex-wrap gap-3" data-fab-avoid>
              <LinkButton href="/configurator" size="lg">
                Открыть конфигуратор
              </LinkButton>
              <LinkButton href="/catalog" variant="outline" size="lg">
                Смотреть каталог
              </LinkButton>
            </div>
            {startingPrice !== null && (
              <p className="tech-label mt-6">Стеллажи от {formatPrice(startingPrice)} · нагрузка до 150 кг на полку</p>
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
          <h2 className="font-display text-3xl">Почему выбирают MS</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ADVANTAGES.map((item) => (
              <div key={item.title} className="border border-line p-4">
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 text-sm text-steel">{item.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Product categories */}
      <section className="bg-surface-muted">
        <Container className="py-14">
          <h2 className="font-display text-3xl">Категории стеллажей</h2>
          <div className="mt-6 flex flex-col gap-6">
            {showcases.map(({ model, configuration, color }) => (
              <article key={model.slug} className="border border-line bg-surface">
                <div className="grid grid-cols-1 lg:grid-cols-2">
                  <div className="flex flex-col gap-6 p-6 sm:p-8 lg:p-10">
                    <div>
                      <h3 className="font-display text-3xl sm:text-4xl">{model.name.ru}</h3>
                      <p className="mt-3 max-w-xl text-steel">{model.description.ru}</p>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-6 sm:grid-cols-4 lg:grid-cols-2">
                      {[
                        { label: 'Высота', value: dimensionRange(model.heights) },
                        { label: 'Ширина', value: dimensionRange(model.widths) },
                        { label: 'Глубина', value: dimensionRange(model.depths) },
                        { label: 'Нагрузка', value: `до ${model.maxLoadKg} кг/полку` },
                      ].map((spec) => (
                        <div key={spec.label}>
                          <dt className="tech-label">{spec.label}</dt>
                          <dd className="mono mt-1 text-base">{spec.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-steel">
                      Доступные сочетания размеров проверяются в конфигураторе.
                    </p>

                    <div className="mt-auto flex flex-col gap-3 sm:flex-row" data-fab-avoid>
                      <LinkButton href={`/configurator?model=${model.slug}`} size="lg">
                        Настроить стеллаж
                      </LinkButton>
                      <LinkButton href={`/catalog/${model.slug}`} variant="outline" size="lg">
                        Смотреть модели
                      </LinkButton>
                    </div>
                  </div>

                  <div className="border-t border-line lg:border-l lg:border-t-0">
                    {configuration ? (
                      <ShelvingPreview config={configuration} color={color} className="aspect-[4/3] w-full" />
                    ) : (
                      <ProductImage src={model.image} alt={model.name.ru} className="aspect-[4/3] w-full object-cover" />
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
          <h2 className="font-display text-3xl">Как это работает</h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {HOW_IT_WORKS.map((item) => (
              <li key={item.step} className="border border-line p-4">
                <span className="mono text-2xl font-semibold text-blueprint">{String(item.step).padStart(2, '0')}</span>
                <h3 className="mt-2 font-medium">{item.title}</h3>
                <p className="mt-1 text-sm text-steel">{item.description}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Popular configurations */}
      <section className="bg-surface-muted">
        <Container className="py-14">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl">Популярные конфигурации</h2>
            <Link href="/catalog" className="tech-label text-blueprint hover:underline">
              Весь каталог →
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
          <h2 className="font-display text-3xl">Где используют стеллажи MS</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {catalog.useCases.map((useCase) => (
              <div key={useCase.id} className="flex flex-col items-center gap-2 border border-line p-4 text-center">
                <span className="text-2xl" aria-hidden="true">{USE_CASE_ICONS[useCase.id] ?? '📦'}</span>
                <span className="text-sm font-medium">{useCase.ru}</span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Delivery and payment */}
      <section>
        <Container className="grid grid-cols-1 gap-6 py-14 lg:grid-cols-2">
          <div className="border border-line p-6">
            <h2 className="font-display text-2xl">Способы получения</h2>
            <ul className="mt-4 space-y-2 text-sm text-steel">
              <li>• Склады в Алматы, Астане, Караганде и Шымкенте</li>
              <li>• Доставка по Алматы, Астане, Караганде и Шымкенту — бесплатно, в тот же день</li>
              <li>• Доставка в другие города и регионы Казахстана — 2–3 дня. Стоимость доставки рассчитывается индивидуально.</li>
              <li>• Профессиональная сборка на объекте</li>
            </ul>
            <LinkButton href="/delivery" variant="outline" className="mt-4">
              Подробнее о доставке
            </LinkButton>
          </div>
          <div className="border border-line p-6">
            <h2 className="font-display text-2xl">Способы оплаты</h2>
            <ul className="mt-4 space-y-2 text-sm text-steel">
              <li>• Безналичный расчёт для юридических лиц</li>
              <li>• Оплата по счёту</li>
              <li>• Наличными при самовывозе</li>
              <li>• Kaspi Pay и Kaspi QR — скоро</li>
            </ul>
            <LinkButton href="/payment" variant="outline" className="mt-4">
              Подробнее об оплате
            </LinkButton>
          </div>
        </Container>
      </section>

      {/* Contacts */}
      <section id="contacts" className="bg-surface-muted">
        <Container className="grid grid-cols-1 gap-8 py-14 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl">Свяжитесь с нами</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="tech-label">WhatsApp</dt>
                <dd className="mono text-base">
                  <a href={whatsAppContactUrl()} target="_blank" rel="noopener noreferrer" className="text-success hover:underline">
                    {site.whatsappDisplay}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="tech-label">Email</dt>
                <dd>
                  <a href={`mailto:${site.email}`}>{site.email}</a>
                </dd>
              </div>
              <div>
                <dt className="tech-label">Адрес</dt>
                <dd>{site.address}</dd>
              </div>
              <div>
                <dt className="tech-label">Режим работы</dt>
                <dd>{site.workingHours}</dd>
              </div>
            </dl>
          </div>

          <div className="border border-line bg-surface p-6">
            <h3 className="font-display text-xl">Оставить заявку</h3>
            <p className="mt-1 text-sm text-steel">Ответим в рабочее время в течение часа.</p>
            <div className="mt-4">
              <ContactForm />
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
