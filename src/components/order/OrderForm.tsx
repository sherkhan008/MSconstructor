'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { Dimensions, EmptyCart } from '@/components/cart/CartClient';
import { formatPrice } from '@/lib/money';
import { trackEvent } from '@/lib/analytics';
import { shelvesLabel } from '@/lib/plural';
import { CUSTOMER_PAYMENT_METHODS, schemasFor, type OrderFormInput } from '@/lib/pricing/schema';
import { paymentMethodDescription, paymentMethodLabel } from '@/lib/orders/payment-methods';
import { useCartStore } from '@/store/cart-store';
import { exceedsKitLimit, MAX_KITS_PER_ORDER } from '@/lib/orders/limits';
import type { DeliveryMethod } from '@/lib/types/domain';
import { pick, t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { apiHeaders } from '@/lib/i18n/request';
import { CF, CK, CR, ER, G, H, VL } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

const FORM_ID = 'checkout-form';

/** Form fields a server fieldError may name — anything else stays in the summary message only. */
const FORM_FIELDS = new Set<keyof OrderFormInput>([
  'customerType',
  'fullName',
  'phone',
  'whatsapp',
  'email',
  'city',
  'companyName',
  'binIin',
  'deliveryAddress',
  'paymentPreference',
  'comment',
]);

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
  const serverErrorRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
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
  // A cart persisted over the physical-kit limit is shown as-is (never
  // trimmed) but cannot be submitted; the order API rejects it regardless.
  const overKitLimit = exceedsKitLimit(items);

  useEffect(() => {
    if (sameAsPhone) setValue('whatsapp', phone);
  }, [sameAsPhone, phone, setValue]);

  // A delivery method may require a real address (e.g. city/country
  // delivery), even though pickup does not — derived the same way the
  // server derives it (per-item deliveryId against the catalog), never
  // guessed. This is a UX hint only; the server enforces it either way.
  const usedDeliveryIds = new Set(items.map((item) => item.configuration.deliveryId));
  const usedDeliveryMethods = deliveryMethods.filter((d) => usedDeliveryIds.has(d.id));
  const addressRequired = usedDeliveryMethods.some((d) => d.requiresAddress);

  /** A cart line's model name in the page locale (the stored name is a fallback). */
  function modelNameOf(item: (typeof items)[number]): string {
    const model = models.find((m) => m.slug === item.modelSlug);
    return model ? pick(model.name, locale) : item.modelName;
  }

  async function onSubmit(data: OrderFormInput) {
    if (overKitLimit) return;
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
        // The server names the field it rejected: show its message next to
        // that field too, and take the customer there. Presentation only —
        // the server's verdict is not reinterpreted.
        const fieldErrors: { field?: string; message?: string }[] = Array.isArray(result.fieldErrors) ? result.fieldErrors : [];
        const known = fieldErrors.filter((e) => FORM_FIELDS.has(e.field as keyof OrderFormInput) && e.message);
        known.forEach((e, index) => setError(e.field as keyof OrderFormInput, { type: 'server', message: e.message }, { shouldFocus: index === 0 }));
        if (known.length === 0) requestAnimationFrame(() => serverErrorRef.current?.focus());
        return;
      }
      trackEvent('order_completed', { orderNumber: result.orderNumber, total: result.grandTotal });
      clear();
      router.push(localizePath(`/order/success?number=${encodeURIComponent(result.orderNumber)}`, locale));
    } catch {
      setServerError(t(ER['ER-018'], locale));
      requestAnimationFrame(() => serverErrorRef.current?.focus());
    }
  }

  if (items.length === 0) {
    return <EmptyCart message={t(CK['CK-002'], locale)} locale={locale} />;
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_23rem] xl:gap-10">
      <form
        id={FORM_ID}
        onSubmit={handleSubmit(onSubmit)}
        className="min-w-0 divide-y divide-line border border-line bg-surface"
        noValidate
        // The floating WhatsApp button steps aside for the whole form and the
        // summary below, not just the submit button: at phone widths it
        // otherwise sits over inputs, validation messages and the total.
        data-fab-avoid
      >
        <fieldset className="min-w-0 p-5 sm:p-6">
          <legend className="float-left mb-4 w-full">
            <SectionTitle index={1}>{t(CK['CK-003'], locale)}</SectionTitle>
          </legend>
          <div className="clear-left grid grid-cols-2 gap-2">
            <ChoiceOption label={t(CK['CK-004'], locale)} checked={customerType === 'INDIVIDUAL'}>
              <input type="radio" value="INDIVIDUAL" {...register('customerType')} className="h-4 w-4 shrink-0 accent-foreground" />
            </ChoiceOption>
            <ChoiceOption label={t(CK['CK-005'], locale)} checked={customerType === 'LEGAL_ENTITY'}>
              <input type="radio" value="LEGAL_ENTITY" {...register('customerType')} className="h-4 w-4 shrink-0 accent-foreground" />
            </ChoiceOption>
          </div>

          {/* Unregistered when hidden: a half-typed BIN left behind after
              switching back to an individual must not keep failing the
              schema's format check with no visible field to show it on. */}
          {customerType === 'LEGAL_ENTITY' && (
            <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
              <Field label={t(CK['CK-013'], locale)} error={errors.companyName?.message}>
                {(a11y) => <input {...register('companyName', { shouldUnregister: true })} {...a11y} className="input" autoComplete="organization" />}
              </Field>
              <Field label={t(CK['CK-014'], locale)} error={errors.binIin?.message}>
                {(a11y) => <input {...register('binIin', { shouldUnregister: true })} {...a11y} className="input mono" inputMode="numeric" autoComplete="off" />}
              </Field>
            </div>
          )}
        </fieldset>

        <section aria-labelledby="checkout-contacts" className="p-5 sm:p-6">
          <SectionTitle id="checkout-contacts" index={2}>
            {t(H['H-005'], locale)}
          </SectionTitle>
          <div className="mt-4 flex flex-col gap-5">
            <Field label={t(CK['CK-006'], locale)} error={errors.fullName?.message}>
              {(a11y) => <input {...register('fullName')} {...a11y} className="input" autoComplete="name" />}
            </Field>

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
                <Field label={t(CK['CK-007'], locale)} error={errors.phone?.message}>
                  {(a11y) => (
                    <input
                      {...register('phone')}
                      {...a11y}
                      type="tel"
                      inputMode="tel"
                      placeholder={t(CK['CK-008'], locale)}
                      className="input mono"
                      autoComplete="tel"
                    />
                  )}
                </Field>
                <Field label={t(CK['CK-009'], locale)} error={errors.whatsapp?.message}>
                  {(a11y) => (
                    <input
                      {...register('whatsapp')}
                      {...a11y}
                      type="tel"
                      inputMode="tel"
                      placeholder={t(CK['CK-008'], locale)}
                      className="input mono disabled:bg-surface-muted disabled:text-steel"
                      autoComplete="tel"
                      disabled={sameAsPhone}
                    />
                  )}
                </Field>
              </div>
              <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-sm text-steel">
                <input
                  type="checkbox"
                  checked={sameAsPhone}
                  onChange={(e) => setSameAsPhone(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-foreground"
                />
                {t(CK['CK-010'], locale)}
              </label>
            </div>

            <Field label={t(CK['CK-011'], locale)} error={errors.email?.message}>
              {(a11y) => <input {...register('email')} {...a11y} type="email" className="input" autoComplete="email" />}
            </Field>
          </div>
        </section>

        <section aria-labelledby="checkout-delivery" className="p-5 sm:p-6">
          <SectionTitle id="checkout-delivery" index={3}>
            {t(CF['CF-051'], locale)}
          </SectionTitle>
          {usedDeliveryMethods.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {usedDeliveryMethods.map((method) => (
                <li key={method.id} className="border-l-2 border-accent bg-background px-4 py-3">
                  <p className="text-sm font-medium">{pick(method.name, locale)}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-steel">{pick(method.description, locale)}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label={t(CK['CK-012'], locale)} error={errors.city?.message}>
              {(a11y) => <input {...register('city')} {...a11y} className="input" autoComplete="address-level2" />}
            </Field>
            <Field
              label={addressRequired ? t(CK['CK-015'], locale) : t(CK['CK-016'], locale)}
              error={errors.deliveryAddress?.message}
            >
              {(a11y) => (
                <input
                  {...register('deliveryAddress', {
                    validate: (v) => !addressRequired || Boolean(v && v.trim()) || t(VL['VL-008'], locale),
                  })}
                  {...a11y}
                  className="input"
                  autoComplete="street-address"
                />
              )}
            </Field>
          </div>
        </section>

        <section aria-labelledby="checkout-payment" className="p-5 sm:p-6">
          <SectionTitle id="checkout-payment" index={4}>
            <RequiredText text={t(CK['CK-017'], locale)} />
          </SectionTitle>
          <select
            {...register('paymentPreference', {
              onChange: (e) => trackEvent('payment_method_selected', { method: e.target.value }),
            })}
            aria-labelledby="checkout-payment"
            aria-describedby="checkout-payment-description"
            aria-invalid={errors.paymentPreference ? true : undefined}
            className="input mt-4 cursor-pointer"
          >
            {CUSTOMER_PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {paymentMethodLabel(value, locale)}
              </option>
            ))}
          </select>
          {paymentPreference && (
            <p id="checkout-payment-description" className="mt-2 text-[13px] leading-snug text-steel">
              {paymentMethodDescription(paymentPreference, locale)}
            </p>
          )}
          {errors.paymentPreference?.message && (
            <p className="mt-1.5 text-[13px] text-danger">{errors.paymentPreference.message}</p>
          )}

          <div className="mt-6">
            <Field label={t(CK['CK-018'], locale)} error={errors.comment?.message}>
              {(a11y) => <textarea {...register('comment')} {...a11y} rows={3} className="input resize-y" />}
            </Field>
          </div>
        </section>
      </form>

      <aside
        aria-labelledby="checkout-summary-title"
        className="border border-line border-t-2 border-t-foreground bg-surface p-5 sm:p-6 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]"
        data-fab-avoid
      >
        <h2 id="checkout-summary-title" className="font-display text-xl">
          {t(CK['CK-021'], locale)}
        </h2>
        <ul className="mt-4 divide-y divide-line border-y border-line lg:max-h-[min(22rem,calc(100dvh-var(--header-height)-24rem))] lg:overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {modelNameOf(item)}
                  {item.configuration.quantity > 1 && <span className="mono font-normal text-steel"> × {item.configuration.quantity}</span>}
                </p>
                <p className="mono mt-0.5 text-xs text-steel">
                  <Dimensions configuration={item.configuration} unit={t(G['G-008'], locale)} />
                </p>
                <p className="mt-0.5 text-xs text-steel">
                  {shelvesLabel(item.configuration.shelves, locale)} · {t(CR['CR-009'], locale, { N: item.configuration.sections.length })}
                </p>
              </div>
              <span className="mono shrink-0 text-sm font-semibold">{item.priceSnapshot ? formatPrice(item.priceSnapshot.breakdown.total) : '…'}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-steel">{t(CF['CF-064'], locale)}</span>
          <PriceTag value={total} size="lg" className="whitespace-nowrap" />
        </div>
        {hasIndividualDelivery && <p className="mt-2 text-[13px] leading-snug text-blueprint">{t(ER['ER-024'], locale)}</p>}
        <p className="mt-2 text-xs leading-snug text-steel">{t(CK['CK-022'], locale)}</p>

        {overKitLimit && (
          <p role="alert" data-testid="checkout-kit-limit" className="mt-4 border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            {t(VL['VL-018'], locale, { N: MAX_KITS_PER_ORDER })} {t(CR['CR-018'], locale)}
          </p>
        )}

        {serverError && (
          <div
            ref={serverErrorRef}
            role="alert"
            tabIndex={-1}
            className="mt-4 border border-danger bg-danger-soft px-4 py-3 text-sm text-danger outline-none"
          >
            <p className="font-medium">{serverError}</p>
            {serverErrorDetails.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-[13px]">
                {serverErrorDetails.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-5">
          <Button
            type="submit"
            form={FORM_ID}
            variant="accent"
            size="lg"
            disabled={isSubmitting || overKitLimit}
            aria-busy={isSubmitting}
            className="min-h-12 w-full !whitespace-normal text-center"
          >
            {isSubmitting ? t(CK['CK-019'], locale) : t(CK['CK-020'], locale)}
          </Button>
        </div>
      </aside>
    </div>
  );
}

/** Numbered form step heading — the number is decoration, the text is the name. */
function SectionTitle({ id, index, children }: { id?: string; index: number; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-baseline gap-3 font-display text-xl">
      <span aria-hidden="true" className="mono text-sm font-medium text-steel">
        {String(index).padStart(2, '0')}
      </span>
      <span>{children}</span>
    </h2>
  );
}

/** A label whose owner-approved text ends in " *": the asterisk is kept (it
 * is part of the accessible name) and only tinted as the required marker. */
function RequiredText({ text }: { text: string }) {
  if (!text.endsWith(' *')) return <>{text}</>;
  return (
    <>
      {text.slice(0, -2)} <span className="text-accent-strong">*</span>
    </>
  );
}

function ChoiceOption({ label, checked, children }: { label: string; checked: boolean; children: ReactNode }) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center gap-3 border px-3 py-2 text-sm leading-tight transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blueprint sm:px-4 ${
        checked ? 'border-foreground bg-background font-medium' : 'border-line hover:border-line-strong'
      }`}
    >
      {children}
      {label}
    </label>
  );
}

type FieldA11y = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

/** Visible label above the control, error directly under it and wired to it. */
function Field({ label, error, children }: { label: string; error?: string; children: (a11y: FieldA11y) => ReactNode }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-snug">
        <RequiredText text={label} />
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined })}
      {error && (
        <p id={errorId} className="text-[13px] leading-snug text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
