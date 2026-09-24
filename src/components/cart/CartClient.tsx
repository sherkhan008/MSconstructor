'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { formatPrice } from '@/lib/money';
import { configurationToShareQuery } from '@/lib/configurator/url';
import { reconcileConfiguration } from '@/lib/configurator/reconcile';
import { trackEvent } from '@/lib/analytics';
import { shelvesLabel } from '@/lib/plural';
import { useCartStore, type CartItem, type CartMutationResult } from '@/store/cart-store';
import type { ColorOption, DeliveryMethod } from '@/lib/types/domain';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import { pick, t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { apiHeaders } from '@/lib/i18n/request';
import { CF, CR, CT, ER, G, H, VL } from '@/lib/i18n/strings';
import { exceedsKitLimit, getRemainingKitCapacity, MAX_KITS_PER_ORDER } from '@/lib/orders/limits';
import { useLocale } from '@/components/i18n/LocaleProvider';

/** Store bounds for a line quantity (see cart-store.setQuantity). */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 200;

/**
 * Every price shown here is either a fresh server response or explicitly
 * marked as "recalculating" — quantity changes null out the cached snapshot
 * (see cart-store.setQuantity) and this component immediately re-fetches it,
 * so a stale client-side total is never carried into checkout.
 */
export function CartClient({ catalog }: { catalog: PublicCatalog }) {
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const duplicateItem = useCartStore((s) => s.duplicateItem);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setPriceSnapshot = useCartStore((s) => s.setPriceSnapshot);
  const setConfiguration = useCartStore((s) => s.setConfiguration);
  const [mounted, setMounted] = useState(false);
  const [reconcileNotice, setReconcileNotice] = useState<string | null>(null);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  /** Why the last duplicate/quantity change was refused (the cart itself is unchanged). */
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const router = useRouter();
  const locale = useLocale();

  /** A cart line's model name in the page locale (the stored name is a fallback). */
  function modelNameOf(item: CartItem): string {
    const model = catalog.models.find((m) => m.slug === item.modelSlug);
    return model ? pick(model.name, locale) : item.modelName;
  }

  useEffect(() => setMounted(true), []);

  // A cart item's configuration is a snapshot taken when it was added — if
  // the catalog was re-seeded/repaired since (see
  // scripts/repair-canonical-catalog-ids.ts) a persisted colorId/
  // assemblyId/deliveryId/accessoryId may no longer resolve. Without this,
  // that item's re-price below fails forever and it's stuck showing
  // "Пересчёт…" with no way to recover except removing it. Runs once per
  // mount, before the re-price effect, so a repaired item is re-priced with
  // its corrected configuration on the very first attempt.
  useEffect(() => {
    if (!mounted) return;
    const notices: string[] = [];
    for (const item of items) {
      const result = reconcileConfiguration(item.configuration, catalog);
      if (!result.changed) continue;
      setConfiguration(item.id, result.config);
      if (result.removedAccessoryIds.length > 0) {
        notices.push(t(CR['CR-016'], locale, { model: modelNameOf(item) }));
      }
      if (result.colorReset || result.assemblyReset || result.deliveryReset) {
        notices.push(t(CR['CR-017'], locale, { model: modelNameOf(item) }));
      }
    }
    if (notices.length > 0) {
      setReconcileNotice(t(CR['CR-015'], locale, { list: notices.join('; ') }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    const stale = items.filter((item) => item.priceSnapshot === null);
    stale.forEach((item) => {
      // Only an answer for the configuration the line still has may land:
      // a quantity stepped again while this request was in flight has its own
      // request (the effect key below includes the unpriced configuration),
      // and this older answer must never be shown as that line's price.
      const isCurrent = () => useCartStore.getState().items.find((i) => i.id === item.id)?.configuration === item.configuration;
      fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: apiHeaders(locale),
        body: JSON.stringify(item.configuration),
      })
        .then((res) => res.json())
        .then((data) => {
          if (!isCurrent()) return;
          if (data.ok) {
            setPriceSnapshot(item.id, data);
            setPriceErrors((prev) => {
              if (!(item.id in prev)) return prev;
              const { [item.id]: _removed, ...rest } = prev;
              return rest;
            });
          } else {
            // Never leave the row stuck on "Пересчёт…" forever with no
            // explanation — the reconciliation pass above already fixed
            // what it safely could; a failure past that point is a real,
            // server-validated reason (shown verbatim) the customer can
            // act on (edit or remove the item).
            setPriceErrors((prev) => ({ ...prev, [item.id]: data.message ?? t(ER['ER-015'], locale) }));
          }
        })
        .catch(() => {
          if (isCurrent()) setPriceErrors((prev) => ({ ...prev, [item.id]: t(ER['ER-016'], locale) }));
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.id}:${i.priceSnapshot === null ? JSON.stringify(i.configuration) : 'priced'}`).join(',')]);

  if (!mounted) return null;

  if (items.length === 0) {
    return <EmptyCart message={t(CR['CR-002'], locale)} locale={locale} />;
  }

  const total = items.reduce((sum, item) => sum + (item.priceSnapshot?.breakdown.total ?? 0), 0);
  const allPriced = items.every((item) => item.priceSnapshot !== null);
  // A line still waiting for its server price (not one that failed) —
  // the total is then marked as recalculating, never shown as current.
  const recalculating = items.some((item) => item.priceSnapshot === null && !priceErrors[item.id]);
  // The server's note for delivery that is not in the total (regional
  // delivery is calculated individually) — shown so the total never reads as
  // delivery-included. The server sets deliveryNote only for that case
  // (ER-024); it is rendered in the page locale, so a snapshot priced on the
  // other-language page never shows up in the wrong language.
  const hasIndividualDelivery = items.some((item) => Boolean(item.priceSnapshot?.deliveryNote));

  // Physical-kit limit (src/lib/orders/limits.ts): quantity controls only
  // offer what still fits; a cart persisted over the limit is kept as-is,
  // explained, and cannot go to checkout until the customer reduces it.
  const kitLimitMessage = t(VL['VL-018'], locale, { N: MAX_KITS_PER_ORDER });
  const remainingKits = getRemainingKitCapacity(items);
  const overKitLimit = exceedsKitLimit(items);

  function applyLimited(result: CartMutationResult) {
    setLimitNotice(!result.ok && result.reason === 'KIT_LIMIT' ? kitLimitMessage : null);
  }

  function handleCheckout() {
    if (overKitLimit) return;
    trackEvent('order_submitted', { stage: 'cart_to_checkout', items: items.length });
    router.push(localizePath('/order', locale));
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_23rem] xl:gap-10">
      <div className="flex min-w-0 flex-col gap-4">
        {reconcileNotice && (
          <p role="status" className="border border-line border-l-2 border-l-accent bg-surface px-4 py-3 text-sm text-steel">
            {reconcileNotice}
          </p>
        )}
        {limitNotice && !overKitLimit && (
          <p role="alert" className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            {limitNotice}
          </p>
        )}
        {/* Same rule as the summary beside it and the checkout form: the
            floating WhatsApp button steps aside rather than sitting over a
            line's quantity and edit controls. */}
        <ul className="divide-y divide-line border border-line bg-surface" data-fab-avoid>
          {items.map((item) => (
            <CartRow
              key={item.id}
              item={item}
              modelName={modelNameOf(item)}
              locale={locale}
              color={catalog.colors.find((c) => c.id === item.configuration.colorId)}
              delivery={catalog.deliveryMethods.find((d) => d.id === item.configuration.deliveryId)}
              error={priceErrors[item.id]}
              maxQuantity={Math.min(MAX_QUANTITY, item.configuration.quantity + remainingKits)}
              onRemove={() => {
                setLimitNotice(null);
                removeItem(item.id);
              }}
              onDuplicate={() => applyLimited(duplicateItem(item.id))}
              onQuantityChange={(q) => applyLimited(setQuantity(item.id, q))}
            />
          ))}
        </ul>
      </div>

      <aside
        aria-labelledby="cart-summary-title"
        className="border border-line border-t-2 border-t-foreground bg-surface p-5 sm:p-6 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]"
        data-fab-avoid
      >
        <h2 id="cart-summary-title" className="font-sans text-sm font-medium tracking-normal text-steel">
          {t(CR['CR-004'], locale)}
        </h2>
        <div className="mt-2" aria-live="polite" aria-busy={recalculating}>
          <PriceTag value={total} size="xl" className={`block leading-tight ${recalculating ? 'opacity-50' : ''}`} />
          {recalculating && <p className="mt-1 text-[13px] text-steel">{t(CR['CR-007'], locale)}</p>}
        </div>
        {hasIndividualDelivery && <p className="mt-3 text-[13px] leading-snug text-blueprint">{t(ER['ER-024'], locale)}</p>}
        {overKitLimit ? (
          <p role="alert" data-testid="cart-kit-limit" className="mt-3 border border-danger bg-danger-soft px-3 py-2 text-[13px] leading-snug text-danger">
            {kitLimitMessage} {t(CR['CR-018'], locale)}
          </p>
        ) : (
          remainingKits === 0 && <p data-testid="cart-kit-limit" className="mt-3 text-[13px] leading-snug text-steel">{kitLimitMessage}</p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={handleCheckout} disabled={!allPriced || overKitLimit} variant="accent" size="lg" className="min-h-12 w-full !whitespace-normal text-center">
            {t(CF['CF-067'], locale)}
          </Button>
          <LinkButton
            href={localizePath('/configurator', locale)}
            variant="outline"
            className="min-h-12 w-full bg-surface !whitespace-normal text-center"
          >
            {t(CR['CR-005'], locale)}
          </LinkButton>
        </div>
      </aside>
    </div>
  );
}

/** Empty cart (and empty checkout): what happened, and the two ways back into the catalogue. */
export function EmptyCart({ message, locale }: { message: string; locale: Locale }) {
  return (
    <div className="flex flex-col items-center border border-line bg-surface px-5 py-12 text-center sm:py-16">
      <h2 className="font-display text-2xl sm:text-3xl">{message}</h2>
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3" data-fab-avoid>
        <LinkButton href={localizePath('/configurator', locale)} variant="accent" className="min-h-12 px-6">
          {t(CR['CR-003'], locale)}
        </LinkButton>
        <LinkButton href={localizePath('/catalog', locale)} variant="outline" className="min-h-12 bg-surface px-6">
          {t(H['H-002'], locale)}
        </LinkButton>
      </div>
    </div>
  );
}

/** H×W+W×D mm on one line where it fits; on a narrow screen it wraps only
 * after a separator, never inside a number. Text content is unchanged. */
export function Dimensions({ configuration, unit }: { configuration: CartItem['configuration']; unit: string }) {
  const parts = [String(configuration.height), ...configuration.sections.map((s) => String(s.width)), String(configuration.depth)];
  const last = parts.length - 1;
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < last && (i === 0 || i === last - 1 ? '×' : '+')}
          {i < last && <wbr />}
        </span>
      ))}{' '}
      {unit}
    </>
  );
}

/** Secondary line action: compact text, full 44px touch target. */
const LINE_ACTION =
  'inline-flex min-h-11 items-center px-2 text-sm text-steel underline-offset-4 transition-colors hover:text-foreground hover:underline';

function CartRow({
  item,
  modelName,
  locale,
  color,
  delivery,
  error,
  maxQuantity,
  onRemove,
  onDuplicate,
  onQuantityChange,
}: {
  item: CartItem;
  modelName: string;
  locale: Locale;
  color?: ColorOption;
  delivery?: DeliveryMethod;
  error?: string;
  /** Highest quantity this line may reach within the order's kit limit. */
  maxQuantity: number;
  onRemove: () => void;
  onDuplicate: () => void;
  onQuantityChange: (quantity: number) => void;
}) {
  const editHref = localizePath(`/configurator?${configurationToShareQuery(item.configuration)}`, locale);
  const { configuration, priceSnapshot } = item;
  const quantityId = `cart-qty-${item.id}`;
  const specs = [
    shelvesLabel(configuration.shelves, locale),
    t(CR['CR-009'], locale, { N: configuration.sections.length }),
    t(CT['CT-024'], locale, { N: configuration.loadCapacity }),
    color ? pick(color.name, locale) : null,
  ].filter(Boolean);

  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-5 min-[390px]:grid-cols-[6.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6 sm:p-5 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
      {/* Thumbnail: the load caption the preview overlays is already in the spec line below. */}
      <ShelvingPreview
        config={configuration}
        color={color}
        presentation
        tightFraming
        showLoadCaption={false}
        className="aspect-square w-full self-start sm:aspect-[4/3]"
      />

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl">{modelName}</h2>
          <p className="mono mt-1.5 text-sm">
            <Dimensions configuration={configuration} unit={t(G['G-008'], locale)} />
          </p>
          <p className="mt-1 text-[13px] leading-snug text-steel">{specs.join(' · ')}</p>
          {delivery && <p className="mt-0.5 text-[13px] leading-snug text-steel">{pick(delivery.name, locale)}</p>}
        </div>

        <div className="shrink-0 sm:text-right">
          {priceSnapshot ? (
            <>
              <PriceTag value={priceSnapshot.breakdown.total} size="md" className="block whitespace-nowrap sm:text-xl" />
              {configuration.quantity > 1 && (
                <p className="mono mt-0.5 text-xs text-steel">{t(CR['CR-014'], locale, { price: formatPrice(priceSnapshot.breakdown.unitTotal) })}</p>
              )}
            </>
          ) : error ? (
            <span className="text-sm font-medium text-danger">{t(CR['CR-006'], locale)}</span>
          ) : (
            <span className="text-sm text-steel">{t(CR['CR-007'], locale)}</span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="col-span-2 border border-danger bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-1 sm:col-start-2">
          {error} {t(CR['CR-008'], locale)}
        </p>
      )}

      <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1 sm:col-span-1 sm:col-start-2 sm:border-t sm:border-line sm:pt-3">
        <div className="flex items-center gap-3">
          <label htmlFor={quantityId} className="text-sm text-steel">
            {t(CR['CR-010'], locale)}
          </label>
          <div className="grid h-11 grid-cols-[2.75rem_3rem_2.75rem] border border-line bg-surface">
            <button
              type="button"
              aria-label={t(CF['CF-040'], locale)}
              aria-controls={quantityId}
              onClick={() => onQuantityChange(configuration.quantity - 1)}
              disabled={configuration.quantity <= MIN_QUANTITY}
              className="grid place-items-center text-base transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-30"
            >
              −
            </button>
            <input
              id={quantityId}
              type="number"
              inputMode="numeric"
              min={MIN_QUANTITY}
              max={maxQuantity}
              value={configuration.quantity}
              onChange={(e) => onQuantityChange(Number(e.target.value) || 1)}
              className="mono h-full w-full border-x border-line bg-surface text-center text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:-outline-offset-2"
            />
            <button
              type="button"
              aria-label={t(CF['CF-041'], locale)}
              aria-controls={quantityId}
              onClick={() => onQuantityChange(configuration.quantity + 1)}
              disabled={configuration.quantity >= maxQuantity}
              className="grid place-items-center text-base transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
        <div className="-mx-2 flex flex-wrap items-center">
          <Link href={editHref} className={LINE_ACTION}>
            {t(CR['CR-011'], locale)}
          </Link>
          <button type="button" onClick={onDuplicate} className={LINE_ACTION}>
            {t(CR['CR-012'], locale)}
          </button>
          <button type="button" onClick={onRemove} className={`${LINE_ACTION} hover:!text-danger`}>
            {t(CR['CR-013'], locale)}
          </button>
        </div>
      </div>
    </li>
  );
}
