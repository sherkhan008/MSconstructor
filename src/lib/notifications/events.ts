import { formatPrice } from '@/lib/money';
import { ORDER_STATUS_LABEL_RU } from '@/lib/orders/status-labels';
import type { OrderStatus } from '@/lib/types/domain';

/**
 * Internal events and the shapes they travel in: order events, and a new
 * contact-form lead.
 *
 * Payloads are redacted by construction: they have no field that could hold a
 * customer's name, phone, email, address, comment or message, so a log line or
 * a stored delivery row cannot leak them because there is nothing to leak. A
 * channel that must show the customer (the WhatsApp manager alert, the
 * Telegram lead text) reads the persisted record at send time.
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

export const CONTACT_EVENT_TYPES = ['contact.created'] as const;
export type ContactEventType = (typeof CONTACT_EVENT_TYPES)[number];

/** A contact-form lead was stored (src/lib/contact-leads/store.ts). The lead
 * id is the only reference; name, phone and message stay in ContactLead. */
export interface ContactLeadEventPayload {
  event: ContactEventType;
  contactLeadId: string;
  occurredAt: string;
}

export type NotificationEventType = OrderEventType | ContactEventType;
export type NotificationEventPayload = OrderEventPayload | ContactLeadEventPayload;

export function buildContactLeadEvent(contactLeadId: string, occurredAt?: string): ContactLeadEventPayload {
  return { event: 'contact.created', contactLeadId, occurredAt: occurredAt ?? new Date().toISOString() };
}

export function isContactLeadEvent(payload: NotificationEventPayload): payload is ContactLeadEventPayload {
  return payload.event === 'contact.created';
}

/** What an event is about — the outbox key for once-per-subject delivery. */
export type NotificationSubject = { orderNumber: string } | { contactLeadId: string };

export function eventSubject(payload: NotificationEventPayload): NotificationSubject {
  return isContactLeadEvent(payload) ? { contactLeadId: payload.contactLeadId } : { orderNumber: payload.orderNumber };
}

/** Log fields naming the subject: an order number or an opaque lead id — never customer data. */
export function subjectLogFields(subject: NotificationSubject): Record<string, string> {
  return 'orderNumber' in subject ? { order: subject.orderNumber } : { lead: subject.contactLeadId };
}

/** Maximum characters of the customer's message carried into a notification;
 * the full text is always in /admin/leads. */
export const CONTACT_MESSAGE_NOTIFICATION_MAX = 500;

export interface ContactLeadNotificationFields {
  name: string;
  phone: string;
  message: string;
}

/** Telegram text for a new lead: plain text (no parse_mode), so nothing the
 * customer typed can become markup. */
export function formatContactLeadText(lead: ContactLeadNotificationFields): string {
  const message =
    lead.message.length > CONTACT_MESSAGE_NOTIFICATION_MAX
      ? `${lead.message.slice(0, CONTACT_MESSAGE_NOTIFICATION_MAX).trimEnd()}…`
      : lead.message;
  return `Новая заявка с сайта\nИмя: ${lead.name}\nТелефон: ${lead.phone}\nСообщение: ${message}`;
}
