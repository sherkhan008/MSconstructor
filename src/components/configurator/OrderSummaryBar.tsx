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
import { WhatsAppIcon } from '@/components/layout/Header';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import { Chevron } from './AdvancedSettingsAccordion';

/**
 * The configurator's purchase card. Below `lg` it is a compact bar fixed to
 * the bottom of the viewport; from `lg` the same element becomes a sticky
 * card at the foot of the configuration column (`lg:sticky`) — one DOM node
 * at every breakpoint, so no action is ever rendered twice.
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
  // Transient status replaces the "Итого" label in place instead of adding a
  // line, so the bar never changes height while a price is recalculated.
  const status = feedback ?? (isPricing ? t(CF['CF-071'], locale) : null);

  return (
    <div
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:static lg:z-auto lg:shrink-0 lg:border-t-2 lg:border-t-foreground"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div
        className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 max-[359px]:gap-2.5 max-[359px]:py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5 sm:px-6 lg:flex-col lg:items-stretch lg:gap-3 lg:px-5 lg:pb-5 lg:pt-4"
        data-fab-avoid
      >
        {/* Wraps: at lg the details toggle drops onto its own full-width
            line (order-last); below lg it is a compact square in the price
            row. One element either way — never a duplicate control.
            Below 360px there is no room for the total beside three 44px
            squares, so the row becomes a grid: label and the squares share
            the first line, and the total gets the full width underneath
            (the price block is `display: contents` there). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-[359px]:grid max-[359px]:grid-cols-[minmax(0,1fr)_auto_auto_auto] max-[359px]:gap-x-1.5 max-[359px]:gap-y-1">
          <div className="min-w-0 flex-1 max-[359px]:contents">
            <p
              role="status"
              aria-live="polite"
              className={`truncate text-[13px] leading-tight max-[359px]:col-start-1 max-[359px]:row-start-1 max-[359px]:self-end ${feedback ? 'font-medium text-success' : 'text-steel'}`}
            >
              {status ?? t(CF['CF-064'], locale)}
            </p>
            <div className="max-[359px]:col-span-4 max-[359px]:row-start-2 max-[359px]:min-w-0">
            {priceResult ? (
              <PriceTag
                value={priceResult.breakdown.total}
                size="lg"
                className={`block whitespace-nowrap leading-tight lg:!text-[2rem] ${isPricing ? 'opacity-60' : 'price-flash'}`}
              />
            ) : pricingError ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[13px] leading-snug text-danger">{pricingError.message}</p>
                <button
                  type="button"
                  onClick={retryPricing}
                  className="min-h-9 border border-danger px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft"
                >
                  {t(CF['CF-065'], locale)}
                </button>
              </div>
            ) : (
              <div className="mt-1 h-7 w-32 animate-pulse bg-surface-muted" />
            )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            disabled={!priceResult}
            aria-expanded={detailsOpen}
            className={`${ICON_ACTION} gap-2 sm:w-auto sm:px-3 lg:order-last lg:-my-1 lg:h-9 lg:basis-full lg:justify-start lg:border-transparent lg:bg-transparent lg:px-0 lg:text-[13px] lg:font-medium lg:text-steel lg:hover:border-transparent lg:hover:text-foreground`}
          >
            <span className="sr-only sm:not-sr-only">{t(CF['CF-057'], locale)}</span>
            <Chevron open={detailsOpen} />
          </button>
          <button
            type="button"
            onClick={handleWhatsApp}
            disabled={actionsDisabled}
            aria-label="WhatsApp"
            title="WhatsApp"
            className={`${ICON_ACTION} text-success hover:!border-success`}
          >
            <WhatsAppIcon />
          </button>
          <button type="button" onClick={handleShare} aria-label={t(CF['CF-068'], locale)} title={t(CF['CF-068'], locale)} className={ICON_ACTION}>
            <ShareIcon />
          </button>
        </div>

        {detailsOpen && priceResult && (
          <div className="max-h-[40vh] overflow-y-auto border-y border-line py-2.5 sm:order-last sm:basis-full lg:order-none lg:basis-auto">
            <PriceDetails priceResult={priceResult} />
          </div>
        )}

        {/* Primary (amber) first: the customer's next step. Side by side on
            phones and on short desktop screens — 48px tall, 15–16px text that
            may wrap to two lines rather than shrink — and stacked full width
            in the desktop card once the screen is tall enough to afford it.
            Side by side on desktop, checkout takes the larger share so the
            pair reads as primary + secondary, not two equal toolbar buttons. */}
        <div className="grid grid-cols-2 gap-2 sm:w-[24rem] sm:shrink-0 lg:w-auto lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:[@media(min-height:840px)]:grid-cols-1">
          <Button
            onClick={() => handleAddToCart(true)}
            disabled={actionsDisabled}
            variant="accent"
            className="min-h-12 !whitespace-normal !px-2 !tracking-normal !py-1.5 text-center !text-[15px] leading-tight min-[390px]:!text-base"
          >
            {t(CF['CF-067'], locale)}
          </Button>
          <Button
            onClick={() => handleAddToCart(false)}
            disabled={actionsDisabled}
            variant="outline"
            className="min-h-12 bg-surface !whitespace-normal !px-2 !tracking-normal !py-1.5 text-center !text-[15px] leading-tight min-[390px]:!text-base"
          >
            {t(CF['CF-066'], locale)}
          </Button>
        </div>
      </div>

    </div>
  );
}

/** Square 44px secondary action — the Header's icon-button language. */
const ICON_ACTION =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center border border-line bg-surface text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40';

function PriceDetails({ priceResult }: { priceResult: PublicPriceResult }) {
  const locale = useLocale();
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-1">
        <Row label={t(CF['CF-058'], locale)} value={priceResult.breakdown.unitNet} />
        {priceResult.breakdown.quantity > 1 && <Row label={t(CF['CF-059'], locale, { N: priceResult.breakdown.quantity })} value={priceResult.breakdown.itemsNet} />}
        {priceResult.breakdown.assembly > 0 && <Row label={t(CF['CF-060'], locale)} value={priceResult.breakdown.assembly} />}
        {priceResult.breakdown.delivery !== null && priceResult.breakdown.delivery > 0 && <Row label={t(CF['CF-061'], locale)} value={priceResult.breakdown.delivery} />}
        {priceResult.breakdown.discount > 0 && <Row label={t(CF['CF-062'], locale)} value={-priceResult.breakdown.discount} tone="success" />}
      </dl>
      {priceResult.deliveryNote && <p className="mt-2 text-[13px] leading-snug text-blueprint">{priceResult.deliveryNote}</p>}
    </>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 11.5V2.5M9 2.5L5.5 6M9 2.5L12.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
      <path d="M3.5 9.5V15H14.5V9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
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
