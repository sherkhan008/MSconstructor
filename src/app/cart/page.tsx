import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { CartClient } from '@/components/cart/CartClient';

export const metadata: Metadata = buildMetadata({
  title: 'Корзина',
  description: 'Ваши конфигурации стеллажей MS перед оформлением заказа.',
  path: '/cart',
  noIndex: true,
});

export default async function CartPage() {
  const catalog = await getCatalog();

  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">Корзина</h1>
      <div className="mt-8">
        <CartClient catalog={toPublicCatalog(catalog)} />
      </div>
    </Container>
  );
}
