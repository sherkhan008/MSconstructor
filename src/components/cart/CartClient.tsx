'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { formatPrice } from '@/lib/money';
import { configurationToShareQuery } from '@/lib/configurator/url';
import { trackEvent } from '@/lib/analytics';
import { useCartStore, type CartItem } from '@/store/cart-store';
import type { ColorOption } from '@/lib/types/domain';

/**
 * Every price shown here is either a fresh server response or explicitly
 * marked as "recalculating" — quantity changes null out the cached snapshot
 * (see cart-store.setQuantity) and this component immediately re-fetches it,
 * so a stale client-side total is never carried into checkout.
 */
export function CartClient({ colors }: { colors: ColorOption[] }) {
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const duplicateItem = useCartStore((s) => s.duplicateItem);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setPriceSnapshot = useCartStore((s) => s.setPriceSnapshot);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const stale = items.filter((item) => item.priceSnapshot === null);
    stale.forEach((item) => {
      fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.configuration),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.ok) setPriceSnapshot(item.id, data);
        })
        .catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.id}:${i.priceSnapshot === null}`).join(',')]);

  if (!mounted) return null;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-lg text-steel">Ваша корзина пуста</p>
        <LinkButton href="/configurator">Открыть конфигуратор</LinkButton>
      </div>
    );
  }

  const total = items.reduce((sum, item) => sum + (item.priceSnapshot?.breakdown.total ?? 0), 0);
  const allPriced = items.every((item) => item.priceSnapshot !== null);

  function handleCheckout() {
    trackEvent('order_submitted', { stage: 'cart_to_checkout', items: items.length });
    router.push('/order');
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <CartRow
            key={item.id}
            item={item}
            color={colors.find((c) => c.id === item.configuration.colorId)}
            onRemove={() => removeItem(item.id)}
            onDuplicate={() => duplicateItem(item.id)}
            onQuantityChange={(q) => setQuantity(item.id, q)}
          />
        ))}
      </div>

      <aside className="flex flex-col gap-4 border border-line bg-surface p-5 lg:sticky lg:top-20">
        <div>
          <div className="tech-label">Итого по корзине</div>
          <PriceTag value={total} size="xl" />
        </div>
        <Button onClick={handleCheckout} disabled={!allPriced} size="lg">
          Оформить заказ
        </Button>
        <LinkButton href="/configurator" variant="outline">
          Добавить ещё стеллаж
        </LinkButton>
      </aside>
    </div>
  );
}

function CartRow({
  item,
  color,
  onRemove,
  onDuplicate,
  onQuantityChange,
}: {
  item: CartItem;
  color?: ColorOption;
  onRemove: () => void;
  onDuplicate: () => void;
  onQuantityChange: (quantity: number) => void;
}) {
  const editHref = `/configurator?${configurationToShareQuery(item.configuration)}`;

  return (
    <div className="flex flex-col gap-4 border border-line p-4 sm:flex-row">
      <ShelvingPreview config={item.configuration} color={color} className="aspect-[4/3] w-full sm:w-56 shrink-0" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-xl">{item.modelName}</h3>
          {item.priceSnapshot ? (
            <PriceTag value={item.priceSnapshot.breakdown.total} size="md" />
          ) : (
            <span className="tech-label">Пересчёт…</span>
          )}
        </div>
        <div className="tech-label flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {item.configuration.height}×{item.configuration.sections.map((s) => s.width).join('+')}×
            {item.configuration.depth} мм
          </span>
          <span>{item.configuration.shelves} полок</span>
          <span>{item.configuration.sections.length} секц.</span>
          <span>{item.configuration.loadCapacity} кг/полка</span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-sm">
            Кол-во:
            <input
              type="number"
              min={1}
              max={200}
              value={item.configuration.quantity}
              onChange={(e) => onQuantityChange(Number(e.target.value) || 1)}
              className="mono h-9 w-16 border border-line bg-surface px-2 text-center outline-none focus:border-blueprint"
            />
          </label>
          <Link href={editHref} className="text-sm text-blueprint hover:underline">
            Изменить
          </Link>
          <button type="button" onClick={onDuplicate} className="text-sm text-steel hover:text-foreground">
            Дублировать
          </button>
          <button type="button" onClick={onRemove} className="text-sm text-danger hover:underline">
            Удалить
          </button>
        </div>
        {item.priceSnapshot && (
          <p className="mono text-xs text-steel">{formatPrice(item.priceSnapshot.breakdown.unitTotal)} / шт.</p>
        )}
      </div>
    </div>
  );
}
