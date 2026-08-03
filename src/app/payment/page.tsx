import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = buildMetadata({
  title: 'Оплата',
  description: 'Способы оплаты стеллажей MS: безналичный расчёт, оплата по счёту, наличные, Kaspi Pay и Kaspi QR.',
  path: '/payment',
});

const METHODS = [
  {
    title: 'Безналичный расчёт',
    description: 'Для юридических лиц и ИП. Оплата по договору и счёту с НДС, полный пакет закрывающих документов.',
    available: true,
  },
  {
    title: 'Оплата по счёту',
    description: 'Выставляем счёт на оплату после подтверждения заказа менеджером — удобно для бухгалтерии компаний.',
    available: true,
  },
  {
    title: 'Наличными',
    description: 'При самовывозе со склада или при доставке курьером.',
    available: true,
  },
  {
    title: 'Kaspi Pay',
    description: 'Оплата через приложение Kaspi.kz.',
    available: false,
  },
  {
    title: 'Kaspi QR',
    description: 'Оплата по QR-коду на кассе или при доставке.',
    available: false,
  },
];

export default function PaymentPage() {
  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">Оплата</h1>
      <p className="mt-3 max-w-2xl text-steel">
        Работаем с физическими лицами, компаниями и государственными организациями. Ниже — актуальные способы оплаты.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {METHODS.map((method) => (
          <div key={method.title} className="border border-line p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{method.title}</h3>
              {!method.available && <Badge tone="accent">Скоро</Badge>}
            </div>
            <p className="mt-1 text-sm text-steel">{method.description}</p>
          </div>
        ))}
      </div>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-2xl">Документы для бухгалтерии</h2>
        <p className="mt-2 max-w-2xl text-sm text-steel">
          Для юридических лиц предоставляем счёт на оплату, счёт-фактуру, накладную и акт выполненных работ. НДС
          указывается отдельной строкой согласно действующей ставке.
        </p>
      </section>
    </Container>
  );
}
