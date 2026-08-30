import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';
import { recordAuditLog } from '@/lib/admin/audit';
import type { OrderItemRecord } from '@/lib/orders/types';
import type { CustomerType, OrderStatus, PaymentPreference, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Admin order queries/mutations — Prisma-only (see assertAdminDatabaseConfigured),
 * no in-memory dev fallback. Order detail/BOM/pricing are read verbatim from
 * the persisted snapshot columns (configuration, bomSnapshot, unitNetPrice,
 * totalNetPrice, Order.grandTotal/netTotal/vatTotal/discountTotal) — never
 * recalculated from the current catalog, so an old order's numbers never
 * drift when today's prices change.
 */

const PAGE_SIZE = 20;

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  grandTotal: number;
  paymentPreference: PaymentPreference;
}

export interface AdminOrderListResult {
  orders: AdminOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listOrders(params: { status?: OrderStatus; page?: number }): Promise<AdminOrderListResult> {
  assertAdminDatabaseConfigured();

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const where = params.status ? { status: params.status } : {};

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      createdAt: row.createdAt.toISOString(),
      status: row.status as OrderStatus,
      customerName: row.customer.fullName,
      customerPhone: row.customer.phone,
      customerCity: row.customer.city ?? '',
      grandTotal: Number(row.grandTotal),
      paymentPreference: row.paymentPreference as PaymentPreference,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export interface AdminOrderItem {
  id: string;
  configuration: ShelvingConfiguration;
  bom: OrderItemRecord['bom'];
  quantity: number;
  unitNetPrice: number;
  totalNetPrice: number;
}

export interface AdminOrderStatusHistoryEntry {
  id: string;
  status: OrderStatus;
  note?: string;
  changedBy?: string;
  createdAt: string;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  paymentPreference: PaymentPreference;
  deliveryAddress?: string;
  comment?: string;
  netTotal: number;
  vatTotal: number;
  discountTotal: number;
  grandTotal: number;
  customer: {
    fullName: string;
    phone: string;
    whatsapp?: string;
    email?: string;
    city: string;
    companyName?: string;
    binIin?: string;
    type: CustomerType;
  };
  items: AdminOrderItem[];
  statusHistory: AdminOrderStatusHistoryEntry[];
}

export async function getOrderById(id: string): Promise<AdminOrderDetail | null> {
  assertAdminDatabaseConfigured();

  const row = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    status: row.status as OrderStatus,
    paymentPreference: row.paymentPreference as PaymentPreference,
    deliveryAddress: row.deliveryAddress ?? undefined,
    comment: row.comment ?? undefined,
    netTotal: Number(row.netTotal),
    vatTotal: Number(row.vatTotal),
    discountTotal: Number(row.discountTotal),
    grandTotal: Number(row.grandTotal),
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
    items: row.items.map((item) => ({
      id: item.id,
      // Persisted at order-creation time by calculatePrice() — read
      // verbatim, never re-derived from the live catalog.
      configuration: item.configuration as unknown as ShelvingConfiguration,
      bom: (item.bomSnapshot as unknown as OrderItemRecord['bom']) ?? [],
      quantity: item.quantity,
      unitNetPrice: Number(item.unitNetPrice),
      totalNetPrice: Number(item.totalNetPrice),
    })),
    statusHistory: row.statusHistory.map((h) => ({
      id: h.id,
      status: h.status as OrderStatus,
      note: h.note ?? undefined,
      changedBy: h.changedBy ?? undefined,
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

export class AdminOrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found.`);
    this.name = 'AdminOrderNotFoundError';
  }
}

export interface UpdateOrderStatusParams {
  orderId: string;
  newStatus: OrderStatus;
  actor: { id: string; name: string };
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateOrderStatusResult {
  previousStatus: OrderStatus;
  newStatus: OrderStatus;
  changed: boolean;
}

/**
 * Updates Order.status, appends OrderStatusHistory, and writes an AuditLog
 * row — all inside one Prisma transaction, so a partial write (status
 * changed but no history/audit trail, or vice versa) can never happen.
 * A no-op request (new status === current status) writes nothing and
 * reports changed: false, so re-submitting the same status from the UI
 * doesn't spam the history/audit trail.
 */
export async function updateOrderStatus(params: UpdateOrderStatusParams): Promise<UpdateOrderStatusResult> {
  assertAdminDatabaseConfigured();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: params.orderId }, select: { status: true } });
    if (!existing) throw new AdminOrderNotFoundError(params.orderId);

    const previousStatus = existing.status as OrderStatus;
    if (previousStatus === params.newStatus) {
      return { previousStatus, newStatus: params.newStatus, changed: false };
    }

    await tx.order.update({ where: { id: params.orderId }, data: { status: params.newStatus } });

    await tx.orderStatusHistory.create({
      data: {
        orderId: params.orderId,
        status: params.newStatus,
        changedBy: params.actor.name,
      },
    });

    await recordAuditLog(
      {
        userId: params.actor.id,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'ORDER',
        entityId: params.orderId,
        previousData: { status: previousStatus },
        newData: { status: params.newStatus },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx,
    );

    return { previousStatus, newStatus: params.newStatus, changed: true };
  });
}
