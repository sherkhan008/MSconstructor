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
import { useCartStore, type CartItem } from '@/store/cart-store';
import type { ColorOption } from '@/lib/types/domain';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import { pick, t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { apiHeaders } from '@/lib/i18n/request';
import { CF, CR, CT, ER, G } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

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
      fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: apiHeaders(locale),
        body: JSON.stringify(item.configuration),
      })
        .then((res) => res.json())
        .then((data) => {
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
        .catch(() => setPriceErrors((prev) => ({ ...prev, [item.id]: t(ER['ER-016'], locale) })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.id}:${i.priceSnapshot === null}`).join(',')]);

  if (!mounted) return null;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-lg text-steel">{t(CR['CR-002'], locale)}</p>
        <LinkButton href={localizePath('/configurator', locale)}>{t(CR['CR-003'], locale)}</LinkButton>
      </div>
    );
  }

  const total = items.reduce((sum, item) => sum + (item.priceSnapshot?.breakdown.total ?? 0), 0);
  const allPriced = items.every((item) => item.priceSnapshot !== null);
  // The server's note for delivery that is not in the total (regional
  // delivery is calculated individually) — shown so the total never reads as
  // delivery-included. The server sets deliveryNote only for that case
  // (ER-024); it is rendered in the page locale, so a snapshot priced on the
  // other-language page never shows up in the wrong language.
  const hasIndividualDelivery = items.some((item) => Boolean(item.priceSnapshot?.deliveryNote));

  function handleCheckout() {
    trackEvent('order_submitted', { stage: 'cart_to_checkout', items: items.length });
    router.push(localizePath('/order', locale));
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        {reconcileNotice && (
          <p className="border border-line bg-surface-muted px-4 py-3 text-sm text-steel">{reconcileNotice}</p>
        )}
        {items.map((item) => (
          <CartRow
            key={item.id}
            item={item}
            modelName={modelNameOf(item)}
            locale={locale}
            color={catalog.colors.find((c) => c.id === item.configuration.colorId)}
            error={priceErrors[item.id]}
            onRemove={() => removeItem(item.id)}
            onDuplicate={() => duplicateItem(item.id)}
            onQuantityChange={(q) => setQuantity(item.id, q)}
          />
        ))}
      </div>

      <aside className="flex flex-col gap-4 border border-line bg-surface p-5 lg:sticky lg:top-20" data-fab-avoid>
        <div>
          <div className="tech-label">{t(CR['CR-004'], locale)}</div>
          <PriceTag value={total} size="xl" />
          {hasIndividualDelivery && <p className="mt-1 text-xs text-steel">{t(ER['ER-024'], locale)}</p>}
        </div>
        <Button onClick={handleCheckout} disabled={!allPriced} size="lg">
          {t(CF['CF-067'], locale)}
        </Button>
        <LinkButton href={localizePath('/configurator', locale)} variant="outline">
          {t(CR['CR-005'], locale)}
        </LinkButton>
      </aside>
    </div>
  );
}

function CartRow({
  item,
  modelName,
  locale,
  color,
  error,
  onRemove,
  onDuplicate,
  onQuantityChange,
}: {
  item: CartItem;
  modelName: string;
  locale: Locale;
  color?: ColorOption;
  error?: string;
  onRemove: () => void;
  onDuplicate: () => void;
  onQuantityChange: (quantity: number) => void;
}) {
  const editHref = localizePath(`/configurator?${configurationToShareQuery(item.configuration)}`, locale);

  return (
    <div className="flex flex-col gap-4 border border-line p-4 sm:flex-row">
      <ShelvingPreview config={item.configuration} color={color} className="aspect-[4/3] w-full sm:w-56 shrink-0" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-xl">{modelName}</h3>
          {item.priceSnapshot ? (
            <PriceTag value={item.priceSnapshot.breakdown.total} size="md" />
          ) : error ? (
            <span className="tech-label text-danger">{t(CR['CR-006'], locale)}</span>
          ) : (
            <span className="tech-label">{t(CR['CR-007'], locale)}</span>
          )}
        </div>
        {error && (
          <p className="border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error} {t(CR['CR-008'], locale)}
          </p>
        )}
        <div className="tech-label flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {item.configuration.height}×{item.configuration.sections.map((s) => s.width).join('+')}×
            {item.configuration.depth} {t(G['G-008'], locale)}
          </span>
          <span>{shelvesLabel(item.configuration.shelves, locale)}</span>
          <span>{t(CR['CR-009'], locale, { N: item.configuration.sections.length })}</span>
          <span>{t(CT['CT-024'], locale, { N: item.configuration.loadCapacity })}</span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-sm">
            {t(CR['CR-010'], locale)}
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
            {t(CR['CR-011'], locale)}
          </Link>
          <button type="button" onClick={onDuplicate} className="text-sm text-steel hover:text-foreground">
            {t(CR['CR-012'], locale)}
          </button>
          <button type="button" onClick={onRemove} className="text-sm text-danger hover:underline">
            {t(CR['CR-013'], locale)}
          </button>
        </div>
        {item.priceSnapshot && (
          <p className="mono text-xs text-steel">{t(CR['CR-014'], locale, { price: formatPrice(item.priceSnapshot.breakdown.unitTotal) })}</p>
        )}
      </div>
    </div>
  );
}
