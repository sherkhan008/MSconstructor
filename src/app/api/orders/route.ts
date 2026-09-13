import type { NextRequest } from 'next/server';
import { findDelivery, findModel, getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { stripBomCosts } from '@/lib/pricing/bom';
import { orderRequestSchema } from '@/lib/pricing/schema';
import { apiError, apiOk, internalError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { generateOrderNumber, saveOrder } from '@/lib/orders/store';
import type { OrderItemRecord, OrderRecord } from '@/lib/orders/types';
import { notifyNewOrder } from '@/lib/notifications';
import { createOrderBuyerSnapshot, createOrderItemDocumentSnapshot } from '@/lib/documents/snapshots';

export const runtime = 'nodejs';

/**
 * Order submission (spec §30). Every configuration in the request is
 * re-priced from scratch against the current catalog — the totals shown on
 * the client are never written to the database as-is.
 */
export async function POST(request: NextRequest) {
  const rate = await enforceRateLimit('orders', request.headers);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', 'Слишком много заявок. Попробуйте через минуту.', 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Некорректное тело запроса', 400);
  }

  const parsed = orderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Проверьте правильность заполнения формы',
      400,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const input = parsed.data;

  try {
    const catalog = await getCatalog();
    const items: OrderItemRecord[] = [];

    for (const rawItem of input.items) {
      const result = calculatePrice(rawItem.configuration, catalog);
      if (!result.ok) {
        return apiError(
          result.code === 'INVALID_FORMULA' ? 'INTERNAL_ERROR' : result.code,
          `Не удалось рассчитать одну из позиций заказа: ${result.message}`,
          422,
          result.details,
        );
      }
      const model = findModel(catalog, result.configuration.modelSlug);
      items.push({
        configuration: result.configuration,
        // Internal snapshot: full component-level detail (beams, frame ties
        // and all), cost stripped. It is read only by the admin order view
        // and production/notification output, never rendered to a customer —
        // the customer-facing kit composition is toPublicBom() in
        // /api/pricing/calculate. Keeping the detail here is what lets an
        // order still be picked and assembled.
        bom: stripBomCosts(result.bom),
        breakdown: result.breakdown,
        modelName: model?.name.ru ?? result.configuration.modelSlug,
        // Order-time facts for commercial documents (names, public kit, price
        // breakdown and VAT basis), frozen now against the same catalog this
        // item was just priced with — see src/lib/documents/snapshots.ts.
        documentSnapshot: createOrderItemDocumentSnapshot(
          {
            configuration: result.configuration,
            bom: result.bom,
            breakdown: result.breakdown,
            pricesIncludeVat: catalog.pricingSettings.pricesIncludeVat,
          },
          catalog,
        ),
      });
    }

    // A delivery method may require a real address (e.g. city/country
    // delivery) even though pickup does not — inferred from each item's own
    // already-validated deliveryId against the catalog, never guessed.
    const addressRequired = items.some((item) => findDelivery(catalog, item.configuration.deliveryId)?.requiresAddress);
    if (addressRequired && !input.deliveryAddress?.trim()) {
      return apiError(
        'VALIDATION_ERROR',
        'Проверьте правильность заполнения формы',
        400,
        ['deliveryAddress: Укажите адрес доставки'],
      );
    }

    const netTotal = items.reduce((sum, item) => sum + item.breakdown.net, 0);
    const vatTotal = items.reduce((sum, item) => sum + item.breakdown.vat, 0);
    const discountTotal = items.reduce((sum, item) => sum + item.breakdown.discount, 0);
    const grandTotal = items.reduce((sum, item) => sum + item.breakdown.total, 0);

    const customer: OrderRecord['customer'] = {
      fullName: input.fullName,
      phone: input.phone,
      whatsapp: input.whatsapp || undefined,
      email: input.email || undefined,
      city: input.city,
      companyName: input.companyName,
      binIin: input.binIin || undefined,
      type: input.customerType,
    };

    const order: OrderRecord = {
      id: crypto.randomUUID(),
      orderNumber: generateOrderNumber(),
      status: 'NEW',
      customer,
      // The shared Customer row is upserted (and overwritten) by the next
      // order from the same phone; this copy is what documents print.
      buyerSnapshot: createOrderBuyerSnapshot(customer),
      deliveryAddress: input.deliveryAddress,
      paymentPreference: input.paymentPreference,
      comment: input.comment,
      items,
      netTotal,
      vatTotal,
      discountTotal,
      grandTotal,
      createdAt: new Date().toISOString(),
    };

    const saved = await saveOrder(order);

    // Best-effort — a notification failure must never roll back a saved order.
    void notifyNewOrder(saved);

    return apiOk({ orderNumber: saved.orderNumber, grandTotal: saved.grandTotal }, 201);
  } catch (error) {
    return internalError(error);
  }
}
