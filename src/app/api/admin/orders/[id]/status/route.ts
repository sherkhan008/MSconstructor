import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canChangeOrderStatus } from '@/lib/auth/authorize';
import { updateOrderStatusSchema } from '@/lib/admin/schema';
import { AdminOrderNotFoundError, updateOrderStatus } from '@/lib/admin/orders';
import { requestMeta } from '@/lib/admin/audit';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Admin-only order status change. Never reachable without a valid session
 * (checked here, independent of src/middleware.ts's page-redirect — an API
 * route must never trust middleware alone) and never reachable by
 * CONTENT_MANAGER (spec §13). PAID is an allowed value here like any other
 * status — see canChangeOrderStatus/updateOrderStatus's docs for why this
 * is safe: it's an explicit authenticated-admin action, never something a
 * customer or an unverified request can trigger.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return apiError('UNAUTHORIZED', 'Требуется вход в систему', 401);
  }
  if (!canChangeOrderStatus(admin.role)) {
    return apiError('FORBIDDEN', 'Недостаточно прав для изменения статуса заказа', 403);
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = updateOrderStatusSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Недопустимый статус заказа', 400);
  }

  try {
    const result = await updateOrderStatus({
      orderId: id,
      newStatus: parsed.data.status,
      actor: { id: admin.sub, name: admin.name },
      ...requestMeta(request.headers),
    });
    return apiOk({ ...result });
  } catch (error) {
    if (error instanceof AdminOrderNotFoundError) {
      return apiError('NOT_FOUND', 'Заказ не найден', 404);
    }
    return internalError(error);
  }
}
