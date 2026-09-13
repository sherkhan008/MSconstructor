import type { AdminRole } from '@/lib/types/domain';

/**
 * Single source of truth for "which admin role can do what" — every
 * mutation route/component checks through here instead of comparing
 * `role === '...'` inline (spec: centralize authorization checks).
 */

const ORDER_STATUS_CHANGE_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/**
 * Every active admin role (including CONTENT_MANAGER) can log in and view
 * the orders list/detail — only changing an order's status is restricted.
 * There is deliberately no separate "can view orders" check: viewing only
 * requires a valid session, enforced once in the (protected) layout.
 */
export function canChangeOrderStatus(role: AdminRole): boolean {
  return ORDER_STATUS_CHANGE_ROLES.includes(role);
}

/**
 * Catalog price management (reading purchase prices, editing selling/purchase
 * prices) is commercial data: it exposes supplier cost and margin, so it is
 * deliberately narrower than order handling. MANAGER may move an order
 * through its statuses but may never see or change what a part costs us;
 * CONTENT_MANAGER may not either.
 */
const PRICE_MANAGEMENT_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'ADMIN'];

export function canManagePrices(role: AdminRole): boolean {
  return PRICE_MANAGEMENT_ROLES.includes(role);
}

/**
 * Order assignment. Deliberately two predicates rather than one, because
 * MANAGER's rights are not a subset of "can assign": a manager may only ever
 * put THEIR OWN name on an order that currently has nobody on it, and can
 * never take it off again — the full assign/reassign right belongs to
 * SUPER_ADMIN/ADMIN alone. CONTENT_MANAGER is read-only here, exactly as it
 * is for statuses and prices.
 *
 * These are pure predicates over the role; the "…only themselves, only when
 * unassigned" half of the manager rule needs the order and the actor's id, so
 * it is enforced in assignOrderManager() (src/lib/admin/orders.ts), which is
 * the only place that can see both.
 */
const ORDER_ASSIGN_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'ADMIN'];

export function canAssignOrder(role: AdminRole): boolean {
  return ORDER_ASSIGN_ROLES.includes(role);
}

/** MANAGER-only: may claim an unassigned order for themselves ("Взять заказ").
 * SUPER_ADMIN/ADMIN don't need this — canAssignOrder already covers them. */
export function canClaimUnassignedOrder(role: AdminRole): boolean {
  return role === 'MANAGER';
}

/**
 * Internal notes are operational, not commercial: they hold "customer asked
 * to call back after 18:00", not cost or margin. So the operational roles
 * that already move an order through its statuses may write them, while
 * CONTENT_MANAGER — read-only across the whole order area — may not.
 */
const ORDER_INTERNAL_NOTES_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

export function canEditInternalNotes(role: AdminRole): boolean {
  return ORDER_INTERNAL_NOTES_ROLES.includes(role);
}

/**
 * Customer documents (commercial proposal, invoice) generated from a saved
 * order. Issuing a document to a customer is operational order work — the
 * same roles that move an order through its statuses — while CONTENT_MANAGER
 * stays read-only across the order area. Documents print only customer-facing
 * amounts, never cost or margin, so this needs no price-management right.
 */
const ORDER_DOCUMENT_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

export function canGenerateOrderDocuments(role: AdminRole): boolean {
  return ORDER_DOCUMENT_ROLES.includes(role);
}

/**
 * Roles that may be put on an order as the responsible person. An order is
 * operational work, so a CONTENT_MANAGER is never a valid assignee even
 * though they can sign in and read the order.
 */
export const ASSIGNABLE_ORDER_MANAGER_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

export function isAssignableOrderManagerRole(role: AdminRole): boolean {
  return ASSIGNABLE_ORDER_MANAGER_ROLES.includes(role);
}
