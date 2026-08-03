'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { formatPrice } from '@/lib/money';
import { trackEvent } from '@/lib/analytics';
import { configurationToShareQuery } from '@/lib/configurator/url';
import { whatsAppConfiguratorUrl } from '@/lib/whatsapp';
import { useConfiguratorStore } from '@/store/configurator-store';
import { useCartStore } from '@/store/cart-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function PricePanel({ catalog, className = '' }: { catalog: PublicCatalog; className?: string }) {
  const config = useConfiguratorStore((s) => s.config);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const pricingError = useConfiguratorStore((s) => s.pricingError);
  const isPricing = useConfiguratorStore((s) => s.isPricing);
  const addItem = useCartStore((s) => s.addItem);
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);

  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  const modelName = model?.name.ru ?? config.modelSlug;

  function shareUrl(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/configurator?${configurationToShareQuery(config)}`;
  }

  function handleAddToCart(redirectToOrder: boolean) {
    if (!priceResult) return;
    addItem({ modelSlug: config.modelSlug, modelName, configuration: priceResult.configuration, priceSnapshot: priceResult });
    trackEvent('product_added_to_cart', { model: config.modelSlug, redirectToOrder });
    if (redirectToOrder) {
      router.push('/order');
    } else {
      setFeedback('Добавлено в корзину');
      setTimeout(() => setFeedback(null), 2500);
    }
  }

  async function handleShare() {
    const url = shareUrl();
    trackEvent('configuration_shared', { model: config.modelSlug });
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `Конфигурация ${modelName}`, url });
        return;
      } catch {
        // user cancelled — fall through to clipboard copy
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      setFeedback('Ссылка скопирована');
      setTimeout(() => setFeedback(null), 2500);
    }
  }

  function handleWhatsApp() {
    if (!priceResult) return;
    trackEvent('whatsapp_clicked', { location: 'configurator' });
    window.open(whatsAppConfiguratorUrl(priceResult, modelName, shareUrl()), '_blank', 'noopener,noreferrer');
  }

  return (
    <aside className={`flex flex-col gap-4 border border-line bg-surface p-5 ${className}`}>
      <div>
        <div className="tech-label">Итоговая цена</div>
        {priceResult ? (
          <PriceTag value={priceResult.breakdown.total} size="xl" className={isPricing ? 'opacity-60' : 'price-flash'} />
        ) : pricingError ? (
          <p className="text-sm text-danger">{pricingError.message}</p>
        ) : (
          <div className="h-9 w-40 animate-pulse bg-surface-muted" />
        )}
        {priceResult && (
          <p className="mono mt-1 text-xs text-steel">
            {formatPrice(priceResult.breakdown.unitTotal)} / шт. · НДС {priceResult.breakdown.vatPercent}%:{' '}
            {formatPrice(priceResult.breakdown.vat)}
          </p>
        )}
        {priceResult?.deliveryNote && <p className="mt-2 text-xs text-blueprint">{priceResult.deliveryNote}</p>}
      </div>

      {priceResult && (
        <dl className="space-y-1.5 border-y border-line py-3 text-sm">
          <Row label="Комплектующие" value={priceResult.breakdown.componentsSubtotal} />
          {priceResult.breakdown.colorSurcharge > 0 && <Row label="Цвет" value={priceResult.breakdown.colorSurcharge} />}
          <Row label="Наценка" value={priceResult.breakdown.markup} />
          {priceResult.breakdown.quantity > 1 && (
            <Row label={`Полки × ${priceResult.breakdown.quantity} компл.`} value={priceResult.breakdown.itemsNet} />
          )}
          {priceResult.breakdown.assembly > 0 && <Row label="Сборка" value={priceResult.breakdown.assembly} />}
          {priceResult.breakdown.delivery !== null && priceResult.breakdown.delivery > 0 && (
            <Row label="Доставка" value={priceResult.breakdown.delivery} />
          )}
          {priceResult.breakdown.discount > 0 && <Row label="Скидка" value={-priceResult.breakdown.discount} tone="success" />}
          <Row label="НДС" value={priceResult.breakdown.vat} />
        </dl>
      )}

      <div className="flex flex-col gap-2">
        <Button onClick={() => handleAddToCart(true)} disabled={!priceResult} size="lg">
          Оформить заказ
        </Button>
        <Button onClick={() => handleAddToCart(false)} disabled={!priceResult} variant="outline">
          Добавить в корзину
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={handleShare} variant="ghost" size="sm" type="button">
            Поделиться
          </Button>
          <Button onClick={handleWhatsApp} disabled={!priceResult} variant="whatsapp" size="sm" type="button">
            WhatsApp
          </Button>
        </div>
        {feedback && <p className="tech-label text-center text-success">{feedback}</p>}
      </div>

      {priceResult && <p className="tech-label">Срок изготовления: {priceResult.leadTimeDays} дн.</p>}
    </aside>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone?: 'success' }) {
  return (
    <div className={`flex items-center justify-between ${tone === 'success' ? 'text-success' : ''}`}>
      <dt className="text-steel">{label}</dt>
      <dd className="mono">{formatPrice(value)}</dd>
    </div>
  );
}
