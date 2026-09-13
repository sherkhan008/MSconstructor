import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';

export const metadata: Metadata = buildMetadata({
  title: 'Доставка и сборка стеллажей MS по Казахстану',
  description:
    'Самовывоз со склада в Алматы, доставка по городу и по Казахстану, профессиональная сборка стеллажей MS. Условия и сроки.',
  path: '/delivery',
});

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export default async function DeliveryPage() {
  const catalog = await getCatalog();

  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">Доставка и сборка</h1>
      <p className="mt-3 max-w-2xl text-steel">
        Мы доставляем стеллажи MS по всему Казахстану и предлагаем профессиональную сборку на объекте заказчика.
        Точная стоимость доставки зависит от города, объёма и адреса — менеджер уточнит её после оформления заявки.
      </p>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Способы получения</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {catalog.deliveryMethods.map((method) => (
            <div key={method.id} className="border border-line p-4">
              <h3 className="font-medium">{method.name.ru}</h3>
              <p className="mt-1 text-sm text-steel">{method.description.ru}</p>
              <p className="tech-label mt-2">
                {method.basePrice === null
                  ? 'Стоимость уточняется менеджером'
                  : method.basePrice === 0
                    ? 'Бесплатно'
                    : `от ${method.basePrice.toLocaleString('ru-RU')} ₸`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Сборка</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {catalog.assemblyServices.map((service) => (
            <div key={service.id} className="border border-line p-4">
              <h3 className="font-medium">{service.name.ru}</h3>
              <p className="mt-1 text-sm text-steel">{service.description.ru}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-2xl">Что нужно указать при заказе</h2>
        <ul className="mt-4 max-w-2xl list-disc space-y-1 pl-5 text-sm text-steel">
          <li>Город и точный адрес доставки</li>
          <li>Этаж и наличие грузового лифта (для доставки в помещение)</li>
          <li>Желаемую дату доставки</li>
          <li>Контактное лицо и телефон на объекте</li>
        </ul>
      </section>

      <div className="mt-10">
        <LinkButton href="/configurator" size="lg" className="!whitespace-normal text-center">
          Рассчитать стоимость стеллажа
        </LinkButton>
      </div>
    </Container>
  );
}
