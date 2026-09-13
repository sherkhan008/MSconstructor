import type { OrderDocumentKind as PrismaOrderDocumentKind } from '@prisma/client';

/** The customer-facing documents an admin can generate from a saved order.
 * The value doubles as the URL segment of the document route. */
export const ORDER_DOCUMENT_KINDS = ['commercial-proposal', 'invoice'] as const;
export type OrderDocumentKind = (typeof ORDER_DOCUMENT_KINDS)[number];

export function isOrderDocumentKind(value: string): value is OrderDocumentKind {
  return (ORDER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** Explicit two-way mapping to the persisted enum (OrderDocument.kind). */
export const PRISMA_ORDER_DOCUMENT_KIND: Record<OrderDocumentKind, PrismaOrderDocumentKind> = {
  'commercial-proposal': 'COMMERCIAL_PROPOSAL',
  invoice: 'INVOICE',
};

export const ORDER_DOCUMENT_KIND_FROM_PRISMA: Record<PrismaOrderDocumentKind, OrderDocumentKind> = {
  COMMERCIAL_PROPOSAL: 'commercial-proposal',
  INVOICE: 'invoice',
};

export const ORDER_DOCUMENT_TITLE_RU: Record<OrderDocumentKind, string> = {
  'commercial-proposal': 'Коммерческое предложение',
  invoice: 'Счёт на оплату',
};

const NUMBER_PREFIX: Record<OrderDocumentKind, string> = {
  'commercial-proposal': 'KP',
  invoice: 'INV',
};

/**
 * The number a document receives at its first issuance, derived from the
 * order's own unique number: KP-MS-20260830-4HB57 / INV-MS-20260830-4HB57.
 *
 * It is persisted in OrderDocument.documentNumber (unique) and read from
 * there afterwards. Deriving it — rather than count()+1 or a sequence — means
 * it is unique per kind by construction and two concurrent first issuances
 * compute the same value, so the unique constraints settle the race.
 */
export function orderDocumentNumber(kind: OrderDocumentKind, orderNumber: string): string {
  return `${NUMBER_PREFIX[kind]}-${orderNumber}`;
}

/** ASCII-only, path-free file name: nothing from the database can steer a
 * Content-Disposition header or a save dialog outside "<number>.pdf". */
export function orderDocumentFileName(documentNumber: string): string {
  const safe = documentNumber.replace(/[^A-Za-z0-9-]/g, '_').slice(0, 100);
  return `${safe || 'document'}.pdf`;
}
