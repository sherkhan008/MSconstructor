import type { OrderStatus } from '@/lib/types/domain';

/** Canonical, ordered list of every OrderStatus value — the single source
 * `z.enum` validation and the label map below both derive from. */
export const ORDER_STATUS_VALUES = [
  'NEW',
  'CONTACTED',
  'APPROVED',
  'AWAITING_PAYMENT',
  'PAID',
  'PRODUCTION',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly OrderStatus[];

/**
 * Admin-facing (operational) Russian labels for every OrderStatus value.
 * Deliberately separate from /order/success's own customer-facing status
 * copy ("Заказ принят" for NEW) — same enum value, different audience and
 * tone, so they are not unified into one shared map.
 */
export const ORDER_STATUS_LABEL_RU: Record<OrderStatus, string> = {
  NEW: 'Новый',
  CONTACTED: 'Связались',
  APPROVED: 'Подтверждён',
  AWAITING_PAYMENT: 'Ожидает оплаты',
  PAID: 'Оплачен',
  PRODUCTION: 'В работе',
  READY_FOR_DELIVERY: 'Готов к доставке',
  DELIVERED: 'Доставлен',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
};
