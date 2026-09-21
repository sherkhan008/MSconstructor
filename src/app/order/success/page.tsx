import type { Metadata } from 'next';
import { getOrderByNumber } from '@/lib/orders/store';
import { buildMetadata } from '@/lib/seo';
import { formatPrice } from '@/lib/money';
import { whatsAppOrderUrl } from '@/lib/whatsapp';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';

const ORDER_STATUS_LABEL: Record<string, string> = {
  NEW: 'Заказ принят',
};

export const metadata: Metadata = buildMetadata({
  title: 'Заказ оформлен',
  description: 'Спасибо за заказ стеллажей MS.',
  path: '/order/success',
  noIndex: true,
});

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string }>;
}) {
  const { number } = await searchParams;
  const order = number ? await getOrderByNumber(number) : undefined;

  return (
    <Container className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center border-2 border-success text-3xl text-success">✓</div>
      <h1 className="font-display text-4xl">Заказ принят!</h1>

      {number ? (
        <p className="text-steel">
          Номер вашего заказа: <span className="mono font-semibold text-foreground">{number}</span>
        </p>
      ) : (
        <p className="text-steel">Спасибо! Мы получили вашу заявку.</p>
      )}

      {order && (
        <div className="w-full max-w-md border border-line p-5 text-left">
          <div className="tech-label">Сумма заказа</div>
          <p className="mono text-2xl font-semibold">{formatPrice(order.grandTotal)}</p>
          <div className="tech-label mt-3">Статус</div>
          <p>{ORDER_STATUS_LABEL[order.status] ?? 'Заказ обрабатывается'}</p>
          <div className="tech-label mt-3">Способ оплаты</div>
          <p>{PAYMENT_METHOD_LABEL[order.paymentPreference] ?? order.paymentPreference}</p>
          <div className="tech-label mt-3">Позиций</div>
          <p>{order.items.length}</p>
        </div>
      )}

      <p className="max-w-md text-sm text-steel">
        Наш менеджер свяжется с вами в ближайшее рабочее время для подтверждения заказа, уточнения деталей
        доставки и выставления счёта.
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        {number && (
          <LinkButton
            href={whatsAppOrderUrl(number, order?.grandTotal)}
            target="_blank"
            rel="noopener noreferrer"
            variant="whatsapp"
          >
            Написать в WhatsApp
          </LinkButton>
        )}
        <LinkButton href="/catalog" variant="outline">
          Вернуться в каталог
        </LinkButton>
        <LinkButton href="/" variant="ghost">
          На главную
        </LinkButton>
      </div>
    </Container>
  );
}
