import type { OrderStatus } from '@/lib/types/domain';

/** Canonical, ordered list of every OrderStatus value — the single source
 * `z.enum` validation and the label map below both derive from. */
export const ORDER_STATUS_VALUES = [
  'NEW',
  'CONFIRMED',
  'AWAITING_PAYMENT',
  'PAID',
  'IN_PROGRESS',
  'READY',
  'DELIVERED',
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
  CONFIRMED: 'Подтверждён',
  AWAITING_PAYMENT: 'Ожидает оплаты',
  PAID: 'Оплачен',
  IN_PROGRESS: 'В работе',
  READY: 'Готов к выдаче',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
};

/**
 * The button copy for *moving* an order into a status, as opposed to naming
 * the status it is in. "Ожидает оплаты" is a state; "Выставить счёт" is the
 * action an admin is about to take — a separate map because an action label
 * that reads like a state label makes the workflow buttons ambiguous.
 */
export const ORDER_STATUS_ACTION_LABEL_RU: Record<OrderStatus, string> = {
  NEW: 'Вернуть в новые',
  CONFIRMED: 'Подтвердить заказ',
  AWAITING_PAYMENT: 'Выставить к оплате',
  PAID: 'Отметить оплаченным',
  IN_PROGRESS: 'Взять в работу',
  READY: 'Готов к выдаче',
  DELIVERED: 'Отметить доставленным',
  CANCELLED: 'Отменить заказ',
};
