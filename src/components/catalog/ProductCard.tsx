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
import { pick, t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { apiHeaders } from '@/lib/i18n/request';
import { CT, G, VL } from '@/lib/i18n/strings';
import { MAX_KITS_PER_ORDER } from '@/lib/orders/limits';
import { useLocale } from '@/components/i18n/LocaleProvider';

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
  const locale = useLocale();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'limit'>('idle');
  const configureHref = localizePath(`/configurator?${configurationToShareQuery(configuration)}`, locale);
  const name = pick(product.name, locale);

  async function handleAddToCart() {
    setStatus('loading');
    try {
      const response = await fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: apiHeaders(locale),
        body: JSON.stringify(configuration),
      });
      const data = await response.json();
      if (!data.ok) {
        setStatus('idle');
        return;
      }
      const added = addItem({ modelSlug: product.modelSlug, modelName, configuration: data.configuration, priceSnapshot: data });
      if (!added.ok) {
        // The cart has no room left under the order's kit limit — nothing was added.
        setStatus('limit');
        return;
      }
      trackEvent('product_added_to_cart', { model: product.modelSlug, source: 'catalog_card' });
      setStatus('done');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('idle');
    }
  }

  return (
    <div className="flex flex-col overflow-hidden border border-line bg-surface transition-shadow hover:shadow-sm">
      <Link href={localizePath(`/catalog/${product.modelSlug}`, locale)} className="block">
        {visual ?? (
          <ProductImage src={product.image} alt={name} className="h-48 w-full bg-surface-muted object-cover" />
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg leading-tight">{name}</h3>
          {product.featured && <Badge tone="accent">{t(CT['CT-019'], locale)}</Badge>}
        </div>
        <div className="tech-label flex flex-wrap gap-x-3 gap-y-1">
          <span>{product.height}×{product.width}×{product.depth} {t(G['G-008'], locale)}</span>
          <span>{shelvesLabel(product.shelves, locale)}</span>
          <span>{t(CT['CT-024'], locale, { N: product.loadCapacity })}</span>
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          {priceTotal !== null ? <PriceTag value={priceTotal} size="lg" /> : <span className="text-sm text-steel">{t(CT['CT-020'], locale)}</span>}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1" data-fab-avoid>
          <LinkButton href={configureHref} variant="outline" size="sm">
            {t(CT['CT-021'], locale)}
          </LinkButton>
          <Button onClick={handleAddToCart} size="sm" disabled={status === 'loading'}>
            {status === 'done' ? t(CT['CT-023'], locale) : t(CT['CT-022'], locale)}
          </Button>
        </div>
        {status === 'limit' && (
          <p role="alert" className="text-[13px] leading-snug text-danger">
            {t(VL['VL-018'], locale, { N: MAX_KITS_PER_ORDER })}
          </p>
        )}
      </div>
    </div>
  );
}
