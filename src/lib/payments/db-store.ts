import { prisma } from '@/lib/db/client';
import type { CreatePaymentInput, PaymentRecord, PaymentStatus } from './types';

/**
 * Prisma-backed payment persistence. Loaded dynamically by
 * src/lib/payments/store.ts only when DATABASE_URL points at PostgreSQL.
 */

function toPaymentRecord(row: {
  id: string;
  orderId: string;
  type: string;
  status: string;
  amount: unknown;
  externalId: string | null;
  invoiceNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    type: row.type,
    status: row.status as PaymentStatus,
    amount: Number(row.amount),
    externalId: row.externalId ?? undefined,
    invoiceNumber: row.invoiceNumber ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createPaymentInDb(input: CreatePaymentInput): Promise<PaymentRecord> {
  const row = await prisma.payment.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      status: input.status ?? 'PENDING',
      amount: input.amount,
      externalId: input.externalId,
      invoiceNumber: input.invoiceNumber,
    },
  });
  return toPaymentRecord(row);
}

export async function getPaymentsByOrderIdFromDb(orderId: string): Promise<PaymentRecord[]> {
  const rows = await prisma.payment.findMany({ where: { orderId } });
  return rows.map(toPaymentRecord);
}

export async function updatePaymentStatusInDb(id: string, status: PaymentStatus): Promise<void> {
  await prisma.payment.update({ where: { id }, data: { status } });
}
