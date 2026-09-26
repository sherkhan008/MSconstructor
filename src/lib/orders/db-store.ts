import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { parseOrderBuyerSnapshot, parseOrderItemDocumentSnapshot } from '@/lib/documents/snapshots';
import type { OrderStatus, PaymentPreference } from '@/lib/types/domain';
import { orderBuyer } from './buyer';
import type { OrderItemRecord, OrderRecord } from './types';

/**
 * Prisma-backed order persistence. Loaded dynamically by
 * src/lib/orders/store.ts only when DATABASE_URL points at PostgreSQL.
 */

/**
 * ONE write: the order, its items, its first status entry and — on a phone
 * number's first order — its Customer row are created by a single nested
 * create, which Prisma runs atomically. A failure leaves nothing behind: no
 * customer without the order that created it, no order without its items.
 *
 * The Customer row (one per phone number + customer type) is connected if it
 * exists and created otherwise, never updated: checkout is public, and typing
 * someone's phone number must not replace their name, email or company. What
 * this order's buyer entered is its buyer snapshot, which every order view
 * reads first (src/lib/orders/buyer.ts). Two first orders from one phone at
 * the same moment can both try to create the row; the loser fails with a
 * P2002 on (phone, type) and saveOrder runs it again.
 */
export async function saveOrderToDb(order: OrderRecord): Promise<OrderRecord> {
  await prisma.order.create({
    data: {
      orderNumber: order.orderNumber,
      customer: {
        connectOrCreate: {
          where: { phone_type: { phone: order.customer.phone, type: order.customer.type } },
          create: {
            type: order.customer.type,
            fullName: order.customer.fullName,
            phone: order.customer.phone,
            whatsapp: order.customer.whatsapp,
            email: order.customer.email,
            city: order.customer.city,
            companyName: order.customer.companyName,
            binIin: order.customer.binIin,
          },
        },
      },
      // Written once here and never updated (see src/lib/documents/snapshots.ts).
      buyerSnapshot: order.buyerSnapshot as unknown as Prisma.InputJsonValue | undefined,
      status: order.status,
      deliveryAddress: order.deliveryAddress,
      paymentPreference: order.paymentPreference,
      comment: order.comment,
      netTotal: order.netTotal,
      vatTotal: order.vatTotal,
      discountTotal: order.discountTotal,
      grandTotal: order.grandTotal,
      items: {
        create: order.items.map((item) => ({
          configuration: item.configuration as unknown as Prisma.InputJsonValue,
          bomSnapshot: item.bom as unknown as Prisma.InputJsonValue,
          documentSnapshot: item.documentSnapshot as unknown as Prisma.InputJsonValue | undefined,
          quantity: item.configuration.quantity,
          unitNetPrice: item.breakdown.unitNet,
          totalNetPrice: item.breakdown.net,
        })),
      },
      statusHistory: {
        create: [{ status: order.status, note: 'Заказ создан' }],
      },
    },
  });

  return order;
}

export async function getOrderByNumberFromDb(orderNumber: string): Promise<OrderRecord | undefined> {
  const row = await prisma.order.findUnique({
    where: { orderNumber },
    include: { customer: true, items: true },
  });
  if (!row) return undefined;

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status as OrderStatus,
    customer: orderBuyer(row.buyerSnapshot, row.customer),
    buyerSnapshot: parseOrderBuyerSnapshot(row.buyerSnapshot) ?? undefined,
    deliveryAddress: row.deliveryAddress ?? undefined,
    paymentPreference: row.paymentPreference as PaymentPreference,
    comment: row.comment ?? undefined,
    items: row.items.map((item) => ({
      configuration: item.configuration as unknown as OrderItemRecord['configuration'],
      bom: item.bomSnapshot as unknown as OrderItemRecord['bom'],
      breakdown: {
        componentsSubtotal: 0,
        colorSurcharge: 0,
        markup: 0,
        unitNet: Number(item.unitNetPrice),
        quantity: item.quantity,
        itemsNet: Number(item.totalNetPrice),
        assembly: 0,
        delivery: null,
        discount: 0,
        discountReasons: [],
        net: Number(item.totalNetPrice),
        vatPercent: 0,
        vat: 0,
        total: Number(item.totalNetPrice),
        unitTotal: Number(item.unitNetPrice),
      },
      modelName: item.configuration && typeof item.configuration === 'object' && 'modelSlug' in item.configuration
        ? String((item.configuration as { modelSlug: string }).modelSlug)
        : '',
      documentSnapshot: parseOrderItemDocumentSnapshot(item.documentSnapshot) ?? undefined,
    })),
    netTotal: Number(row.netTotal),
    vatTotal: Number(row.vatTotal),
    discountTotal: Number(row.discountTotal),
    grandTotal: Number(row.grandTotal),
    createdAt: row.createdAt.toISOString(),
  };
}
