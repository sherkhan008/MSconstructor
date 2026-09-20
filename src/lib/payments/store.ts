import { assertDatabaseConfigured, hasDatabase } from '@/lib/env';
import {
  PAYMENT_CURRENCY,
  pendingPaymentKey,
  sanitizeFailureReason,
  type CreatePaymentInput,
  type PaymentRecord,
  type SettledPaymentStatus,
} from './types';

/**
 * Payment persistence. Mirrors src/lib/orders/store.ts's db/mock split: with a
 * PostgreSQL DATABASE_URL everything routes through Prisma, otherwise it lives
 * in a per-process array so the flow can be exercised with no infrastructure.
 *
 * The one invariant both paths enforce identically: at most one PENDING
 * attempt per (orderId, provider). In the database that is a unique index on
 * `pendingKey`; here it is the same key checked in code. See
 * pendingPaymentKey() in types.ts for why.
 */

const memoryPayments: PaymentRecord[] = [];

/**
 * Opens an attempt, or returns the one that is already open for this
 * order+provider.
 *
 * `created: false` means an existing open attempt was reused — the caller
 * must not treat it as a new payable transaction. This is the idempotency
 * point for the whole feature: a double-submitted checkout, a retried
 * request and a replayed one all converge on the same Payment row.
 */
export async function createOrReusePendingPayment(
  input: CreatePaymentInput,
): Promise<{ payment: PaymentRecord; created: boolean }> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { createOrReusePendingPaymentInDb } = await import('./db-store');
    return createOrReusePendingPaymentInDb(input);
  }

  const key = pendingPaymentKey(input.orderId, input.provider);
  const existing = memoryPayments.find((p) => p.status === 'PENDING' && pendingPaymentKey(p.orderId, p.provider) === key);
  if (existing) return { payment: existing, created: false };

  const now = new Date().toISOString();
  const payment: PaymentRecord = {
    id: crypto.randomUUID(),
    orderId: input.orderId,
    provider: input.provider,
    status: 'PENDING',
    amount: input.amount,
    currency: PAYMENT_CURRENCY,
    invoiceNumber: input.invoiceNumber,
    createdAt: now,
    updatedAt: now,
  };
  memoryPayments.push(payment);
  return { payment, created: true };
}

export async function getPaymentById(id: string): Promise<PaymentRecord | undefined> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { getPaymentByIdFromDb } = await import('./db-store');
    return getPaymentByIdFromDb(id);
  }
  return memoryPayments.find((p) => p.id === id);
}

export async function getPaymentsByOrderId(orderId: string): Promise<PaymentRecord[]> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { getPaymentsByOrderIdFromDb } = await import('./db-store');
    return getPaymentsByOrderIdFromDb(orderId);
  }
  return memoryPayments.filter((p) => p.orderId === orderId);
}

/** Records the provider's identifier for an attempt the provider just opened.
 * Status is untouched — learning an external id is not evidence of payment. */
export async function attachPaymentExternalId(id: string, externalId: string): Promise<void> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { attachPaymentExternalIdInDb } = await import('./db-store');
    return attachPaymentExternalIdInDb(id, externalId);
  }
  const payment = memoryPayments.find((p) => p.id === id);
  if (payment) {
    payment.externalId = externalId;
    payment.updatedAt = new Date().toISOString();
  }
}

/**
 * Closes an open attempt.
 *
 * Only PENDING rows are matched, so a settled attempt can never be re-settled
 * — in particular, a PAID attempt cannot be walked back to FAILED, and a
 * FAILED one cannot later be upgraded to PAID by a replayed call. Clearing
 * `pendingKey` is what frees the order to be paid for again.
 *
 * Reaching PAID additionally requires a verified provider answer; the only
 * caller that passes 'PAID' is confirmPaymentWithProvider() in service.ts.
 * Returns false when nothing was open to settle.
 */
export async function settlePayment(
  id: string,
  status: SettledPaymentStatus,
  failureReason?: string,
): Promise<boolean> {
  assertDatabaseConfigured('payment');
  const reason = status === 'PAID' ? undefined : sanitizeFailureReason(failureReason);

  if (hasDatabase) {
    const { settlePaymentInDb } = await import('./db-store');
    return settlePaymentInDb(id, status, reason);
  }

  const payment = memoryPayments.find((p) => p.id === id && p.status === 'PENDING');
  if (!payment) return false;
  payment.status = status;
  payment.failureReason = reason;
  payment.paidAt = status === 'PAID' ? new Date().toISOString() : undefined;
  payment.updatedAt = new Date().toISOString();
  return true;
}

/** Test/dev-only escape hatch, mirrors clearMemoryOrders. */
export function clearMemoryPayments(): void {
  memoryPayments.length = 0;
}

/** Test-only: lets a rejected-request test assert that nothing was created,
 * rather than only inferring it from the HTTP status. */
export function countMemoryPayments(): number {
  return memoryPayments.length;
}
