import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canEditInternalNotes } from '@/lib/auth/authorize';
import { updateOrderInternalNotesSchema } from '@/lib/admin/schema';
import {
  AdminOrderAssignmentNotAllowedError,
  AdminOrderConflictError,
  AdminOrderNotFoundError,
  updateOrderInternalNotes,
} from '@/lib/admin/orders';
import { requestMeta } from '@/lib/admin/audit';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Replaces one order's internal notes.
 *
 * ADMIN-ONLY in the strictest sense: internal notes are never part of any
 * customer-facing payload, and this is the only route that writes them.
 * SUPER_ADMIN/ADMIN/MANAGER may edit; CONTENT_MANAGER is read-only, rejected
 * here and again in the service.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return apiError('UNAUTHORIZED', 'Требуется вход в систему', 401);
  }
  if (!canEditInternalNotes(admin.role)) {
    return apiError('FORBIDDEN', 'Недостаточно прав для изменения внутренних заметок', 403);
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = updateOrderInternalNotesSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Некорректная внутренняя заметка',
      400,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const result = await updateOrderInternalNotes({
      orderId: id,
      internalNotes: parsed.data.internalNotes,
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
    if (error instanceof AdminOrderConflictError) {
      return apiError(
        'CONFLICT',
        'Заметка уже была изменена другим пользователем. Обновите страницу.',
        409,
        error.currentUpdatedAt ? [error.currentUpdatedAt] : undefined,
      );
    }
    return internalError(error);
  }
}
