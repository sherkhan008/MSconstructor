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
import { pick, t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

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
  const locale = useLocale();

  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  const modelName = model ? pick(model.name, locale) : config.modelSlug;

  /** Share link to this configuration in the page's own language. */
  function shareUrl(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${localizePath(`/configurator?${configurationToShareQuery(config)}`, locale)}`;
  }

  function handleAddToCart(redirectToOrder: boolean) {
    if (!priceResult) return;
    addItem({ modelSlug: config.modelSlug, modelName, configuration: priceResult.configuration, priceSnapshot: priceResult });
    trackEvent('product_added_to_cart', { model: config.modelSlug, redirectToOrder });
    if (redirectToOrder) {
      router.push(localizePath('/order', locale));
    } else {
      setFeedback(t(CF['CF-069'], locale));
      setTimeout(() => setFeedback(null), 2500);
    }
  }

  async function handleShare() {
    const url = shareUrl();
    trackEvent('configuration_shared', { model: config.modelSlug });
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: t(CF['CF-072'], locale, { model: modelName }), url });
        return;
      } catch {
        // user cancelled — fall through to clipboard copy
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      setFeedback(t(CF['CF-070'], locale));
      setTimeout(() => setFeedback(null), 2500);
    }
  }

  function handleWhatsApp() {
    if (!priceResult) return;
    trackEvent('whatsapp_clicked', { location: 'configurator' });
    window.open(whatsAppConfiguratorUrl(priceResult, catalog.accessories, shareUrl(), locale), '_blank', 'noopener,noreferrer');
  }

  const actionsDisabled = !priceResult || isPricing;

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-30 hairline border-x-0 border-b-0 bg-surface">
      {detailsOpen && priceResult && (
        <div className="mx-auto max-w-7xl border-b border-line px-4 py-3 sm:px-6 lg:px-8">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Row label={t(CF['CF-058'], locale)} value={priceResult.breakdown.unitNet} />
            {priceResult.breakdown.quantity > 1 && <Row label={t(CF['CF-059'], locale, { N: priceResult.breakdown.quantity })} value={priceResult.breakdown.itemsNet} />}
            {priceResult.breakdown.assembly > 0 && <Row label={t(CF['CF-060'], locale)} value={priceResult.breakdown.assembly} />}
            {priceResult.breakdown.delivery !== null && priceResult.breakdown.delivery > 0 && <Row label={t(CF['CF-061'], locale)} value={priceResult.breakdown.delivery} />}
            {priceResult.breakdown.discount > 0 && <Row label={t(CF['CF-062'], locale)} value={-priceResult.breakdown.discount} tone="success" />}
          </dl>
          {priceResult.deliveryNote && <p className="mt-2 text-xs text-blueprint">{priceResult.deliveryNote}</p>}
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
          {t(CF['CF-057'], locale)} {detailsOpen ? '▲' : '▼'}
        </button>

        {/* Both rows wrap: at narrow widths the total + four actions need more
            width than the viewport, and this bar is `fixed`, so anything past
            the right edge is clipped and unreachable (the page itself cannot
            scroll to it). Wrapping keeps every action on screen. No effect at
            desktop widths, where the row already fits on one line. */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="tech-label">{t(CF['CF-064'], locale)}</div>
            {priceResult ? (
              <PriceTag value={priceResult.breakdown.total} size="lg" className={isPricing ? 'opacity-60' : 'price-flash'} />
            ) : pricingError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-danger">{pricingError.message}</p>
                <button type="button" onClick={retryPricing} className="tech-label border border-danger px-2 py-1 text-danger hover:bg-danger-soft">
                  {t(CF['CF-065'], locale)}
                </button>
              </div>
            ) : (
              <div className="h-7 w-32 animate-pulse bg-surface-muted" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => handleAddToCart(false)} disabled={actionsDisabled} variant="outline" size="sm" className="font-display uppercase tracking-wide">
              {t(CF['CF-066'], locale)}
            </Button>
            <Button onClick={() => handleAddToCart(true)} disabled={actionsDisabled} size="sm" className="font-display uppercase tracking-wide">
              {t(CF['CF-067'], locale)}
            </Button>
            <Button onClick={handleWhatsApp} disabled={actionsDisabled} variant="whatsapp" size="sm" type="button" aria-label="WhatsApp">
              WhatsApp
            </Button>
            <Button onClick={handleShare} variant="ghost" size="sm" type="button" aria-label={t(CF['CF-068'], locale)}>
              ↗
            </Button>
          </div>
        </div>
      </div>
      {feedback && <p className="tech-label pb-2 text-center text-success">{feedback}</p>}
      {isPricing && <p className="tech-label pb-2 text-center">{t(CF['CF-071'], locale)}</p>}
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
