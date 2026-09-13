import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canAssignOrder, canClaimUnassignedOrder } from '@/lib/auth/authorize';
import { assignOrderManagerSchema } from '@/lib/admin/schema';
import {
  AdminOrderAssignmentNotAllowedError,
  AdminOrderConflictError,
  AdminOrderManagerNotAssignableError,
  AdminOrderNotFoundError,
  assignOrderManager,
} from '@/lib/admin/orders';
import { requestMeta } from '@/lib/admin/audit';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Sets (or clears) the manager responsible for one order.
 *
 * This route only answers "may this role touch assignment at all" —
 * SUPER_ADMIN/ADMIN may assign anyone, MANAGER may claim a free order for
 * themselves, CONTENT_MANAGER may not act. The *specific* rule (only
 * themselves, only when unassigned, never unassign) needs the order and the
 * actor together and is enforced in assignOrderManager(), which is also the
 * thing that writes. Hiding the button in the UI is never the control.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return apiError('UNAUTHORIZED', 'Требуется вход в систему', 401);
  }
  if (!canAssignOrder(admin.role) && !canClaimUnassignedOrder(admin.role)) {
    return apiError('FORBIDDEN', 'Недостаточно прав для назначения ответственного', 403);
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = assignOrderManagerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Некорректные данные назначения',
      400,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const result = await assignOrderManager({
      orderId: id,
      managerId: parsed.data.managerId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      actor: { id: admin.sub, name: admin.name, role: admin.role },
      ...requestMeta(request.headers),
    });
    return apiOk({ ...result });
  } catch (error) {
    if (error instanceof AdminOrderNotFoundError) {
      return apiError('NOT_FOUND', 'Заказ не найден', 404);
    }
    if (error instanceof AdminOrderAssignmentNotAllowedError) {
      return apiError('FORBIDDEN', error.message, 403);
    }
    if (error instanceof AdminOrderManagerNotAssignableError) {
      return apiError('VALIDATION_ERROR', 'Этого сотрудника нельзя назначить ответственным', 400);
    }
    if (error instanceof AdminOrderConflictError) {
      // 409: someone else changed the order first; their value stays. The
      // client reloads and decides again rather than overwriting blindly.
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
