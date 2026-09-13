/** The customer-facing documents an admin can generate from a saved order.
 * The value doubles as the URL segment of the document route. */
export const ORDER_DOCUMENT_KINDS = ['commercial-proposal', 'invoice'] as const;
export type OrderDocumentKind = (typeof ORDER_DOCUMENT_KINDS)[number];

export function isOrderDocumentKind(value: string): value is OrderDocumentKind {
  return (ORDER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const ORDER_DOCUMENT_TITLE_RU: Record<OrderDocumentKind, string> = {
  'commercial-proposal': 'Коммерческое предложение',
  invoice: 'Счёт на оплату',
};

const NUMBER_PREFIX: Record<OrderDocumentKind, string> = {
  'commercial-proposal': 'KP',
  invoice: 'INV',
};

/**
 * Deterministic document number derived from the order's own unique number:
 * KP-MS-20260830-4HB57 / INV-MS-20260830-4HB57.
 *
 * No counter, no count()+1, no sequence table — the order number is already
 * unique (Order.orderNumber @unique), so the document number is unique per
 * kind, can never race, and generating the same document twice yields the
 * same number.
 */
export function orderDocumentNumber(kind: OrderDocumentKind, orderNumber: string): string {
  return `${NUMBER_PREFIX[kind]}-${orderNumber}`;
}

/** ASCII-only, path-free file name: nothing from the database can steer a
 * Content-Disposition header or a save dialog outside "<number>.pdf". */
export function orderDocumentFileName(kind: OrderDocumentKind, orderNumber: string): string {
  const safe = orderDocumentNumber(kind, orderNumber).replace(/[^A-Za-z0-9-]/g, '_').slice(0, 100);
  return `${safe}.pdf`;
}
