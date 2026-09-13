import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canGenerateOrderDocuments } from '@/lib/auth/authorize';
import { site } from '@/lib/config/site';
import { apiError, apiOk, internalError } from '@/lib/api/response';
import { buildOrderDocumentContent, DocumentIntegrityError, DocumentUnavailableError } from '@/lib/documents/build';
import { findOrderDocumentIssuance, issueOrderDocument } from '@/lib/documents/issuance';
import { isOrderDocumentKind } from '@/lib/documents/kinds';
import { DocumentAmountError } from '@/lib/documents/money';
import { isPlausibleOrderId, loadOrderDocumentSource } from '@/lib/documents/order-source';
import { createSellerSnapshot, describeSellerIssue, readSellerConfig, sellerConfigIssues } from '@/lib/documents/seller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/orders/:id/documents/:kind/issue
 *
 * Admin-only. This is the ONLY route that ever creates an `OrderDocument`
 * row — it freezes a document's number, issuance instant and seller
 * snapshot exactly once. The paired GET route (.../documents/:kind) only
 * ever reads what this route has already written; it never issues anything
 * itself, so opening a link can never have a side effect.
 *
 * Idempotent: calling this twice for the same order+kind never creates a
 * second row and never changes the first one. The response's `created`
 * flag (and HTTP status: 201 the first time, 200 on every later call) says
 * which happened, but the returned number/date/issuer are the same either
 * way. Concurrent first calls are race-safe: every caller computes the same
 * deterministic number, the database's unique constraints
 * (`OrderDocument.orderId`+`kind`, `OrderDocument.documentNumber`) let
 * exactly one insert through, and the loser re-reads the winner's row
 * instead of erroring (see src/lib/documents/issuance.ts) — so any number
 * of concurrent POSTs settle on one logical issuance.
 *
 * No pricing or repricing happens here: it only reads the order's
 * already-persisted snapshots, and rejects (409) an order that cannot
 * produce a truthful document — a legacy order, or a self-contradictory one
 * — before anything is written. The only write is
 * `prisma.orderDocument.create` with a scalar `orderId`, never a nested
 * `order.update`, so `Order.updatedAt` — the admin order page's
 * optimistic-concurrency token — is never touched by issuing a document.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
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

    // Validates the order-time snapshots are complete and self-consistent —
    // the same check the GET route makes — before any number is issued.
    // The projected content itself is discarded: this route never renders.
    buildOrderDocumentContent(source);

    const existing = await findOrderDocumentIssuance(source.id, kind);
    if (existing) {
      return apiOk({
        kind,
        number: existing.number,
        issuedAt: existing.issuedAt.toISOString(),
        issuedByName: existing.issuedByName,
        created: false,
      });
    }

    const sellerConfig = readSellerConfig();
    const issues = sellerConfigIssues(kind, sellerConfig);
    if (issues.length > 0) {
      return apiError(
        'VALIDATION_ERROR',
        'Не настроены реквизиты продавца, необходимые для документа',
        422,
        issues.map(describeSellerIssue),
      );
    }

    const { document, created } = await issueOrderDocument({
      orderId: source.id,
      orderNumber: source.orderNumber,
      kind,
      seller: createSellerSnapshot(sellerConfig, site.name),
      issuer: { id: admin.sub, name: admin.name },
    });

    return apiOk(
      {
        kind,
        number: document.number,
        issuedAt: document.issuedAt.toISOString(),
        issuedByName: document.issuedByName,
        created,
      },
      created ? 201 : 200,
    );
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
