import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';
import type { CustomerType, PaymentPreference } from '@/lib/types/domain';
import type { DecimalLike } from './money';

/**
 * The persisted order snapshot a document is projected from.
 *
 * This is an explicit column allow-list, not `include: { customer: true }`:
 * internal notes, the responsible manager, status history and audit rows are
 * never even read on the document path, so no template change can print them
 * by accident. Money columns are passed through untouched (Prisma.Decimal),
 * and nothing here touches the catalog, the pricing engine or any price
 * table — a document is the order exactly as it was saved.
 */

export interface OrderDocumentSourceItem {
  id: string;
  /** Persisted ShelvingConfiguration JSON, shape-checked by the builder. */
  configuration: unknown;
  /** Persisted internal BOM snapshot JSON (cost already stripped at save). */
  bomSnapshot: unknown;
  quantity: number;
  unitNetPrice: DecimalLike;
  totalNetPrice: DecimalLike;
}

export interface OrderDocumentSource {
  id: string;
  orderNumber: string;
  createdAt: Date;
  paymentPreference: PaymentPreference | string;
  delivery: {
    methodId: string | null;
    address: string | null;
    city: string | null;
    floor: string | null;
    hasLift: boolean | null;
    date: Date | null;
  };
  netTotal: DecimalLike;
  vatTotal: DecimalLike;
  discountTotal: DecimalLike;
  grandTotal: DecimalLike;
  customer: {
    type: CustomerType | string;
    fullName: string;
    phone: string;
    email: string | null;
    city: string | null;
    companyName: string | null;
    binIin: string | null;
  };
  items: OrderDocumentSourceItem[];
}

/** Order ids are Prisma cuids; anything else cannot name an order, so it is
 * rejected before a query is issued. */
export function isPlausibleOrderId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export async function loadOrderDocumentSource(orderId: string): Promise<OrderDocumentSource | null> {
  assertAdminDatabaseConfigured();
  if (!isPlausibleOrderId(orderId)) return null;

  const row = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      paymentPreference: true,
      deliveryMethodId: true,
      deliveryAddress: true,
      deliveryCity: true,
      deliveryFloor: true,
      deliveryHasLift: true,
      deliveryDate: true,
      netTotal: true,
      vatTotal: true,
      discountTotal: true,
      grandTotal: true,
      customer: {
        select: {
          type: true,
          fullName: true,
          phone: true,
          email: true,
          city: true,
          companyName: true,
          binIin: true,
        },
      },
      items: {
        select: {
          id: true,
          configuration: true,
          bomSnapshot: true,
          quantity: true,
          unitNetPrice: true,
          totalNetPrice: true,
        },
        // Stable line order: repeated generation must print the same rows in
        // the same order.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt,
    paymentPreference: row.paymentPreference,
    delivery: {
      methodId: row.deliveryMethodId,
      address: row.deliveryAddress,
      city: row.deliveryCity,
      floor: row.deliveryFloor,
      hasLift: row.deliveryHasLift,
      date: row.deliveryDate,
    },
    netTotal: row.netTotal,
    vatTotal: row.vatTotal,
    discountTotal: row.discountTotal,
    grandTotal: row.grandTotal,
    customer: row.customer,
    items: row.items,
  };
}
