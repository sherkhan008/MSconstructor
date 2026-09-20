import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import {
  PAYMENT_CURRENCY,
  pendingPaymentKey,
  type CreatePaymentInput,
  type PaymentCurrency,
  type PaymentRecord,
  type PaymentStatus,
  type SettledPaymentStatus,
} from './types';

/**
 * Prisma-backed payment persistence. Loaded dynamically by
 * src/lib/payments/store.ts only when DATABASE_URL points at PostgreSQL.
 */

function toPaymentRecord(row: {
  id: string;
  orderId: string;
  provider: string;
  status: string;
  amount: Prisma.Decimal;
  currency: string;
  externalId: string | null;
  invoiceNumber: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    status: row.status as PaymentStatus,
    amount: Number(row.amount),
    currency: row.currency as PaymentCurrency,
    externalId: row.externalId ?? undefined,
    invoiceNumber: row.invoiceNumber ?? undefined,
    failureReason: row.failureReason ?? undefined,
    paidAt: row.paidAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The database is the idempotency authority here, not this function.
 *
 * `pendingKey` carries a unique index, so two concurrent requests for the
 * same order+provider cannot both insert: one wins, the other gets P2002 and
 * is answered with the winner's row. A plain "check then insert" would have a
 * window between the two statements; this does not.
 */
export async function createOrReusePendingPaymentInDb(
  input: CreatePaymentInput,
): Promise<{ payment: PaymentRecord; created: boolean }> {
  const pendingKey = pendingPaymentKey(input.orderId, input.provider);

  try {
    const row = await prisma.payment.create({
      data: {
        orderId: input.orderId,
        provider: input.provider,
        pendingKey,
        status: 'PENDING',
        amount: input.amount,
        currency: PAYMENT_CURRENCY,
        invoiceNumber: input.invoiceNumber,
      },
    });
    return { payment: toPaymentRecord(row), created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;

    const existing = await prisma.payment.findUnique({ where: { pendingKey } });
    // The winner could in principle have settled (and cleared pendingKey) in
    // the moment between the two statements. Retrying once is correct: the
    // order really has no open attempt again.
    if (!existing) return createOrReusePendingPaymentInDb(input);
    return { payment: toPaymentRecord(existing), created: false };
  }
}

export async function getPaymentByIdFromDb(id: string): Promise<PaymentRecord | undefined> {
  const row = await prisma.payment.findUnique({ where: { id } });
  return row ? toPaymentRecord(row) : undefined;
}

export async function getPaymentsByOrderIdFromDb(orderId: string): Promise<PaymentRecord[]> {
  const rows = await prisma.payment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  return rows.map(toPaymentRecord);
}

export async function attachPaymentExternalIdInDb(id: string, externalId: string): Promise<void> {
  await prisma.payment.updateMany({ where: { id, status: 'PENDING' }, data: { externalId } });
}

/**
 * Compare-and-swap on `status`: the WHERE clause only matches a row that is
 * still PENDING, so settling is a one-way door even under concurrency. Two
 * callers racing to settle the same attempt cannot both win, and a replayed
 * call after the fact changes nothing (0 rows matched → false).
 */
export async function settlePaymentInDb(
  id: string,
  status: SettledPaymentStatus,
  failureReason?: string,
): Promise<boolean> {
  const updated = await prisma.payment.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status,
      failureReason,
      paidAt: status === 'PAID' ? new Date() : null,
      // Freeing the key is what allows the order to be attempted again.
      pendingKey: null,
    },
  });
  return updated.count === 1;
}
