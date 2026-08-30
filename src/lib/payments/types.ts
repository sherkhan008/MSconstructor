/**
 * Payment domain foundation for a future online-payment provider. Nothing in
 * the app creates a Payment record yet: the three payment methods a customer
 * can currently select (bank transfer, invoice, cash — see
 * src/lib/orders/payment-methods.ts) are all manager-confirmed offline, so
 * there is no real payment event to record for them (see src/app/api/orders
 * /route.ts). This file exists so a future provider integration has a
 * single, already-reviewed shape to implement against instead of inventing
 * its own ad hoc fields.
 *
 * The Prisma `Payment.status` column stays a plain String (see
 * prisma/schema.prisma) — this `PaymentStatus` union is the TypeScript-level
 * source of truth for its valid values, introduced now specifically to avoid
 * an unnecessary migration.
 */

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface PaymentRecord {
  id: string;
  orderId: string;
  /** Provider/method identifier, e.g. a future 'KASPI_QR' — free-form on
   * purpose, mirrors the Prisma `Payment.type` column. */
  type: string;
  status: PaymentStatus;
  amount: number;
  externalId?: string;
  invoiceNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreatePaymentInput = Omit<PaymentRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
  status?: PaymentStatus;
};

/**
 * The contract a real online-payment provider (e.g. Kaspi) will implement.
 * Conceptual future flow:
 *
 *   Order → createPayment() → Payment(PENDING) → customer is redirected to
 *   (or shown a QR from) the provider → the provider sends a callback →
 *   verifyCallback() checks its authenticity and returns the real status →
 *   only then does the Payment (and, separately, the Order) move to
 *   SUCCEEDED/PAID.
 *
 * No client request may perform that final transition directly — only a
 * verified provider callback may.
 */
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<PaymentRecord>;
  verifyCallback(payload: unknown): Promise<{ externalId: string; status: PaymentStatus }>;
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
}
