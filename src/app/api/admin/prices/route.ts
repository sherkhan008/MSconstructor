import type { NextRequest } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canManagePrices } from '@/lib/auth/authorize';
import { adminPriceListQuerySchema } from '@/lib/admin/schema';
import { listAdminPrices } from '@/lib/admin/prices';
import { apiError, apiOk, internalError } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * ADMIN-ONLY catalog price list.
 *
 * This is the one endpoint in the application that may return purchasePrice,
 * and only after canManagePrices() passes — the same values must never appear
 * on any customer-facing route (public catalog, /api/pricing/calculate, cart,
 * public BOM, order responses). Authorization is checked here rather than
 * trusting src/middleware.ts, which only redirects *pages*.
 *
 * Search, filtering, ordering and pagination all run in PostgreSQL
 * (src/lib/admin/prices.ts) — the browser never receives the whole catalog.
 */
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return apiError('UNAUTHORIZED', 'Требуется вход в систему', 401);
  }
  if (!canManagePrices(admin.role)) {
    return apiError('FORBIDDEN', 'Недостаточно прав для управления ценами', 403);
  }

  const { searchParams } = new URL(request.url);
  const parsed = adminPriceListQuerySchema.safeParse({
    q: searchParams.get('q') ?? undefined,
    entityType: searchParams.get('entityType') ?? undefined,
    componentType: searchParams.get('componentType') ?? undefined,
    model: searchParams.get('model') ?? undefined,
    page: searchParams.get('page') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Некорректные параметры запроса', 400);
  }

  try {
    const result = await listAdminPrices({
      search: parsed.data.q,
      entityType: parsed.data.entityType,
      componentType: parsed.data.componentType,
      modelSlug: parsed.data.model,
      page: parsed.data.page,
    });
    return apiOk({ ...result });
  } catch (error) {
    return internalError(error);
  }
}
