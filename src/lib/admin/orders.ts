import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';
import { recordAuditLog } from '@/lib/admin/audit';
import { buildOrderEvent } from '@/lib/notifications/events';
import { emitOrderEventInBackground } from '@/lib/notifications/service';
import { INTERNAL_NOTES_MAX_LENGTH, toPlainTextNotes } from '@/lib/admin/internal-notes';
import {
  UNASSIGNED_MANAGER_VALUE,
  escapeLikeTerm,
  phoneSearchDigits,
  resolveDateWindow,
  startOfToday,
  type CustomerTypeFilter,
  type OrderDateRange,
} from '@/lib/admin/order-filters';
import {
  ASSIGNABLE_ORDER_MANAGER_ROLES,
  canAssignOrder,
  canClaimUnassignedOrder,
  canEditInternalNotes,
} from '@/lib/auth/authorize';
import {
  checkOrderStatusTransition,
  type OrderStatusChannel,
  type OrderStatusTransitionRejection,
} from '@/lib/orders/status-transitions';
import type { OrderItemRecord } from '@/lib/orders/types';
import type {
  AdminRole,
  CustomerType,
  OrderStatus,
  PaymentPreference,
  ShelvingConfiguration,
} from '@/lib/types/domain';

/**
 * Admin order queries/mutations — Prisma-only (see assertAdminDatabaseConfigured),
 * no in-memory dev fallback. Order detail/BOM/pricing are read verbatim from
 * the persisted snapshot columns (configuration, bomSnapshot, unitNetPrice,
 * totalNetPrice, Order.grandTotal/netTotal/vatTotal/discountTotal) — never
 * recalculated from the current catalog, so an old order's numbers never
 * drift when today's prices change.
 *
 * Everything this module returns is ADMIN-ONLY: internal notes, the
 * responsible manager and the full internal BOM (which includes production
 * parts a customer never sees). Nothing here may be imported by a
 * customer-facing route or component.
 */

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

export interface AdminOrderManagerRef {
  id: string;
  name: string;
}

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerType: CustomerType;
  customerCompanyName?: string;
  grandTotal: number;
  paymentPreference: PaymentPreference;
  /** null = nobody is responsible for this order yet. */
  manager: AdminOrderManagerRef | null;
}

/** The three numbers above the list. Deliberately *unfiltered*: they answer
 * "what needs attention right now", which must not change when a manager
 * narrows the list to one customer. */
export interface AdminOrderCounters {
  newOrders: number;
  unassigned: number;
  today: number;
}

export interface AdminOrderListParams {
  /** Free text: order number, customer name, phone, email, company, BIN/IIN. */
  search?: string;
  status?: OrderStatus;
  dateRange?: OrderDateRange;
  /** `YYYY-MM-DD` bounds, honoured only when dateRange === 'CUSTOM'. */
  dateFrom?: string;
  dateTo?: string;
  /** A user id, or UNASSIGNED_MANAGER_VALUE for "без менеджера". */
  managerId?: string;
  customerType?: CustomerTypeFilter;
  page?: number;
  /** Injectable clock — keeps date windows and the "сегодня" counter testable
   * and consistent within one request. */
  now?: Date;
}

export interface AdminOrderListResult {
  orders: AdminOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counters: AdminOrderCounters;
}

/**
 * Translates the list screen's filters into ONE Prisma `where`.
 *
 * Every condition is a database predicate — nothing is filtered in JS after
 * the fact, so page 1 of a search really is the first 20 matching rows and
 * `total` really is the number of matches. Customer-side terms are expressed
 * as relation filters (`customer: { … }`), which Prisma compiles into a join,
 * not into a second round of queries.
 */
