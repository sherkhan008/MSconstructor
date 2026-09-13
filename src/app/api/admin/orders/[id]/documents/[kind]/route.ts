import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canGenerateOrderDocuments } from '@/lib/auth/authorize';
import { getCatalog } from '@/lib/data/repository';
import { apiError, internalError } from '@/lib/api/response';
import { buildOrderDocument, DocumentIntegrityError } from '@/lib/documents/build';
import { isOrderDocumentKind, orderDocumentFileName } from '@/lib/documents/kinds';
import { documentLabelsFromCatalog } from '@/lib/documents/labels';
import { DocumentAmountError } from '@/lib/documents/money';
import { isPlausibleOrderId, loadOrderDocumentSource } from '@/lib/documents/order-source';
import { renderOrderDocumentPdf } from '@/lib/documents/pdf';
import { describeSellerIssue, readSellerConfig, sellerConfigIssues } from '@/lib/documents/seller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders/:id/documents/:kind[?download=1]
 *
 * Admin-only PDF of a saved order: `commercial-proposal` or `invoice`.
 *
 * Read-only by construction: the order is loaded through an explicit column
 * allow-list (loadOrderDocumentSource), projected by a pure builder and
 * rendered — nothing is written, so opening the same document twice returns
 * the same bytes and never touches the order. The request carries no body
 * and no amounts; every number in the PDF comes from the persisted order.
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

    const seller = readSellerConfig();
    const issues = sellerConfigIssues(kind, seller);
    if (issues.length > 0) {
      return apiError(
        'VALIDATION_ERROR',
        'Не настроены реквизиты продавца, необходимые для документа',
        422,
        issues.map(describeSellerIssue),
      );
    }

    const labels = documentLabelsFromCatalog(await getCatalog());
    const model = buildOrderDocument(kind, source, seller.details, labels);
    const pdf = await renderOrderDocumentPdf(model);

    const fileName = orderDocumentFileName(kind, source.orderNumber);
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
    if (error instanceof DocumentIntegrityError || error instanceof DocumentAmountError) {
      return apiError('CONFLICT', `Документ не сформирован: ${error.message}`, 409);
    }
    return internalError(error);
  }
}
