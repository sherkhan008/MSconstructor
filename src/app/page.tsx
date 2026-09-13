import type { Metadata } from 'next';
import Link from 'next/link';
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { formatPrice } from '@/lib/money';
import { buildMetadata, jsonLdScriptProps, organizationJsonLd } from '@/lib/seo';
import { site } from '@/lib/config/site';
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
  { title: 'До 300 кг на полку', description: 'Усиленные модели MS Стронг для тяжёлых складских нагрузок' },
  { title: 'Модульная конструкция', description: 'Наращивайте секции и полки по мере роста склада' },
  { title: 'Регулируемый шаг полок', description: 'Настройте высоту под конкретные грузы без сверления' },
  { title: 'Быстрая сборка', description: 'Болтовое соединение — без сварки, силами одной бригады' },
  { title: 'Любые размеры', description: '6 высот, 4 ширины, 4 глубины и точный расчёт под задачу' },
  { title: 'Доставка по Казахстану', description: 'Самовывоз, доставка по городу и в регионы' },
  { title: 'Физическим и юридическим лицам', description: 'Работаем с частными клиентами, компаниями и госорганизациями' },
  { title: 'Документы с НДС', description: 'Полный пакет закрывающих документов для бухгалтерии' },
];

const HOW_IT_WORKS = [
  { step: 1, title: 'Выберите модель', description: 'MS Стандарт, MS Стронг или архивный стеллаж' },
  { step: 2, title: 'Задайте размеры', description: 'Высота, ширина, глубина и число полок' },
  { step: 3, title: 'Добавьте аксессуары', description: 'Стенки, разделители, контейнеры и сборку' },
  { step: 4, title: 'Получите цену', description: 'Расчёт происходит мгновенно на сервере' },
  { step: 5, title: 'Оформите заказ', description: 'Онлайн, по телефону или в WhatsApp' },
];

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

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
  const featuredProducts = catalog.products.filter((p) => p.featured).slice(0, 6);

  const cards = featuredProducts.map((product) => {
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
            <div className="mt-6 flex flex-wrap gap-3">
              <LinkButton href="/configurator" size="lg">
                Открыть конфигуратор
              </LinkButton>
              <LinkButton href="/catalog" variant="outline" size="lg">
                Смотреть каталог
              </LinkButton>
            </div>
            {startingPrice !== null && (
              <p className="tech-label mt-6">Стеллажи от {formatPrice(startingPrice)} · нагрузка до 300 кг на полку</p>
            )}
          </div>
          <ProductImage
            src="/images/models/ms-standard.svg"
            alt="Стеллаж MS Стандарт на складе"
            className="aspect-[4/3] w-full border border-line object-cover"
            priority
          />
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
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {catalog.models.map((model) => (
              <Link
                key={model.slug}
                href={`/catalog/${model.slug}`}
                className="group flex flex-col overflow-hidden border border-line bg-surface transition-colors hover:border-foreground"
              >
                <ProductImage src={model.image} alt={model.name.ru} className="h-44 w-full object-cover" />
                <div className="p-4">
                  <h3 className="font-display text-xl">{model.name.ru}</h3>
                  <p className="mt-1 text-sm text-steel">{model.shortDescription.ru}</p>
                  <span className="tech-label mt-3 inline-block text-blueprint group-hover:underline">Смотреть модели →</span>
                </div>
              </Link>
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
            {cards.map(({ product, configuration, modelName, priceTotal }) => (
              <ProductCard
                key={product.id}
                product={product}
                configuration={configuration}
                modelName={modelName}
                priceTotal={priceTotal}
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

      {/* Installation */}
      <section className="bg-surface-muted">
        <Container className="py-14">
          <h2 className="font-display text-3xl">Доставка и сборка</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { src: '/images/gallery/warehouse-1.svg', alt: 'Доставка стеллажей' },
              { src: '/images/gallery/warehouse-2.svg', alt: 'Разгрузка и распаковка' },
              { src: '/images/models/ms-strong.svg', alt: 'Сборка стеллажа' },
              { src: '/images/gallery/archive-1.svg', alt: 'Готовая установка' },
            ].map((image) => (
              <ProductImage key={image.src} src={image.src} alt={image.alt} className="aspect-square w-full border border-line object-cover" />
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
              <li>• Самовывоз со склада в Алматы</li>
              <li>• Доставка по городу на следующий день</li>
              <li>• Доставка по Казахстану транспортной компанией</li>
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
                <dt className="tech-label">Телефон</dt>
                <dd className="mono text-base">
                  <a href={`tel:${site.phoneHref}`}>{site.phone}</a>
                </dd>
              </div>
              <div>
                <dt className="tech-label">WhatsApp</dt>
                <dd>
                  <a href={whatsAppContactUrl()} target="_blank" rel="noopener noreferrer" className="text-success hover:underline">
                    Написать в WhatsApp
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
            <div className="mt-4 flex aspect-video items-center justify-center border border-line bg-surface text-sm text-steel">
              Карта — укажите виджет 2GIS/Яндекс.Карт в src/lib/config/site.ts
            </div>
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
