import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canGenerateOrderDocuments } from '@/lib/auth/authorize';
import { apiError, internalError } from '@/lib/api/response';
import { buildOrderDocument, buildOrderDocumentContent, DocumentIntegrityError, DocumentUnavailableError } from '@/lib/documents/build';
import { findOrderDocumentIssuance } from '@/lib/documents/issuance';
import { isOrderDocumentKind, orderDocumentFileName } from '@/lib/documents/kinds';
import { DocumentAmountError } from '@/lib/documents/money';
import { isPlausibleOrderId, loadOrderDocumentSource } from '@/lib/documents/order-source';
import { renderOrderDocumentPdf } from '@/lib/documents/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders/:id/documents/:kind[?download=1]
 *
 * Admin-only PDF of an ALREADY-ISSUED document: `commercial-proposal` or
 * `invoice`. Strictly read-only — this handler never creates or mutates an
 * `OrderDocument`, an order, or anything else. Issuing (freezing the
 * document's number, date and seller snapshot the first time) is a
 * separate, explicit action: POST .../documents/:kind/issue. A GET against
 * a document that has not been issued yet is refused (409) rather than
 * issuing it as a side effect of a "safe" HTTP method.
 *
 * 1. The order is loaded through an explicit column allow-list and validated
 *    against its order-time snapshots. An order that cannot produce a
 *    truthful document (placed before snapshots existed, or contradictory)
 *    is refused here (409), independent of whether it was ever issued.
 * 2. The persisted issuance (number, date, seller snapshot) is looked up.
 *    If none exists, 409 — issue it first via the POST route above.
 * 3. The PDF is rendered from the persisted content and the persisted
 *    issuance. Nothing is written by this request.
 *
 * The request carries no body and no amounts; every number in the PDF comes
 * from the persisted order.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return apiError('UNAUTHORIZED', 'Требуется вход в систему', 401);
  }
  if (!canGenerateOrderDocuments(admin.role)) {
    return apiError('FORBIDDEN', 'Недостаточно прав для формирования документов', 403);
  }

  const { id, kind } = await params;
  if (!isOrderDocumentKind(kind) || !isPlausibleOrderId(id)) {
    return apiError('NOT_FOUND', 'Документ не найден', 404);
  }

  try {
    const source = await loadOrderDocumentSource(id);
    if (!source) {
      return apiError('NOT_FOUND', 'Заказ не найден', 404);
    }

    const content = buildOrderDocumentContent(source);

    const issuance = await findOrderDocumentIssuance(source.id, kind);
    if (!issuance) {
      return apiError(
        'CONFLICT',
        'Документ ещё не выставлен.',
        409,
        [`Сначала сформируйте его: POST /api/admin/orders/${encodeURIComponent(id)}/documents/${kind}/issue`],
      );
    }

    const pdf = await renderOrderDocumentPdf(buildOrderDocument(kind, content, issuance));

    const fileName = orderDocumentFileName(issuance.number);
    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    if (error instanceof DocumentUnavailableError) {
      return apiError('CONFLICT', `Документ не сформирован: ${error.message}`, 409, error.details);
    }
    if (error instanceof DocumentIntegrityError || error instanceof DocumentAmountError) {
      return apiError('CONFLICT', `Документ не сформирован: ${error.message}`, 409);
    }
    return internalError(error);
  }
}
