import { assertDatabaseConfigured, hasDatabase } from '@/lib/env';
import type { CreatePaymentInput, PaymentRecord, PaymentStatus } from './types';

/**
 * Payment persistence. Mirrors src/lib/orders/store.ts's db/mock split.
 * Nothing currently calls `createPayment` (see types.ts for why); it exists
 * so a future payment provider has one real, working persistence seam
 * instead of needing to invent its own.
 */

const memoryPayments: PaymentRecord[] = [];

export async function createPayment(input: CreatePaymentInput): Promise<PaymentRecord> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { createPaymentInDb } = await import('./db-store');
    return createPaymentInDb(input);
  }
  const now = new Date().toISOString();
  const record: PaymentRecord = { ...input, status: input.status ?? 'PENDING', id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  memoryPayments.push(record);
  return record;
}

export async function getPaymentsByOrderId(orderId: string): Promise<PaymentRecord[]> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { getPaymentsByOrderIdFromDb } = await import('./db-store');
    return getPaymentsByOrderIdFromDb(orderId);
  }
  return memoryPayments.filter((p) => p.orderId === orderId);
}

/** Only a verified provider callback (see PaymentProvider.verifyCallback in
 * types.ts) should ever call this with anything other than PENDING/FAILED —
 * there is no client-facing route that calls it today. */
export async function updatePaymentStatus(id: string, status: PaymentStatus): Promise<void> {
  assertDatabaseConfigured('payment');
  if (hasDatabase) {
    const { updatePaymentStatusInDb } = await import('./db-store');
    return updatePaymentStatusInDb(id, status);
  }
  const payment = memoryPayments.find((p) => p.id === id);
  if (payment) {
    payment.status = status;
    payment.updatedAt = new Date().toISOString();
  }
}

/** Test/dev-only escape hatch, mirrors clearMemoryOrders. */
export function clearMemoryPayments(): void {
  memoryPayments.length = 0;
}
