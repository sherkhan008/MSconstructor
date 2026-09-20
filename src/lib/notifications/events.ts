import { formatPrice } from '@/lib/money';
import { ORDER_STATUS_LABEL_RU } from '@/lib/orders/status-labels';
import type { OrderStatus } from '@/lib/types/domain';

/**
 * Internal order events and the ONE shape they travel in.
 *
 * The payload is redacted by construction: it has no field that could hold a
 * customer's name, phone, email, address or comment, so a channel adapter, a
 * log line or a stored delivery row cannot leak them because there is nothing
 * to leak. A manager who needs the customer opens the order in the admin panel.
 */

export const ORDER_EVENT_TYPES = ['order.created', 'order.status_changed', 'order.paid'] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export interface OrderEventPayload {
  event: OrderEventType;
  orderNumber: string;
  /** Status the order is in after the event. */
  status: OrderStatus;
  /** Only for order.status_changed / order.paid. */
  previousStatus?: OrderStatus;
  grandTotal: number;
  occurredAt: string;
}

export function buildOrderEvent(
  input: Omit<OrderEventPayload, 'occurredAt'> & { occurredAt?: string },
): OrderEventPayload {
  return {
    event: input.event,
    orderNumber: input.orderNumber,
    status: input.status,
    ...(input.previousStatus ? { previousStatus: input.previousStatus } : {}),
    grandTotal: input.grandTotal,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

/** Plain-text body shared by the text channels. Contains no customer data. */
export function formatOrderEventText(payload: OrderEventPayload): string {
  const total = formatPrice(payload.grandTotal);
  switch (payload.event) {
    case 'order.created':
      return `Новый заказ №${payload.orderNumber}\nСумма: ${total}`;
    case 'order.paid':
      return `Заказ №${payload.orderNumber} оплачен\nСумма: ${total}`;
    case 'order.status_changed': {
      const from = payload.previousStatus ? ORDER_STATUS_LABEL_RU[payload.previousStatus] : '—';
      return `Заказ №${payload.orderNumber}: ${from} → ${ORDER_STATUS_LABEL_RU[payload.status]}\nСумма: ${total}`;
    }
  }
}
