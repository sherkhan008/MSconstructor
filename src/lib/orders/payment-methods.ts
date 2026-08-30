import { CUSTOMER_PAYMENT_METHODS } from '@/lib/pricing/schema';
import type { PaymentPreference } from '@/lib/types/domain';

export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number];

/** Covers the full domain enum (including KASPI_PAY/KASPI_QR) so a historical
 * or internally-set order never renders a raw enum value on the success
 * page, even though customers can only select the three below in checkout. */
export const PAYMENT_METHOD_LABEL: Record<PaymentPreference, string> = {
  BANK_TRANSFER: 'Безналичный расчёт',
  BANK_INVOICE: 'Оплата по счёту',
  CASH: 'Наличными',
  KASPI_PAY: 'Kaspi Pay',
  KASPI_QR: 'Kaspi QR',
};

export const PAYMENT_METHOD_DESCRIPTION: Record<CustomerPaymentMethod, string> = {
  BANK_TRANSFER: 'Оплата банковским переводом после подтверждения заказа.',
  BANK_INVOICE: 'Для ИП и юридических лиц. Менеджер подтвердит заказ и выставит счёт.',
  CASH: 'Оплата при согласованном самовывозе/доставке.',
};
