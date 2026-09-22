import type { NextRequest } from 'next/server';
import { findDelivery, findModel, getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { stripBomCosts } from '@/lib/pricing/bom';
import { toPublicPriceFailure } from '@/lib/pricing/public-result';
import { schemasFor } from '@/lib/pricing/schema';
import { apiError, apiOk, internalError, toPublicFieldErrors, validationError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { generateOrderNumber, saveOrder } from '@/lib/orders/store';
import type { OrderItemRecord, OrderRecord } from '@/lib/orders/types';
import { notifyNewOrder } from '@/lib/notifications';
import { buildOrderEvent } from '@/lib/notifications/events';
import { emitOrderEventInBackground } from '@/lib/notifications/service';
import { createOrderBuyerSnapshot, createOrderItemDocumentSnapshot } from '@/lib/documents/snapshots';
import {
  cityDeliveryUnavailableMessage,
  isCityDeliveryCity,
  requiresCityDeliveryCity,
} from '@/lib/delivery/city-delivery';
import { requestLocale } from '@/lib/i18n/request';
import { t } from '@/lib/i18n/format';
import { ER, VL } from '@/lib/i18n/strings';

export const runtime = 'nodejs';

/**
 * Order submission (spec §30). Every configuration in the request is
 * re-priced from scratch against the current catalog — the totals shown on
 * the client are never written to the database as-is.
 *
 * Customer-visible messages follow the request's declared locale (see
 * src/lib/i18n/request.ts). What is stored — prices, kit names, discount
 * reasons — is always computed the same way (Russian texts, identical
 * numbers), whichever page the order was placed from.
 */
export async function POST(request: NextRequest) {
  const locale = requestLocale(request.headers);
  const formErrorMessage = t(ER['ER-005'], locale);
  /** Customer wording for any schema issue inside a cart configuration (items.N…). */
  const cartItemErrorMessage = t(ER['ER-059'], locale);

  const rate = await enforceRateLimit('orders', request.headers);
  if (!rate.allowed) {
    return apiError('RATE_LIMITED', t(ER['ER-002'], locale), 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', t(ER['ER-004'], locale), 400);
  }

  const parsed = schemasFor(locale).orderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      formErrorMessage,
      toPublicFieldErrors(parsed.error.issues, { items: cartItemErrorMessage }),
    );
  }
  const input = parsed.data;

  try {
    const catalog = await getCatalog();
    const items: OrderItemRecord[] = [];

    for (const rawItem of input.items) {
      const result = calculatePrice(rawItem.configuration, catalog);
      if (!result.ok) {
        // The same calculation in the customer's language — a pure,
        // deterministic function, so it fails identically; only its
        // message texts differ.
        const localized = locale === 'ru' ? result : calculatePrice(rawItem.configuration, catalog, { locale });
        const failure = localized.ok ? result : localized;
        // Through the public projection, never straight off the engine
        // result: a PriceFailure can carry server-only diagnostics
        // (internalDetails) that must not reach the checkout form.
        const publicFailure = toPublicPriceFailure(failure);
        return apiError(
          result.code === 'INVALID_FORMULA' ? 'INTERNAL_ERROR' : result.code,
          t(ER['ER-006'], locale, { reason: publicFailure.message }),
          422,
          publicFailure.details,
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
      return validationError(formErrorMessage, [{ field: 'deliveryAddress', message: t(VL['VL-008'], locale) }]);
    }

    // Free same-day CITY delivery exists only in Алматы, Астана, Караганда
    // and Шымкент. The deliveryId comes from the browser, so the server checks
    // the resolved method's kind against the customer's city — a CITY
    // deliveryId forged for any other city is rejected, never priced.
    const cityDeliveryUsed = items.some((item) => {
      const method = findDelivery(catalog, item.configuration.deliveryId);
      return method !== undefined && requiresCityDeliveryCity(method.kind);
    });
    if (cityDeliveryUsed && !isCityDeliveryCity(input.city)) {
      return validationError(formErrorMessage, [{ field: 'city', message: cityDeliveryUnavailableMessage(locale) }]);
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
    emitOrderEventInBackground(
      buildOrderEvent({
        event: 'order.created',
        orderNumber: saved.orderNumber,
        status: saved.status,
        grandTotal: saved.grandTotal,
      }),
    );

    return apiOk({ orderNumber: saved.orderNumber, grandTotal: saved.grandTotal }, 201);
  } catch (error) {
    return internalError(error, locale);
  }
}
