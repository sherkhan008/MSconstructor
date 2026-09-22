import type { NextRequest } from 'next/server';
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { toPublicPriceFailure, toPublicPriceResult } from '@/lib/pricing/public-result';
import { apiError, apiOk, internalError, type ApiErrorCode } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requestLocale } from '@/lib/i18n/request';
import { t } from '@/lib/i18n/format';
import { ER } from '@/lib/i18n/strings';

export const runtime = 'nodejs';

/**
 * Authoritative server-side price calculation. The configurator, cart and
 * checkout all call this endpoint instead of computing a price in the
 * browser — a client-submitted price or total is never accepted anywhere in
 * the order flow.
 *
 * The response is the customer-safe projection (toPublicPriceResult): no
 * markup, no pre-markup component subtotal or colour surcharge, and no
 * per-line component prices from which either could be recomputed.
 *
 * Customer-visible texts follow the request's declared locale (see
 * src/lib/i18n/request.ts); the numbers never depend on it.
 */
export async function POST(request: NextRequest) {
  const locale = requestLocale(request.headers);
  const rate = await enforceRateLimit('pricing', request.headers);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', t(ER['ER-001'], locale), 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', t(ER['ER-004'], locale), 400);
  }

  try {
    const catalog = await getCatalog();
    const result = calculatePrice(body, catalog, { locale });

    if (!result.ok) {
      const statusByCode: Record<typeof result.code, number> = {
        VALIDATION_ERROR: 400,
        UNKNOWN_MODEL: 404,
        INCOMPATIBLE_CONFIGURATION: 422,
        MISSING_COMPONENT: 422,
        INVALID_FORMULA: 500,
        INDIVIDUAL_QUOTE_REQUIRED: 200,
      };
      const apiCode: ApiErrorCode = result.code === 'INVALID_FORMULA' ? 'INTERNAL_ERROR' : result.code;
      // Through the public projection, never straight off the engine result:
      // a PriceFailure can carry server-only diagnostics (internalDetails).
      const publicFailure = toPublicPriceFailure(result);
      return apiError(apiCode, publicFailure.message, statusByCode[result.code], publicFailure.details);
    }

    const { ok: _ok, ...publicResult } = toPublicPriceResult(result, { locale, names: catalog });
    return apiOk(publicResult);
  } catch (error) {
    return internalError(error, locale);
  }
}
