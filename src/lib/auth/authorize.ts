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