export function buildOrderWhere(params: AdminOrderListParams, now: Date): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];

  if (params.status) and.push({ status: params.status });

  const window = resolveDateWindow(params.dateRange ?? 'ALL', now, {
    from: params.dateFrom,
    to: params.dateTo,
  });
  if (window.from || window.to) {
    and.push({
      createdAt: {
        ...(window.from ? { gte: window.from } : {}),
        ...(window.to ? { lte: window.to } : {}),
      },
    });
  }

  if (params.managerId === UNASSIGNED_MANAGER_VALUE) {
    and.push({ managerId: null });
  } else if (params.managerId) {
    and.push({ managerId: params.managerId });
  }

  if (params.customerType && params.customerType !== 'ALL') {
    and.push({ customer: { type: params.customerType } });
  }

  const term = params.search?.trim();
  if (term) {
    // `%`/`_` are escaped so a term containing them matches literally instead
    // of silently widening the search.
    const like = escapeLikeTerm(term);
    const or: Prisma.OrderWhereInput[] = [
      { orderNumber: { contains: like, mode: 'insensitive' } },
      { customer: { fullName: { contains: like, mode: 'insensitive' } } },
      { customer: { email: { contains: like, mode: 'insensitive' } } },
      { customer: { companyName: { contains: like, mode: 'insensitive' } } },
      { customer: { binIin: { contains: like, mode: 'insensitive' } } },
    ];
    // A phone probe searches the stored normalized number by its subscriber
    // digits, so "+7 707…", "8707…" and "707…" all find the same customer.
    const digits = phoneSearchDigits(term);
    if (digits) or.push({ customer: { phone: { contains: digits } } });
    and.push({ OR: or });
  }

  return and.length > 0 ? { AND: and } : {};
}

