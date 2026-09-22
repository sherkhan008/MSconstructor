import type { NextRequest } from 'next/server';
import { contactRequestSchemaFor } from '@/lib/contact-schema';
import { apiError, apiOk, internalError, toPublicFieldErrors, validationError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { notifyContactRequest } from '@/lib/notifications';
import { requestLocale } from '@/lib/i18n/request';
import { t } from '@/lib/i18n/format';
import { ER } from '@/lib/i18n/strings';

export const runtime = 'nodejs';

/** Customer-visible messages follow the request's declared locale (src/lib/i18n/request.ts). */
export async function POST(request: NextRequest) {
  const locale = requestLocale(request.headers);
  const rate = await enforceRateLimit('contact', request.headers);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', t(ER['ER-003'], locale), 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', t(ER['ER-004'], locale), 400);
  }

  const parsed = contactRequestSchemaFor(locale).safeParse(body);
  if (!parsed.success) {
    return validationError(t(ER['ER-005'], locale), toPublicFieldErrors(parsed.error.issues));
  }

  try {
    void notifyContactRequest(parsed.data);
    return apiOk({ message: t(ER['ER-058'], locale) }, 201);
  } catch (error) {
    return internalError(error, locale);
  }
}
