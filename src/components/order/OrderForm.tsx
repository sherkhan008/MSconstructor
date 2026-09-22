'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { formatPrice } from '@/lib/money';
import { trackEvent } from '@/lib/analytics';
import { CUSTOMER_PAYMENT_METHODS, schemasFor, type OrderFormInput } from '@/lib/pricing/schema';
import { paymentMethodDescription, paymentMethodLabel } from '@/lib/orders/payment-methods';
import { useCartStore } from '@/store/cart-store';
import type { DeliveryMethod } from '@/lib/types/domain';
import { pick, t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { apiHeaders } from '@/lib/i18n/request';
import { CF, CK, CR, ER, VL } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

export function OrderForm({
  deliveryMethods = [],
  models = [],
}: {
  deliveryMethods?: DeliveryMethod[];
  /** Public model names, to show each cart line in the page locale. */
  models?: { slug: string; name: { ru: string; kk: string } }[];
}) {
  const locale = useLocale();
  const items = useCartStore((s) => s.items);
  const clear = useCartStore((s) => s.clear);
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorDetails, setServerErrorDetails] = useState<string[]>([]);
  const [sameAsPhone, setSameAsPhone] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<OrderFormInput>({
    resolver: zodResolver(schemasFor(locale).orderFormSchema),
    defaultValues: { customerType: 'INDIVIDUAL', paymentPreference: 'BANK_TRANSFER' },
  });

  const customerType = watch('customerType');
  const paymentPreference = watch('paymentPreference');
  const phone = watch('phone');
  const total = items.reduce((sum, item) => sum + (item.priceSnapshot?.breakdown.total ?? 0), 0);
  // Same note as the cart: delivery calculated individually is not in the
  // total. The server sets deliveryNote only for that case (ER-024); it is
  // rendered in the page locale, so a snapshot priced on the other-language
  // page never shows up in the wrong language.
  const hasIndividualDelivery = items.some((item) => Boolean(item.priceSnapshot?.deliveryNote));

  useEffect(() => {
    if (sameAsPhone) setValue('whatsapp', phone);
  }, [sameAsPhone, phone, setValue]);

  // A delivery method may require a real address (e.g. city/country
  // delivery), even though pickup does not — derived the same way the
  // server derives it (per-item deliveryId against the catalog), never
  // guessed. This is a UX hint only; the server enforces it either way.
  const usedDeliveryIds = new Set(items.map((item) => item.configuration.deliveryId));
  const addressRequired = deliveryMethods.some((d) => usedDeliveryIds.has(d.id) && d.requiresAddress);

  /** A cart line's model name in the page locale (the stored name is a fallback). */
  function modelNameOf(item: (typeof items)[number]): string {
    const model = models.find((m) => m.slug === item.modelSlug);
    return model ? pick(model.name, locale) : item.modelName;
  }

  async function onSubmit(data: OrderFormInput) {
    setServerError(null);
    setServerErrorDetails([]);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: apiHeaders(locale),
        body: JSON.stringify({ ...data, items: items.map((item) => ({ configuration: item.configuration })) }),
      });
      const result = await response.json();
      if (!result.ok) {
        setServerError(result.message ?? t(ER['ER-017'], locale));
        setServerErrorDetails(Array.isArray(result.details) ? result.details : []);
        return;
      }
      trackEvent('order_completed', { orderNumber: result.orderNumber, total: result.grandTotal });
      clear();
      router.push(localizePath(`/order/success?number=${encodeURIComponent(result.orderNumber)}`, locale));
    } catch {
      setServerError(t(ER['ER-018'], locale));
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-steel">{t(CK['CK-002'], locale)}</p>
        <LinkButton href={localizePath('/configurator', locale)}>{t(CR['CR-003'], locale)}</LinkButton>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <div>
          <span className="tech-label">{t(CK['CK-003'], locale)}</span>
          <div className="mt-2 flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="INDIVIDUAL" {...register('customerType')} /> {t(CK['CK-004'], locale)}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="LEGAL_ENTITY" {...register('customerType')} /> {t(CK['CK-005'], locale)}
            </label>
          </div>
        </div>

        <Field label={t(CK['CK-006'], locale)} error={errors.fullName?.message}>
          <input {...register('fullName')} className="input" autoComplete="name" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t(CK['CK-007'], locale)} error={errors.phone?.message}>
            <input {...register('phone')} placeholder={t(CK['CK-008'], locale)} className="input mono" autoComplete="tel" />
          </Field>
          <Field label={t(CK['CK-009'], locale)} error={errors.whatsapp?.message}>
            <input
              {...register('whatsapp')}
              placeholder={t(CK['CK-008'], locale)}
              className="input mono"
              autoComplete="tel"
              disabled={sameAsPhone}
            />
          </Field>
        </div>
        <label className="-mt-3 flex items-center gap-2 text-xs text-steel">
          <input
            type="checkbox"
            checked={sameAsPhone}
            onChange={(e) => setSameAsPhone(e.target.checked)}
          />
          {t(CK['CK-010'], locale)}
        </label>

        <Field label={t(CK['CK-011'], locale)} error={errors.email?.message}>
          <input {...register('email')} type="email" className="input" autoComplete="email" />
        </Field>

        <Field label={t(CK['CK-012'], locale)} error={errors.city?.message}>
          <input {...register('city')} className="input" autoComplete="address-level2" />
        </Field>

        {customerType === 'LEGAL_ENTITY' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t(CK['CK-013'], locale)} error={errors.companyName?.message}>
              <input {...register('companyName')} className="input" />
            </Field>
            <Field label={t(CK['CK-014'], locale)} error={errors.binIin?.message}>
              <input {...register('binIin')} className="input mono" />
            </Field>
          </div>
        )}

        <Field
          label={addressRequired ? t(CK['CK-015'], locale) : t(CK['CK-016'], locale)}
          error={errors.deliveryAddress?.message}
        >
          <input
            {...register('deliveryAddress', {
              validate: (v) => !addressRequired || Boolean(v && v.trim()) || t(VL['VL-008'], locale),
            })}
            className="input"
            autoComplete="street-address"
          />
        </Field>

        <div>
          <span className="tech-label">{t(CK['CK-017'], locale)}</span>
          <select
            {...register('paymentPreference', {
              onChange: (e) => trackEvent('payment_method_selected', { method: e.target.value }),
            })}
            className="input mt-2"
          >
            {CUSTOMER_PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {paymentMethodLabel(value, locale)}
              </option>
            ))}
          </select>
          {paymentPreference && (
            <p className="mt-1 text-xs text-steel">{paymentMethodDescription(paymentPreference, locale)}</p>
          )}
          {errors.paymentPreference?.message && (
            <span className="text-xs text-danger">{errors.paymentPreference.message}</span>
          )}
        </div>

        <Field label={t(CK['CK-018'], locale)} error={errors.comment?.message}>
          <textarea {...register('comment')} rows={3} className="input resize-none" />
        </Field>

        {serverError && (
          <div className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            <p>{serverError}</p>
            {serverErrorDetails.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {serverErrorDetails.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div data-fab-avoid>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? t(CK['CK-019'], locale) : t(CK['CK-020'], locale)}
          </Button>
        </div>
      </form>

      <aside className="flex flex-col gap-3 border border-line bg-surface p-5 lg:sticky lg:top-20">
        <h2 className="font-display text-xl">{t(CK['CK-021'], locale)}</h2>
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span className="text-steel">
                {modelNameOf(item)} ({item.configuration.height}×{item.configuration.sections.map((s) => s.width).join('+')}×
                {item.configuration.depth})
                {item.configuration.quantity > 1 ? ` × ${item.configuration.quantity}` : ''}
              </span>
              <span className="mono shrink-0">{item.priceSnapshot ? formatPrice(item.priceSnapshot.breakdown.total) : '…'}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-line pt-3">
          <div className="tech-label">{t(CF['CF-064'], locale)}</div>
          <PriceTag value={total} size="lg" />
          {hasIndividualDelivery && <p className="mt-1 text-xs text-steel">{t(ER['ER-024'], locale)}</p>}
          <p className="mt-1 text-xs text-steel">{t(CK['CK-022'], locale)}</p>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="tech-label">{label}</span>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </label>
  );
}
