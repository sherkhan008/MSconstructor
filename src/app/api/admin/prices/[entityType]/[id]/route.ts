import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canManagePrices } from '@/lib/auth/authorize';
import { priceEntityTypeSchema, updatePricesSchema } from '@/lib/admin/schema';
import {
  AdminPriceConflictError,
  AdminPriceEntityNotFoundError,
  updateEntityPrices,
} from '@/lib/admin/prices';
import { requestMeta } from '@/lib/admin/audit';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * ADMIN-ONLY price change for one Component or Accessory.
 *
 * The whole write (entity update + PriceHistory + AuditLog) happens in one
 * transaction inside updateEntityPrices(), which also guards against a stale
 * tab overwriting a newer price and invalidates the catalog cache only after
 * a successful commit.
 *
 * The path speaks business language: `sellingPrice` means Component.sellingPrice
 * and Accessory.unitPrice alike — database column naming is not exposed.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return apiError('UNAUTHORIZED', 'Требуется вход в систему', 401);
  }
  if (!canManagePrices(admin.role)) {
    return apiError('FORBIDDEN', 'Недостаточно прав для управления ценами', 403);
  }

  const { entityType: rawEntityType, id } = await params;
  const entityType = priceEntityTypeSchema.safeParse(rawEntityType.toUpperCase());
  if (!entityType.success) {
    return apiError('VALIDATION_ERROR', 'Неизвестный тип позиции', 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = updatePricesSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Некорректные данные цены',
      400,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const result = await updateEntityPrices({
      entityType: entityType.data,
      id,
      sellingPrice: parsed.data.sellingPrice,
      purchasePrice: parsed.data.purchasePrice,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      reason: parsed.data.reason || undefined,
      actor: { id: admin.sub, name: admin.name },
      ...requestMeta(request.headers),
    });
    return apiOk({ ...result });
  } catch (error) {
    if (error instanceof AdminPriceEntityNotFoundError) {
      return apiError('NOT_FOUND', 'Позиция не найдена', 404);
    }
    if (error instanceof AdminPriceConflictError) {
      // 409: the newer value stays in the database untouched — the client must
      // reload and decide again, never blind-overwrite.
      return apiError(
        'CONFLICT',
        'Цена уже была изменена другим пользователем. Обновите данные.',
        409,
        error.currentUpdatedAt ? [error.currentUpdatedAt] : undefined,
      );
    }
    return internalError(error);
  }
}
