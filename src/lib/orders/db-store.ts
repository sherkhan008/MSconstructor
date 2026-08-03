import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import type { CustomerType, OrderStatus, PaymentPreference } from '@/lib/types/domain';
import type { OrderItemRecord, OrderRecord } from './types';

/**
 * Prisma-backed order persistence. Loaded dynamically by
 * src/lib/orders/store.ts only when DATABASE_URL points at PostgreSQL.
 */

export async function saveOrderToDb(order: OrderRecord): Promise<OrderRecord> {
  const customer = await prisma.customer.upsert({
    where: { phone_type: { phone: order.customer.phone, type: order.customer.type } },
    update: {
      fullName: order.customer.fullName,
      email: order.customer.email,
      whatsapp: order.customer.whatsapp,
      city: order.customer.city,
      companyName: order.customer.companyName,
      binIin: order.customer.binIin,
    },
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
  });

  await prisma.order.create({
    data: {
      orderNumber: order.orderNumber,
      customerId: customer.id,
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
    customer: {
      fullName: row.customer.fullName,
      phone: row.customer.phone,
      whatsapp: row.customer.whatsapp ?? undefined,
      email: row.customer.email ?? undefined,
      city: row.customer.city ?? '',
      companyName: row.customer.companyName ?? undefined,
      binIin: row.customer.binIin ?? undefined,
      type: row.customer.type as CustomerType,
    },
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
    })),
    netTotal: Number(row.netTotal),
    vatTotal: Number(row.vatTotal),
    discountTotal: Number(row.discountTotal),
    grandTotal: Number(row.grandTotal),
    createdAt: row.createdAt.toISOString(),
  };
}
