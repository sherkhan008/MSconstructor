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

/**
 * One compact bar fixed to the bottom of the viewport at every breakpoint —
 * replaces the old desktop PricePanel sidebar + mobile-only StickyPriceBar.
 * Renders only the customer-safe breakdown the pricing API returns
 * (src/lib/pricing/public-result.ts): the kit's customer price per set
 * (colour and markup already included), assembly, delivery, discount and the
 * total. Markup and pre-markup subtotals never reach the browser at all, and
 * there is no separate VAT row. A price the customer can act on is either a
 * fresh server result or explicitly marked stale/loading — never a leftover
 * number from before the last change.
 */
export function OrderSummaryBar({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const pricingError = useConfiguratorStore((s) => s.pricingError);
  const isPricing = useConfiguratorStore((s) => s.isPricing);
  const retryPricing = useConfiguratorStore((s) => s.retryPricing);
  const addItem = useCartStore((s) => s.addItem);
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

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
    window.open(whatsAppConfiguratorUrl(priceResult, catalog.accessories, shareUrl()), '_blank', 'noopener,noreferrer');
  }

  const actionsDisabled = !priceResult || isPricing;

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-30 hairline border-x-0 border-b-0 bg-surface">
      {detailsOpen && priceResult && (
        <div className="mx-auto max-w-7xl border-b border-line px-4 py-3 sm:px-6 lg:px-8">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Row label="Комплектующие" value={priceResult.breakdown.unitNet} />
            {priceResult.breakdown.quantity > 1 && <Row label={`Полки × ${priceResult.breakdown.quantity} компл.`} value={priceResult.breakdown.itemsNet} />}
            {priceResult.breakdown.assembly > 0 && <Row label="Сборка" value={priceResult.breakdown.assembly} />}
            {priceResult.breakdown.delivery !== null && priceResult.breakdown.delivery > 0 && <Row label="Доставка" value={priceResult.breakdown.delivery} />}
            {priceResult.breakdown.discount > 0 && <Row label="Скидка" value={-priceResult.breakdown.discount} tone="success" />}
          </dl>
          {priceResult.deliveryNote && <p className="mt-2 text-xs text-blueprint">{priceResult.deliveryNote}</p>}
          <p className="tech-label mt-2">Срок изготовления: {priceResult.leadTimeDays} дн.</p>
        </div>
      )}

      <div
        className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8"
        data-fab-avoid
      >
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          disabled={!priceResult}
          aria-expanded={detailsOpen}
          className="tech-label border border-line px-2 py-1.5 hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Детали стоимости {detailsOpen ? '▲' : '▼'}
        </button>

        {/* Both rows wrap: at narrow widths the total + four actions need more
            width than the viewport, and this bar is `fixed`, so anything past
            the right edge is clipped and unreachable (the page itself cannot
            scroll to it). Wrapping keeps every action on screen. No effect at
            desktop widths, where the row already fits on one line. */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="tech-label">Итого</div>
            {priceResult ? (
              <PriceTag value={priceResult.breakdown.total} size="lg" className={isPricing ? 'opacity-60' : 'price-flash'} />
            ) : pricingError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-danger">{pricingError.message}</p>
                <button type="button" onClick={retryPricing} className="tech-label border border-danger px-2 py-1 text-danger hover:bg-danger-soft">
                  Повторить
                </button>
              </div>
            ) : (
              <div className="h-7 w-32 animate-pulse bg-surface-muted" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => handleAddToCart(false)} disabled={actionsDisabled} variant="outline" size="sm" className="font-display uppercase tracking-wide">
              Добавить в корзину
            </Button>
            <Button onClick={() => handleAddToCart(true)} disabled={actionsDisabled} size="sm" className="font-display uppercase tracking-wide">
              Оформить заказ
            </Button>
            <Button onClick={handleWhatsApp} disabled={actionsDisabled} variant="whatsapp" size="sm" type="button" aria-label="WhatsApp">
              WhatsApp
            </Button>
            <Button onClick={handleShare} variant="ghost" size="sm" type="button" aria-label="Поделиться конфигурацией">
              ↗
            </Button>
          </div>
        </div>
      </div>
      {feedback && <p className="tech-label pb-2 text-center text-success">{feedback}</p>}
      {isPricing && <p className="tech-label pb-2 text-center">Пересчёт стоимости…</p>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone?: 'success' }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${tone === 'success' ? 'text-success' : ''}`}>
      <dt className="text-steel">{label}</dt>
      <dd className="mono">{formatPrice(value)}</dd>
    </div>
  );
}
