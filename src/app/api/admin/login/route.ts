import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '@/lib/auth/session';
import { recordAuditLog, requestMeta } from '@/lib/admin/audit';
import { adminLoginSchema } from '@/lib/admin/schema';
import { apiError, apiOk, internalError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import type { AdminRole } from '@/lib/types/domain';

export const runtime = 'nodejs';

/**
 * Admin login. Every failure path returns the same generic message — never
 * reveals whether the email exists, the account is inactive, or the
 * password was wrong, while still recording the real reason in AuditLog
 * for internal review.
 */
export async function POST(request: NextRequest) {
  const rate = await enforceRateLimit('adminLogin', request.headers);
  if (rate.reason === 'store-unavailable') {
    // Shared limiter unreachable: refuse rather than allow unmetered attempts.
    return apiError('INTERNAL_ERROR', 'Вход временно недоступен. Попробуйте позже.', 503);
  }
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', 'Слишком много попыток входа. Попробуйте через минуту.', 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Введите email и пароль', 400);
  }
  const { email, password } = parsed.data;
  const meta = requestMeta(request.headers);
  const genericError = () => apiError('UNAUTHORIZED', 'Неверный email или пароль', 401);

  try {
    assertAdminDatabaseConfigured();
  } catch {
    return apiError('INTERNAL_ERROR', 'Админ-панель недоступна: не настроена база данных.', 503);
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      await recordAuditLog({
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'USER',
        entityId: user?.id,
        newData: { email, reason: !user ? 'unknown_email' : !user.active ? 'inactive' : 'bad_password' },
        ...meta,
      });
      return genericError();
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = await createSessionToken({ id: user.id, email: user.email, name: user.name, role: user.role as AdminRole });

    const store = await cookies();
    store.set({ name: SESSION_COOKIE_NAME, value: token, maxAge: SESSION_TTL_SECONDS, ...sessionCookieOptions() });

    await recordAuditLog({
      userId: user.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'USER',
      entityId: user.id,
      ...meta,
    });

    return apiOk({ name: user.name, role: user.role });
  } catch (error) {
    return internalError(error);
  }
}
