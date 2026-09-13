import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canManagePrices } from '@/lib/auth/authorize';
import { priceEntityTypeSchema } from '@/lib/admin/schema';
import { listPriceHistory } from '@/lib/admin/prices';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * ADMIN-ONLY price history for one Component or Accessory, newest first.
 *
 * Entries include purchase-price changes, so this is gated by the same
 * canManagePrices() check as the list and the update routes.
 */
export async function GET(
  _request: Request,
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

  try {
    const entries = await listPriceHistory(entityType.data, id);
    return apiOk({ entries });
  } catch (error) {
    return internalError(error);
  }
}
