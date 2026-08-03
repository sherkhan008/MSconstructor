import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { OrderForm } from '@/components/order/OrderForm';

export const metadata: Metadata = buildMetadata({
  title: 'Оформление заказа',
  description: 'Оформите заказ на стеллажи MS онлайн.',
  path: '/order',
  noIndex: true,
});

export default function OrderPage() {
  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">Оформление заказа</h1>
      <div className="mt-8">
        <OrderForm />
      </div>
    </Container>
  );
}
