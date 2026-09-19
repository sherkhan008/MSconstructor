'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ProductImage } from '@/components/ui/ProductImage';
import { Button, LinkButton } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { Badge } from '@/components/ui/Badge';
import { trackEvent } from '@/lib/analytics';
import { configurationToShareQuery } from '@/lib/configurator/url';
import { shelvesLabel } from '@/lib/plural';
import { useCartStore } from '@/store/cart-store';
import type { CatalogProduct, ShelvingConfiguration } from '@/lib/types/domain';

export function ProductCard({
  product,
  configuration,
  priceTotal,
  modelName,
  visual,
}: {
  product: CatalogProduct;
  configuration: ShelvingConfiguration;
  priceTotal: number | null;
  modelName: string;
  /** Optional replacement for the catalog photo — e.g. a drawing of this
   * exact configuration. Kept as a slot so a caller that wants one opts in
   * (and pays for its bundle) without every catalog card changing. */
  visual?: ReactNode;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const configureHref = `/configurator?${configurationToShareQuery(configuration)}`;

  async function handleAddToCart() {
    setStatus('loading');
    try {
      const response = await fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configuration),
      });
      const data = await response.json();
      if (!data.ok) {
        setStatus('idle');
        return;
      }
      addItem({ modelSlug: product.modelSlug, modelName, configuration: data.configuration, priceSnapshot: data });
      trackEvent('product_added_to_cart', { model: product.modelSlug, source: 'catalog_card' });
      setStatus('done');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('idle');
    }
  }

  return (
    <div className="flex flex-col overflow-hidden border border-line bg-surface transition-shadow hover:shadow-sm">
      <Link href={`/catalog/${product.modelSlug}`} className="block">
        {visual ?? (
          <ProductImage src={product.image} alt={product.name.ru} className="h-48 w-full bg-surface-muted object-cover" />
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg leading-tight">{product.name.ru}</h3>
          {product.featured && <Badge tone="accent">Популярно</Badge>}
        </div>
        <div className="tech-label flex flex-wrap gap-x-3 gap-y-1">
          <span>{product.height}×{product.width}×{product.depth} мм</span>
          <span>{shelvesLabel(product.shelves)}</span>
          <span>{product.loadCapacity} кг/полка</span>
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          {priceTotal !== null ? <PriceTag value={priceTotal} size="lg" /> : <span className="text-sm text-steel">По запросу</span>}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1" data-fab-avoid>
          <LinkButton href={configureHref} variant="outline" size="sm">
            Настроить
          </LinkButton>
          <Button onClick={handleAddToCart} size="sm" disabled={status === 'loading'}>
            {status === 'done' ? 'Добавлено ✓' : 'В корзину'}
          </Button>
        </div>
      </div>
    </div>
  );
}