export async function listOrders(params: AdminOrderListParams): Promise<AdminOrderListResult> {
  assertAdminDatabaseConfigured();

  const now = params.now ?? new Date();
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const where = buildOrderWhere(params, now);
  const dayStart = startOfToday(now);

  const [rows, total, newOrders, unassigned, today] = await Promise.all([
    prisma.order.findMany({
      where,
      // A projection, not `include: { customer: true }`: the list needs six
      // customer columns, and one join returns them all with the order row —
      // no per-row follow-up query anywhere on this path.
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        status: true,
        grandTotal: true,
        paymentPreference: true,
        customer: {
          select: { fullName: true, phone: true, city: true, type: true, companyName: true },
        },
        manager: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { status: 'NEW' } }),
    prisma.order.count({ where: { managerId: null } }),
    prisma.order.count({ where: { createdAt: { gte: dayStart } } }),
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
      customerType: row.customer.type as CustomerType,
      customerCompanyName: row.customer.companyName ?? undefined,
      grandTotal: Number(row.grandTotal),
      paymentPreference: row.paymentPreference as PaymentPreference,
      manager: row.manager ? { id: row.manager.id, name: row.manager.name } : null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counters: { newOrders, unassigned, today },
  };
}

export interface AssignableManager {
  id: string;
  name: string;
  role: AdminRole;
}

/**
 * The accounts that may be put on an order as the responsible person:
 * active users in an operational role (see ASSIGNABLE_ORDER_MANAGER_ROLES —
 * CONTENT_MANAGER is never one, and a deactivated account never is either).
 *
 * Used by the manager <select> on the detail page and by the manager filter
 * on the list. Only id/name/role are selected — an email or a password hash
 * has no business leaving this query.
 */
export async function listAssignableManagers(): Promise<AssignableManager[]> {
  assertAdminDatabaseConfigured();

  const rows = await prisma.user.findMany({
    where: { active: true, role: { in: ASSIGNABLE_ORDER_MANAGER_ROLES as AdminRole[] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role as AdminRole }));
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

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

/** Assignment/notes events for the order's activity timeline. Status changes
 * are deliberately absent — OrderStatusHistory already shows those, and
 * duplicating them would make the timeline noise instead of signal. */
export const ORDER_ACTIVITY_ACTIONS = ['ORDER_MANAGER_ASSIGNED', 'ORDER_INTERNAL_NOTES_UPDATED'] as const;
export type OrderActivityAction = (typeof ORDER_ACTIVITY_ACTIONS)[number];

export interface AdminOrderActivityEntry {
  id: string;
  action: OrderActivityAction;
  /** Who did it. Read from the audit row's own snapshot so the trail still
   * names them after the account is deleted (AuditLog.userId is SetNull). */
  actorName?: string;
  previousManagerName?: string;
  newManagerName?: string;
  createdAt: string;
}

export interface AdminOrderDelivery {
  methodId?: string;
  address?: string;
  city?: string;
  floor?: string;
  hasLift?: boolean;
  date?: string;
  comment?: string;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  createdAt: string;
  /** Doubles as the optimistic-concurrency token for assignment and notes. */
  updatedAt: string;
  status: OrderStatus;
  paymentPreference: PaymentPreference;
  deliveryAddress?: string;
  delivery: AdminOrderDelivery;
  comment?: string;
  /** ADMIN-ONLY. Never leaves this module towards a customer-facing route. */
  internalNotes: string;
  manager: AdminOrderManagerRef | null;
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
  activity: AdminOrderActivityEntry[];
}

/** Upper bound on the timeline — an order edited hundreds of times must not
 * turn its detail page into an audit dump. */
const ACTIVITY_LIMIT = 20;

function auditString(data: Prisma.JsonValue | null, key: string): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function listOrderActivity(orderId: string): Promise<AdminOrderActivityEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'ORDER', entityId: orderId, action: { in: [...ORDER_ACTIVITY_ACTIONS] } },
    select: { id: true, action: true, previousData: true, newData: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: ACTIVITY_LIMIT,
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action as OrderActivityAction,
    actorName: auditString(row.newData, 'actorName'),
    previousManagerName: auditString(row.previousData, 'managerName'),
    newManagerName: auditString(row.newData, 'managerName'),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getOrderById(id: string): Promise<AdminOrderDetail | null> {
  assertAdminDatabaseConfigured();

  const row = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: true,
      manager: { select: { id: true, name: true } },
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!row) return null;

  // Only now that the order is known to exist — one extra indexed read, not a
  // per-order query inside a loop.
  const activity = await listOrderActivity(row.id);

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status as OrderStatus,
    paymentPreference: row.paymentPreference as PaymentPreference,
    deliveryAddress: row.deliveryAddress ?? undefined,
    delivery: {
      methodId: row.deliveryMethodId ?? undefined,
      address: row.deliveryAddress ?? undefined,
      city: row.deliveryCity ?? undefined,
      floor: row.deliveryFloor ?? undefined,
      hasLift: row.deliveryHasLift ?? undefined,
      date: row.deliveryDate ? row.deliveryDate.toISOString() : undefined,
      comment: row.deliveryComment ?? undefined,
    },
    comment: row.comment ?? undefined,
    internalNotes: row.internalNotes ?? '',
    manager: row.manager ? { id: row.manager.id, name: row.manager.name } : null,
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
    activity,
  };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class AdminOrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found.`);
    this.name = 'AdminOrderNotFoundError';
  }
}

/** The order moved after the admin loaded it — never blind-overwrite. */
export class AdminOrderConflictError extends Error {
  readonly currentUpdatedAt?: string;

  constructor(currentUpdatedAt?: string) {
    super('Order changed since it was loaded.');
    this.name = 'AdminOrderConflictError';
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

/** The actor's role does not permit this particular assignment (403). */
export class AdminOrderAssignmentNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminOrderAssignmentNotAllowedError';
  }
}

/** The requested assignee is not an active operational user (400). */
export class AdminOrderManagerNotAssignableError extends Error {
  constructor(managerId: string) {
    super(`User ${managerId} cannot be assigned to an order.`);
    this.name = 'AdminOrderManagerNotAssignableError';
  }
}

/** The requested status change is not in the allowed graph, or the channel
 * asking for it is not trusted with it. Carries the exact reason so the route
 * can answer 403 (untrusted) vs 409 (impossible from this state). */
export class AdminOrderStatusTransitionNotAllowedError extends Error {
  readonly reason: OrderStatusTransitionRejection;
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus, reason: OrderStatusTransitionRejection) {
    super(`Order status transition ${from} → ${to} rejected: ${reason}.`);
    this.name = 'AdminOrderStatusTransitionNotAllowedError';
    this.reason = reason;
    this.from = from;
    this.to = to;
  }
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export interface UpdateOrderStatusParams {
  orderId: string;
  newStatus: OrderStatus;
  /**
   * The trusted path this change arrives through — see OrderStatusChannel.
   * Required, with no default: a caller must state what it is, so a new call
   * site can never inherit admin-level trust by forgetting to say anything.
   */
  channel: OrderStatusChannel;
  /** Order.updatedAt as the client loaded it — the lost-update guard. */
  expectedUpdatedAt?: string;
  /**
   * Who is making the change. `id` is a User row and is absent for a channel
   * that is not a person — the PAYMENT_PROVIDER path has no admin account, and
   * pointing AuditLog.userId at an invented id would break its foreign key.
   * `name` is always required and is snapshotted into the audit row either
   * way, so the trail never loses who (or what) moved the order.
   */
  actor: { id?: string; name: string };
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateOrderStatusResult {
  previousStatus: OrderStatus;
  newStatus: OrderStatus;
  changed: boolean;
  /** The order's `updatedAt` after the call — the client's next CAS token. */
  updatedAt: string;
}

/**
 * Moves one order through the workflow.
 *
 * The transition itself is decided by checkOrderStatusTransition() — the same
 * policy the admin screen renders its buttons from — and it is re-checked HERE,
 * against the status the row really has inside the transaction, because the
 * button the admin clicked was rendered from a page that may now be minutes
 * old. A status the graph forbids, and any status this channel is not trusted
 * with (PAID above all), is rejected and writes nothing.
 *
 * Updates Order.status, appends OrderStatusHistory, and writes an AuditLog
 * row — all inside one Prisma transaction, so a partial write (status changed
 * but no history/audit trail, or vice versa) can never happen.
 *
 * Concurrency: the UPDATE is a compare-and-swap on (updatedAt, status), so two
 * admins clicking two different transitions on the same order cannot both
 * win — the loser gets AdminOrderConflictError (409) and the order keeps the
 * first change. This holds even when the caller sends no expectedUpdatedAt:
 * the CAS pins the status the transition was checked against, so a stale
 * double-submit ("Подтвердить заказ" clicked twice, or replayed) can never
 * apply a second time.
 *
 * A no-op request (new status === current status) writes nothing and reports
 * changed: false, so re-submitting the same status from the UI doesn't spam
 * the history/audit trail.
 */
export async function updateOrderStatus(params: UpdateOrderStatusParams): Promise<UpdateOrderStatusResult> {
  assertAdminDatabaseConfigured();

  let eventOrder: { orderNumber: string; grandTotal: number } | undefined;
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { status: true, updatedAt: true, orderNumber: true, grandTotal: true },
    });
    if (!existing) throw new AdminOrderNotFoundError(params.orderId);

    if (params.expectedUpdatedAt !== undefined) {
      const expected = new Date(params.expectedUpdatedAt).getTime();
      if (Number.isNaN(expected) || expected !== existing.updatedAt.getTime()) {
        throw new AdminOrderConflictError(existing.updatedAt.toISOString());
      }
    }

    const previousStatus = existing.status as OrderStatus;
    const check = checkOrderStatusTransition({
      from: previousStatus,
      to: params.newStatus,
      channel: params.channel,
    });
    if (!check.ok) {
      if (check.reason === 'SAME_STATUS') {
        return {
          previousStatus,
          newStatus: params.newStatus,
          changed: false,
          updatedAt: existing.updatedAt.toISOString(),
        } satisfies UpdateOrderStatusResult;
      }
      throw new AdminOrderStatusTransitionNotAllowedError(previousStatus, params.newStatus, check.reason);
    }

    // Compare-and-swap on both the concurrency token and the field being
    // changed: matches 0 rows if anyone moved this order in the meantime.
    const updated = await tx.order.updateMany({
      where: { id: params.orderId, updatedAt: existing.updatedAt, status: previousStatus },
      data: { status: params.newStatus },
    });
    if (updated.count !== 1) {
      const current = await tx.order.findUnique({
        where: { id: params.orderId },
        select: { updatedAt: true },
      });
      throw new AdminOrderConflictError(current?.updatedAt.toISOString());
    }

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
        newData: {
          status: params.newStatus,
          // Snapshot of the actor and the path they came through, so the trail
          // still answers "who moved this order, and how" after the account is
          // deleted and AuditLog.userId becomes NULL.
          actorName: params.actor.name,
          channel: params.channel,
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx,
    );

    const after = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { updatedAt: true },
    });

    eventOrder = { orderNumber: existing.orderNumber, grandTotal: Number(existing.grandTotal) };
    return {
      previousStatus,
      newStatus: params.newStatus,
      changed: true,
      updatedAt: (after?.updatedAt ?? existing.updatedAt).toISOString(),
    } satisfies UpdateOrderStatusResult;
  });

  // After commit, never inside the transaction: a notification problem must not
  // roll back or delay the status change. Fire-and-forget; cannot throw.
  if (result.changed && eventOrder) {
    const base = {
      orderNumber: eventOrder.orderNumber,
      status: result.newStatus,
      previousStatus: result.previousStatus,
      grandTotal: eventOrder.grandTotal,
    };
    emitOrderEventInBackground(buildOrderEvent({ event: 'order.status_changed', ...base }));
    if (result.newStatus === 'PAID') emitOrderEventInBackground(buildOrderEvent({ event: 'order.paid', ...base }));
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Manager assignment                                                          */
/* -------------------------------------------------------------------------- */

export interface AssignOrderManagerParams {
  orderId: string;
  /** null = снять ответственного. Only SUPER_ADMIN/ADMIN may pass null. */
  managerId: string | null;
  /** Order.updatedAt as the admin loaded it — the lost-update guard. */
  expectedUpdatedAt?: string;
  actor: { id: string; name: string; role: AdminRole };
  ipAddress?: string;
  userAgent?: string;
}

export interface AssignOrderManagerResult {
  changed: boolean;
  managerId: string | null;
  managerName: string | null;
  /** The order's `updatedAt` after the call — the client's next CAS token. */
  updatedAt: string;
}

/**
 * Puts a responsible manager on an order, moves it to a different one, or
 * takes it off.
 *
 * The two halves of the permission rule meet here, and only here: the role
 * predicates (canAssignOrder/canClaimUnassignedOrder) say *who may act*, and
 * the order plus the actor's own id say *what they may do*:
 *
 *   SUPER_ADMIN / ADMIN  — assign, reassign or unassign anyone.
 *   MANAGER              — may only put THEMSELVES on an order that currently
 *                          has nobody on it ("Взять заказ"). They can never
 *                          take an order someone else holds, never hand one
 *                          to a colleague, and never release their own.
 *   CONTENT_MANAGER      — read-only, rejected before anything is read.
 *
 * Concurrency: the UPDATE is a compare-and-swap on (updatedAt, managerId), so
 * two managers clicking "Взять заказ" at the same moment cannot both win —
 * the loser gets AdminOrderConflictError (409) and the order keeps the first
 * manager. A request that changes nothing writes nothing at all: no update,
 * no audit row.
 */
export async function assignOrderManager(
  params: AssignOrderManagerParams,
): Promise<AssignOrderManagerResult> {
  assertAdminDatabaseConfigured();

  const mayAssignAnyone = canAssignOrder(params.actor.role);
  const mayClaim = canClaimUnassignedOrder(params.actor.role);
  if (!mayAssignAnyone && !mayClaim) {
    throw new AdminOrderAssignmentNotAllowedError('Недостаточно прав для назначения ответственного.');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { id: true, updatedAt: true, managerId: true, manager: { select: { name: true } } },
    });
    if (!existing) throw new AdminOrderNotFoundError(params.orderId);

    if (params.expectedUpdatedAt !== undefined) {
      const expected = new Date(params.expectedUpdatedAt).getTime();
      if (Number.isNaN(expected) || expected !== existing.updatedAt.getTime()) {
        throw new AdminOrderConflictError(existing.updatedAt.toISOString());
      }
    }

    // Re-posting the state the order is already in is not an action: it needs
    // no rights beyond being here, and it must not write an audit row.
    if (existing.managerId === params.managerId) {
      return {
        changed: false,
        managerId: existing.managerId,
        managerName: existing.manager?.name ?? null,
        updatedAt: existing.updatedAt.toISOString(),
      } satisfies AssignOrderManagerResult;
    }

    if (!mayAssignAnyone) {
      // MANAGER: self-claim of a free order, and nothing else.
      if (params.managerId !== params.actor.id) {
        throw new AdminOrderAssignmentNotAllowedError(
          'Менеджер может взять заказ только на себя.',
        );
      }
      if (existing.managerId !== null) {
        throw new AdminOrderAssignmentNotAllowedError('Заказ уже закреплён за другим сотрудником.');
      }
    }

    let managerName: string | null = null;
    if (params.managerId !== null) {
      const target = await tx.user.findUnique({
        where: { id: params.managerId },
        select: { id: true, name: true, role: true, active: true },
      });
      if (
        !target ||
        !target.active ||
        !ASSIGNABLE_ORDER_MANAGER_ROLES.includes(target.role as AdminRole)
      ) {
        throw new AdminOrderManagerNotAssignableError(params.managerId);
      }
      managerName = target.name;
    }

    // Compare-and-swap on both the concurrency token and the field being
    // changed: matches 0 rows if anyone touched this order in the meantime.
    const updated = await tx.order.updateMany({
      where: { id: params.orderId, updatedAt: existing.updatedAt, managerId: existing.managerId },
      data: { managerId: params.managerId },
    });
    if (updated.count !== 1) {
      const current = await tx.order.findUnique({
        where: { id: params.orderId },
        select: { updatedAt: true },
      });
      throw new AdminOrderConflictError(current?.updatedAt.toISOString());
    }

    await recordAuditLog(
      {
        userId: params.actor.id,
        action: 'ORDER_MANAGER_ASSIGNED',
        entityType: 'ORDER',
        entityId: params.orderId,
        previousData: {
          managerId: existing.managerId,
          managerName: existing.manager?.name ?? null,
        },
        newData: {
          managerId: params.managerId,
          managerName,
          // Snapshot of the actor, so the timeline still names them after the
          // account is deleted and AuditLog.userId becomes NULL.
          actorName: params.actor.name,
          actorRole: params.actor.role,
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx,
    );

    const after = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { updatedAt: true },
    });

    return {
      changed: true,
      managerId: params.managerId,
      managerName,
      updatedAt: (after?.updatedAt ?? existing.updatedAt).toISOString(),
    } satisfies AssignOrderManagerResult;
  });
}

/* -------------------------------------------------------------------------- */
/* Internal notes                                                              */
/* -------------------------------------------------------------------------- */

export interface UpdateOrderInternalNotesParams {
  orderId: string;
  /** Already length-checked by the route's schema; normalised again here so
   * the service is safe to call from anywhere. */
  internalNotes: string;
  expectedUpdatedAt?: string;
  actor: { id: string; name: string; role: AdminRole };
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateOrderInternalNotesResult {
  changed: boolean;
  internalNotes: string;
  updatedAt: string;
}

/**
 * Replaces an order's internal notes.
 *
 * Admin-only and operational, so the same roles that move an order through
 * its statuses may write them (SUPER_ADMIN/ADMIN/MANAGER) and CONTENT_MANAGER
 * may not — re-checked here, not only at the route, because the service is
 * the thing that touches the row.
 *
 * The text is stored as plain text (see toPlainTextNotes) and compared after
 * normalisation, so re-saving an unchanged note writes nothing: no update, no
 * audit row. Concurrency is the same compare-and-swap on `updatedAt` the
 * assignment path uses, so two admins editing the same note cannot silently
 * overwrite each other.
 */
export async function updateOrderInternalNotes(
  params: UpdateOrderInternalNotesParams,
): Promise<UpdateOrderInternalNotesResult> {
  assertAdminDatabaseConfigured();

  if (!canEditInternalNotes(params.actor.role)) {
    throw new AdminOrderAssignmentNotAllowedError('Недостаточно прав для изменения внутренних заметок.');
  }

  const next = toPlainTextNotes(params.internalNotes).slice(0, INTERNAL_NOTES_MAX_LENGTH);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { updatedAt: true, internalNotes: true },
    });
    if (!existing) throw new AdminOrderNotFoundError(params.orderId);

    if (params.expectedUpdatedAt !== undefined) {
      const expected = new Date(params.expectedUpdatedAt).getTime();
      if (Number.isNaN(expected) || expected !== existing.updatedAt.getTime()) {
        throw new AdminOrderConflictError(existing.updatedAt.toISOString());
      }
    }

    const previous = existing.internalNotes ?? '';
    if (previous === next) {
      return {
        changed: false,
        internalNotes: previous,
        updatedAt: existing.updatedAt.toISOString(),
      } satisfies UpdateOrderInternalNotesResult;
    }

    const updated = await tx.order.updateMany({
      where: { id: params.orderId, updatedAt: existing.updatedAt },
      data: { internalNotes: next.length > 0 ? next : null },
    });
    if (updated.count !== 1) {
      const current = await tx.order.findUnique({
        where: { id: params.orderId },
        select: { updatedAt: true },
      });
      throw new AdminOrderConflictError(current?.updatedAt.toISOString());
    }

    await recordAuditLog(
      {
        userId: params.actor.id,
        action: 'ORDER_INTERNAL_NOTES_UPDATED',
        entityType: 'ORDER',
        entityId: params.orderId,
        // The full before/after is kept deliberately: an internal note that
        // someone clears by accident is recoverable from here, and this table
        // is admin-only (never reachable from any public route).
        previousData: { internalNotes: previous },
        newData: { internalNotes: next, actorName: params.actor.name, actorRole: params.actor.role },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx,
    );

    const after = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { updatedAt: true },
    });

    return {
      changed: true,
      internalNotes: next,
      updatedAt: (after?.updatedAt ?? existing.updatedAt).toISOString(),
    } satisfies UpdateOrderInternalNotesResult;
  });
}
