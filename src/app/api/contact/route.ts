import type { NextRequest } from 'next/server';
import { contactRequestSchema } from '@/lib/contact-schema';
import { apiError, apiOk, internalError } from '@/lib/api/response';
import { checkRateLimit, clientKeyFromHeaders, RATE_LIMITS } from '@/lib/rate-limit';
import { notifyContactRequest } from '@/lib/notifications';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const key = `contact:${clientKeyFromHeaders(request.headers)}`;
  const rate = checkRateLimit(key, RATE_LIMITS.contact.limit, RATE_LIMITS.contact.windowMs);
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
    return apiError(
      'VALIDATION_ERROR',
      'Проверьте правильность заполнения формы',
      400,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }

  try {
    void notifyContactRequest(parsed.data);
    return apiOk({ message: 'Заявка отправлена' }, 201);
  } catch (error) {
    return internalError(error);
  }
}
