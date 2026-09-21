import type { NextRequest } from 'next/server';
import { contactRequestSchema } from '@/lib/contact-schema';
import { apiError, apiOk, internalError, toPublicFieldErrors, validationError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { notifyContactRequest } from '@/lib/notifications';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rate = await enforceRateLimit('contact', request.headers);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', 'Слишком много обращений. Попробуйте через минуту.', 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = contactRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('Проверьте правильность заполнения формы', toPublicFieldErrors(parsed.error.issues));
  }

  try {
    void notifyContactRequest(parsed.data);
    return apiOk({ message: 'Заявка отправлена' }, 201);
  } catch (error) {
    return internalError(error);
  }
}
