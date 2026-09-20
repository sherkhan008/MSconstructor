import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canChangeOrderStatus } from '@/lib/auth/authorize';
import { updateOrderStatusSchema } from '@/lib/admin/schema';
import {
  AdminOrderConflictError,
  AdminOrderNotFoundError,
  AdminOrderStatusTransitionNotAllowedError,
  updateOrderStatus,
} from '@/lib/admin/orders';
import { requestMeta } from '@/lib/admin/audit';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Admin-only order status change — the ONLY route in the application that can
 * move an order through the workflow.
 *
 * Never reachable without a valid session (checked here, independent of
 * src/middleware.ts's page-redirect — an API route must never trust middleware
 * alone) and never reachable by CONTENT_MANAGER (spec §13).
 *
 * PAID is an allowed value here like any other status, and only because of
 * what this route already established before it calls the service: a verified
 * admin session in an operational role. That is what `channel: 'ADMIN'` below
 * asserts — it is passed from here and nowhere else. No public route calls
 * updateOrderStatus at all, and a PUBLIC channel is refused every transition
 * by the policy, so there is no request a customer's browser can shape that
 * ends in PAID. Nothing in the body is trusted beyond the status name: totals,
 * amounts and any other client-supplied field are ignored outright.
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
      channel: 'ADMIN',
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      actor: { id: admin.sub, name: admin.name },
      ...requestMeta(request.headers),
    });
    return apiOk({ ...result });
  } catch (error) {
    if (error instanceof AdminOrderNotFoundError) {
      return apiError('NOT_FOUND', 'Заказ не найден', 404);
    }
    if (error instanceof AdminOrderStatusTransitionNotAllowedError) {
      // UNTRUSTED_CHANNEL cannot happen from this route (an admin session is
      // trusted with every status) — it is answered anyway rather than falling
      // through to a 500, so the boundary stays explicit if the policy ever
      // narrows what an admin may set.
      if (error.reason === 'UNTRUSTED_CHANNEL') {
        return apiError('FORBIDDEN', 'Этот статус нельзя установить из админ-панели', 403);
      }
      // 409, not 400: the value is a real status, it just does not follow from
      // the state the order is in now — usually because the page is stale.
      return apiError(
        'CONFLICT',
        error.reason === 'TERMINAL'
          ? 'Заказ завершён — его статус больше не меняется. Обновите страницу.'
          : 'Такой переход статуса недопустим. Обновите страницу.',
        409,
      );
    }
    if (error instanceof AdminOrderConflictError) {
      // Someone else moved the order first; their change stays. The client
      // reloads and decides again rather than overwriting blindly.
      return apiError(
        'CONFLICT',
        'Заказ уже был изменён другим пользователем. Обновите страницу.',
        409,
        error.currentUpdatedAt ? [error.currentUpdatedAt] : undefined,
      );
    }
    return internalError(error);
  }
}
