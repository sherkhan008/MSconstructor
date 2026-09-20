import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk, internalError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isOnlinePaymentAvailable } from '@/lib/payments/config';
import { createPaymentIntent } from '@/lib/payments/service';

export const runtime = 'nodejs';

/**
 * Starts an online payment for an existing order.
 *
 * THIS ROUTE DOES NOT EXIST WHILE PAYMENTS ARE DISABLED. Not "returns 403",
 * not "returns an empty result" — it answers 404, before reading the body,
 * before touching the database, and without naming payments in the response.
 * A probe cannot tell it apart from a path that was never deployed, so the
 * build advertises no capability it does not have. That is the default: no
 * provider adapter is registered (src/lib/payments/registry.ts), so
 * isOnlinePaymentAvailable() cannot become true by configuration alone.
 *
 * WHAT THE CLIENT MAY SEND: an order number. That is the whole schema, and it
 * is `.strict()`, so a request carrying `amount`, `status`, `provider` or
 * `paid` is rejected outright rather than having those fields quietly
 * stripped. The amount is read from the order on the server
 * (src/lib/payments/service.ts) and there is no parameter to override it.
 *
 * WHAT IT CANNOT DO: mark anything PAID. This route only ever opens a PENDING
 * attempt. PAID lives behind confirmPaymentWithProvider(), which nothing
 * public calls, and behind the PAYMENT_PROVIDER channel in the order status
 * policy, which no request-shaped input can assert.
 */

const createPaymentSchema = z
  .object({
    orderNumber: z.string().trim().min(1).max(40),
  })
  .strict();

export async function POST(request: NextRequest) {
  // Availability first — nothing below runs for a disabled build.
  if (!isOnlinePaymentAvailable()) {
    return apiError('NOT_FOUND', 'Страница не найдена', 404);
  }

  const rate = await enforceRateLimit('payments', request.headers);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', 'Слишком много попыток оплаты. Попробуйте через минуту.', 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Некорректный запрос на оплату', 400);
  }

  try {
    const result = await createPaymentIntent({ orderNumber: parsed.data.orderNumber });

    if (!result.ok) {
      switch (result.reason) {
        case 'PAYMENTS_UNAVAILABLE':
          // The flag flipped between the check above and here, or the adapter
          // vanished. Same answer as a disabled build.
          return apiError('NOT_FOUND', 'Страница не найдена', 404);
        case 'ORDER_NOT_FOUND':
          return apiError('NOT_FOUND', 'Заказ не найден', 404);
        case 'ORDER_NOT_PAYABLE':
          // Deliberately does not say which status the order is in: the order
          // number is the only thing identifying the caller here, so the
          // response stays as uninformative as the success page already is.
          return apiError('CONFLICT', 'Этот заказ сейчас нельзя оплатить онлайн.', 409);
        case 'PROVIDER_ERROR':
          return apiError('INTERNAL_ERROR', 'Платёжный сервис временно недоступен. Попробуйте позже.', 502);
      }
    }

    // `reused` is not reported: from the customer's side a repeated request
    // simply returns the same payment, which is the point of idempotency.
    return apiOk({ payment: result.payment }, 201);
  } catch (error) {
    return internalError(error);
  }
}
