'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { PriceTag } from '@/components/ui/PriceTag';
import { formatPrice } from '@/lib/money';
import { trackEvent } from '@/lib/analytics';
import { orderFormSchema, type OrderFormInput } from '@/lib/pricing/schema';
import { useCartStore } from '@/store/cart-store';

const PAYMENT_LABEL: Record<string, string> = {
  BANK_TRANSFER: 'Безналичный расчёт',
  BANK_INVOICE: 'Оплата по счёту',
  CASH: 'Наличными',
  KASPI_PAY: 'Kaspi Pay (скоро)',
  KASPI_QR: 'Kaspi QR (скоро)',
};

export function OrderForm() {
  const items = useCartStore((s) => s.items);
  const clear = useCartStore((s) => s.clear);
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<OrderFormInput>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: { customerType: 'INDIVIDUAL', paymentPreference: 'BANK_TRANSFER' },
  });

  const customerType = watch('customerType');
  const total = items.reduce((sum, item) => sum + (item.priceSnapshot?.breakdown.total ?? 0), 0);

  async function onSubmit(data: OrderFormInput) {
    setServerError(null);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, items: items.map((item) => ({ configuration: item.configuration })) }),
      });
      const result = await response.json();
      if (!result.ok) {
        setServerError(result.message ?? 'Не удалось оформить заказ');
        return;
      }
      trackEvent('order_completed', { orderNumber: result.orderNumber, total: result.grandTotal });
      clear();
      router.push(`/order/success?number=${encodeURIComponent(result.orderNumber)}`);
    } catch {
      setServerError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-steel">В корзине нет ни одной конфигурации.</p>
        <LinkButton href="/configurator">Открыть конфигуратор</LinkButton>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <div>
          <span className="tech-label">Тип клиента</span>
          <div className="mt-2 flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="INDIVIDUAL" {...register('customerType')} /> Физическое лицо
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="LEGAL_ENTITY" {...register('customerType')} /> Юридическое лицо
            </label>
          </div>
        </div>

        <Field label="ФИО / Контактное лицо" error={errors.fullName?.message}>
          <input {...register('fullName')} className="input" autoComplete="name" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Телефон" error={errors.phone?.message}>
            <input {...register('phone')} placeholder="+7 700 000 00 00" className="input mono" autoComplete="tel" />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <input {...register('email')} type="email" className="input" autoComplete="email" />
          </Field>
        </div>

        <Field label="Город" error={errors.city?.message}>
          <input {...register('city')} className="input" autoComplete="address-level2" />
        </Field>

        {customerType === 'LEGAL_ENTITY' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Название компании" error={errors.companyName?.message}>
              <input {...register('companyName')} className="input" />
            </Field>
            <Field label="БИН" error={errors.binIin?.message}>
              <input {...register('binIin')} className="input mono" />
            </Field>
          </div>
        )}

        <Field label="Адрес доставки (если нужна доставка)" error={errors.deliveryAddress?.message}>
          <input {...register('deliveryAddress')} className="input" autoComplete="street-address" />
        </Field>

        <div>
          <span className="tech-label">Способ оплаты</span>
          <select {...register('paymentPreference')} className="input mt-2">
            {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <Field label="Комментарий к заказу" error={errors.comment?.message}>
          <textarea {...register('comment')} rows={3} className="input resize-none" />
        </Field>

        {serverError && <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">{serverError}</p>}

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? 'Оформляем…' : 'Подтвердить заказ'}
        </Button>
      </form>

      <aside className="flex flex-col gap-3 border border-line bg-surface p-5 lg:sticky lg:top-20">
        <h2 className="font-display text-xl">Ваш заказ</h2>
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span className="text-steel">
                {item.modelName} ({item.configuration.height}×{item.configuration.sections.map((s) => s.width).join('+')}×
                {item.configuration.depth})
                {item.configuration.quantity > 1 ? ` × ${item.configuration.quantity}` : ''}
              </span>
              <span className="mono shrink-0">{item.priceSnapshot ? formatPrice(item.priceSnapshot.breakdown.total) : '…'}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-line pt-3">
          <div className="tech-label">Итого</div>
          <PriceTag value={total} size="lg" />
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
