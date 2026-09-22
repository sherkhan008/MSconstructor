import { CUSTOMER_PAYMENT_METHODS } from '@/lib/pricing/schema';
import type { PaymentPreference } from '@/lib/types/domain';
import type { Locale } from '@/lib/i18n/locales';
import { t, type Entry } from '@/lib/i18n/format';
import { CK } from '@/lib/i18n/strings';

export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number];

/** Covers the full domain enum (including KASPI_PAY/KASPI_QR) so a historical
 * or internally-set order never renders a raw enum value on the success
 * page, even though customers can only select the three below in checkout.
 * Owner-reviewed CSV rows CK-023…CK-030 (ru + kk). */
const PAYMENT_METHOD_TEXT: Record<PaymentPreference, Entry> = {
  BANK_TRANSFER: CK['CK-023'],
  BANK_INVOICE: CK['CK-024'],
  CASH: CK['CK-025'],
  KASPI_PAY: CK['CK-026'],
  KASPI_QR: CK['CK-027'],
};

const PAYMENT_METHOD_DESCRIPTION_TEXT: Record<CustomerPaymentMethod, Entry> = {
  BANK_TRANSFER: CK['CK-028'],
  BANK_INVOICE: CK['CK-029'],
  CASH: CK['CK-030'],
};

/** Russian labels — the admin panel and order documents are Russian-only. */
export const PAYMENT_METHOD_LABEL = Object.fromEntries(
  Object.entries(PAYMENT_METHOD_TEXT).map(([key, entry]) => [key, entry.ru]),
) as Record<PaymentPreference, string>;

export const PAYMENT_METHOD_DESCRIPTION = Object.fromEntries(
  Object.entries(PAYMENT_METHOD_DESCRIPTION_TEXT).map(([key, entry]) => [key, entry.ru]),
) as Record<CustomerPaymentMethod, string>;

/** Customer-facing label in `locale`; an unknown value is shown as is. */
export function paymentMethodLabel(method: string, locale: Locale): string {
  const entry = PAYMENT_METHOD_TEXT[method as PaymentPreference];
  return entry ? t(entry, locale) : method;
}

export function paymentMethodDescription(method: CustomerPaymentMethod, locale: Locale): string {
  return t(PAYMENT_METHOD_DESCRIPTION_TEXT[method], locale);
}
