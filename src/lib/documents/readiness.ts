import { buildOrderDocumentContent, DocumentIntegrityError, DocumentUnavailableError, formatDocumentDate } from './build';
import { listOrderDocumentIssuances } from './issuance';
import { ORDER_DOCUMENT_KINDS, ORDER_DOCUMENT_TITLE_RU, orderDocumentNumber, type OrderDocumentKind } from './kinds';
import { DocumentAmountError } from './money';
import { loadOrderDocumentSource } from './order-source';
import { describeSellerIssue, readSellerConfig, sellerConfigIssues } from './seller';

/**
 * What the admin order page's "Документы" panel shows for each document:
 * issued (with its persisted number/date, opened/downloaded via GET), ready
 * to issue (an action posts to `issueHref`), or blocked — and why. It runs
 * exactly the checks the document routes run (the same content validation
 * and seller requirements), so the panel never offers an action that would
 * only return an error.
 */

export interface OrderDocumentStatus {
  kind: OrderDocumentKind;
  title: string;
  /** Persisted number once issued; otherwise the number issuance will assign. */
  number: string;
  /** GET — renders an already-issued document. Meaningless until issued. */
  href: string;
  /** POST — issues the document (idempotent; creates it at most once). */
  issueHref: string;
  issued: { dateText: string; issuedByName: string } | null;
  /** Set when the document cannot be generated; `details` lists specifics. */
  blocked: { reason: string; details: string[] } | null;
  notes: string[];
}

export async function getOrderDocumentStatuses(orderId: string): Promise<OrderDocumentStatus[]> {
  const [source, issued] = await Promise.all([loadOrderDocumentSource(orderId), listOrderDocumentIssuances(orderId)]);
  if (!source) return [];

  let contentBlock: OrderDocumentStatus['blocked'] = null;
  try {
    buildOrderDocumentContent(source);
  } catch (error) {
    if (error instanceof DocumentUnavailableError) {
      contentBlock = { reason: error.message, details: error.details };
    } else if (error instanceof DocumentIntegrityError || error instanceof DocumentAmountError) {
      contentBlock = { reason: 'Сохранённые данные заказа противоречивы, документ не формируется.', details: [error.message] };
    } else {
      throw error;
    }
  }

  const sellerConfig = readSellerConfig();
  return ORDER_DOCUMENT_KINDS.map((kind) => {
    const issuance = issued[kind];
    const href = `/api/admin/orders/${encodeURIComponent(source.id)}/documents/${kind}`;
    const base = {
      kind,
      title: ORDER_DOCUMENT_TITLE_RU[kind],
      number: issuance?.number ?? orderDocumentNumber(kind, source.orderNumber),
      href,
      issueHref: `${href}/issue`,
      issued: issuance ? { dateText: formatDocumentDate(issuance.issuedAt), issuedByName: issuance.issuedByName } : null,
    };
    if (contentBlock) return { ...base, blocked: contentBlock, notes: [] };
    if (issuance) return { ...base, blocked: null, notes: [] };

    const sellerIssues = sellerConfigIssues(kind, sellerConfig);
    if (sellerIssues.length > 0) {
      return {
        ...base,
        blocked: { reason: 'Документ нельзя сформировать: не настроены реквизиты продавца.', details: sellerIssues.map(describeSellerIssue) },
        notes: [],
      };
    }
    const notes = ['Номер, дата и реквизиты продавца будут зафиксированы при формировании документа.'];
    if (kind === 'commercial-proposal' && !sellerConfig.details.legalName) {
      notes.push('Юридические реквизиты продавца не заданы (SELLER_*): в предложении будет указано только название бренда.');
    }
    return { ...base, blocked: null, notes };
  });
}
