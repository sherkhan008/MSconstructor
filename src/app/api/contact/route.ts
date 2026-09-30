import type { NextRequest } from 'next/server';
import { contactRequestSchemaFor } from '@/lib/contact-schema';
import { apiError, apiOk, internalError, toPublicFieldErrors, validationError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { saveContactLead } from '@/lib/contact-leads/store';
import { buildContactLeadEvent } from '@/lib/notifications/events';
import { createOutbox } from '@/lib/notifications/service';
import { requestLocale } from '@/lib/i18n/request';
import { t } from '@/lib/i18n/format';
import { ER } from '@/lib/i18n/strings';

export const runtime = 'nodejs';

/**
 * Contact form. Success means ONE thing: the lead is stored in the database.
 *
 * rate limit → JSON → validation (phone normalised) → ONE transaction: the
 * ContactLead + its PENDING notification outbox rows → 201. The manager alert
 * (WhatsApp, Telegram) is attempted only after commit, in the background
 * (src/lib/notifications/service.ts createOutbox); anything not delivered is
 * sent by the notifications worker. A slow, failing or unconfigured provider
 * can neither delay nor fail the submission, and a stored lead can never be
 * without its notification event. If the transaction fails, nothing is
 * stored and the customer gets a generic error — never a false success.
 *
 * An identical name + phone + message resent within the duplicate window is
 * answered as stored without a second lead or a second alert
 * (src/lib/contact-leads/store.ts).
 *
 * Customer-visible messages follow the request's declared locale
 * (src/lib/i18n/request.ts). Nothing the customer typed is logged.
 */
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

  const outbox = createOutbox('contact.created');
  let saved: Awaited<ReturnType<typeof saveContactLead>>;
  try {
    saved = await saveContactLead({ ...parsed.data, locale }, new Date(), {
      outbox: (lead) => outbox.rowsFor(buildContactLeadEvent(lead.id)),
    });
  } catch (error) {
    return internalError(error, locale);
  }

  if (!saved.duplicate) outbox.dispatchInBackground();
  return apiOk({ message: t(ER['ER-058'], locale) }, 201);
}
