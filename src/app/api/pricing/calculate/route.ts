import type { NextRequest } from 'next/server';
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { stripBomCosts } from '@/lib/pricing/bom';
import { apiError, apiOk, internalError, type ApiErrorCode } from '@/lib/api/response';
import { checkRateLimit, clientKeyFromHeaders, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Authoritative server-side price calculation. The configurator, cart and
 * checkout all call this endpoint instead of computing a price in the
 * browser — a client-submitted price or total is never accepted anywhere in
 * the order flow.
 */
export async function POST(request: NextRequest) {
  const key = `pricing:${clientKeyFromHeaders(request.headers)}`;
  const rate = checkRateLimit(key, RATE_LIMITS.pricing.limit, RATE_LIMITS.pricing.windowMs);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', 'Слишком много запросов. Попробуйте через минуту.', 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  try {
    const catalog = await getCatalog();
    const result = calculatePrice(body, catalog);

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
      return apiError(apiCode, result.message, statusByCode[result.code], result.details);
    }

    return apiOk({
      configuration: result.configuration,
      bom: stripBomCosts(result.bom),
      breakdown: result.breakdown,
      totalWeightKg: result.totalWeightKg,
      rowLengthMm: result.rowLengthMm,
      leadTimeDays: result.leadTimeDays,
      deliveryNote: result.deliveryNote,
      warnings: result.warnings,
    });
  } catch (error) {
    return internalError(error);
  }
}
