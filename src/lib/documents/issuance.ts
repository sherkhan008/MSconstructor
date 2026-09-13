import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { DocumentIntegrityError, type DocumentIssuance } from './build';
import { ORDER_DOCUMENT_KIND_FROM_PRISMA, PRISMA_ORDER_DOCUMENT_KIND, orderDocumentNumber, type OrderDocumentKind } from './kinds';
import { parseSellerSnapshot, type SellerSnapshot } from './seller';

/**
 * The issuance lifecycle of a commercial document (OrderDocument).
 *
 * The first time a document is generated for an order it is *issued*: its
 * number, issue instant and seller snapshot are persisted. Every later
 * generation reads that row, so the same document keeps the same number,
 * date and seller block no matter how SELLER_* or the brand change.
 *
 * Concurrency: two first requests can race. Both compute the same number
 * and both try to create; @@unique([orderId, kind]) (and the unique
 * documentNumber) let exactly one row in, the loser catches P2002 and re-reads
 * the winner's row. Both requests then render the one logical document.
 *
 * Writes go to OrderDocument only, through prisma.orderDocument.create with a
 * scalar orderId. Nothing here updates Order — in particular not through a
 * nested order.update — so Order.updatedAt, the admin order page's
 * compare-and-swap token, is never bumped by issuing a document.
 */

export interface IssuedOrderDocument extends DocumentIssuance {
  kind: OrderDocumentKind;
  issuedByName: string;
}

const ISSUANCE_SELECT = {
  kind: true,
  documentNumber: true,
  issuedAt: true,
  sellerSnapshot: true,
  issuedByName: true,
} satisfies Prisma.OrderDocumentSelect;

type IssuanceRow = Prisma.OrderDocumentGetPayload<{ select: typeof ISSUANCE_SELECT }>;

function toIssued(row: IssuanceRow): IssuedOrderDocument {
  const kind = ORDER_DOCUMENT_KIND_FROM_PRISMA[row.kind];
  const seller = parseSellerSnapshot(row.sellerSnapshot, kind);
  if (!seller) {
    throw new DocumentIntegrityError('Сохранённые реквизиты продавца выставленного документа повреждены.');
  }
  return {
    kind,
    number: row.documentNumber,
    issuedAt: row.issuedAt,
    brandName: seller.brandName,
    seller: seller.details,
    issuedByName: row.issuedByName,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export async function findOrderDocumentIssuance(orderId: string, kind: OrderDocumentKind): Promise<IssuedOrderDocument | null> {
  const row = await prisma.orderDocument.findUnique({
    where: { orderId_kind: { orderId, kind: PRISMA_ORDER_DOCUMENT_KIND[kind] } },
    select: ISSUANCE_SELECT,
  });
  return row ? toIssued(row) : null;
}

/** Every issued document of an order, for the admin order page. Rows whose
 * stored seller snapshot is unreadable are reported as not issued-readable. */
export async function listOrderDocumentIssuances(orderId: string): Promise<Partial<Record<OrderDocumentKind, IssuedOrderDocument>>> {
  const rows = await prisma.orderDocument.findMany({ where: { orderId }, select: ISSUANCE_SELECT });
  const result: Partial<Record<OrderDocumentKind, IssuedOrderDocument>> = {};
  for (const row of rows) {
    try {
      const issued = toIssued(row);
      result[issued.kind] = issued;
    } catch {
      // Surfaced by the document route itself as a 409 with the reason.
    }
  }
  return result;
}

export interface IssueOrderDocumentInput {
  orderId: string;
  orderNumber: string;
  kind: OrderDocumentKind;
  /** Validated current seller configuration, frozen into the snapshot. */
  seller: SellerSnapshot;
  issuer: { id: string; name: string };
  now?: Date;
}

/** Race-safe find-or-create. `created` is false when another request (or an
 * earlier one) issued the document first; its row is returned unchanged. */
export async function issueOrderDocument(input: IssueOrderDocumentInput): Promise<{ document: IssuedOrderDocument; created: boolean }> {
  const kind = PRISMA_ORDER_DOCUMENT_KIND[input.kind];
  try {
    const row = await prisma.orderDocument.create({
      data: {
        orderId: input.orderId,
        kind,
        documentNumber: orderDocumentNumber(input.kind, input.orderNumber),
        issuedAt: input.now ?? new Date(),
        sellerSnapshot: input.seller as unknown as Prisma.InputJsonValue,
        issuedById: input.issuer.id,
        issuedByName: input.issuer.name.slice(0, 200),
      },
      select: ISSUANCE_SELECT,
    });
    return { document: toIssued(row), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findOrderDocumentIssuance(input.orderId, input.kind);
    if (!existing) throw error;
    return { document: existing, created: false };
  }
}
