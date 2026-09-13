import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';
import type { PaymentPreference } from '@/lib/types/domain';
import type { DecimalLike } from './money';

/**
 * The persisted order snapshot a document is projected from.
 *
 * This is an explicit column allow-list, not `include: { customer: true }`:
 * internal notes, the responsible manager, status history and audit rows are
 * never even read on the document path, so no template change can print them
 * by accident. Neither are the mutable Customer row (the buyer comes from the
 * order-time Order.buyerSnapshot) or the internal component BOM (the public
 * kit is in OrderItem.documentSnapshot). Money columns are passed through
 * untouched (Prisma.Decimal), and nothing here touches the catalog, the
 * pricing engine or any price table — a document is the order as it was saved.
 */

export interface OrderDocumentSourceItem {
  id: string;
  /** Persisted ShelvingConfiguration JSON, shape-checked by the builder. */
  configuration: unknown;
  /** Raw OrderItem.documentSnapshot JSON — validated by the builder; null for
   * an item saved before document snapshots existed. */
  documentSnapshot: unknown;
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
  /** Raw Order.buyerSnapshot JSON — validated by the builder; null means a
   * pre-snapshot order, which is deliberately not reconstructed. */
  buyerSnapshot: unknown;
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
      buyerSnapshot: true,
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
      items: {
        select: {
          id: true,
          configuration: true,
          documentSnapshot: true,
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
    buyerSnapshot: row.buyerSnapshot,
    items: row.items,
  };
}
