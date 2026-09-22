import { toPublicBom } from './bom';
import type { PriceBreakdown, PriceFailure, PriceResult } from '@/lib/types/domain';
import type { Locale } from '@/lib/i18n/locales';
import { pick } from '@/lib/i18n/format';

/**
 * The customer-safe shape of a price calculation — what /api/pricing/calculate
 * returns and what the configurator, cart and checkout keep in the browser.
 *
 * The engine's PriceResult (src/lib/pricing/engine.ts) stays complete for
 * trusted server code: orders, order records and admin screens need the
 * component subtotal, colour surcharge and markup. None of those may leave
 * the server through a public API, and neither may anything that lets a
 * caller recompute them: the pre-markup component prices on BOM lines
 * (their sum IS componentsSubtotal, and unitNet − componentsSubtotal −
 * colorSurcharge IS the markup).
 *
 * Every field is copied by name (an allow-list, not a spread), so a field
 * later added to PriceBreakdown or BomLine stays private until someone
 * deliberately adds it here. The amounts match the customer-facing order
 * documents (src/lib/documents/snapshots.ts): unit price, goods amount,
 * assembly, delivery, discount, net, VAT, total.
 */

export interface PublicPriceBreakdown {
  /** Customer net price of one set (colour and markup included). */
  unitNet: PriceBreakdown['unitNet'];
  quantity: PriceBreakdown['quantity'];
  /** unitNet × quantity. */
  itemsNet: PriceBreakdown['itemsNet'];
  assembly: PriceBreakdown['assembly'];
  delivery: PriceBreakdown['delivery'];
  discount: PriceBreakdown['discount'];
  discountReasons: PriceBreakdown['discountReasons'];
  net: PriceBreakdown['net'];
  vatPercent: PriceBreakdown['vatPercent'];
  vat: PriceBreakdown['vat'];
  total: PriceBreakdown['total'];
  unitTotal: PriceBreakdown['unitTotal'];
}

/** One kit position as a customer sees it: what and how many — no prices. */
export interface PublicKitLine {
  componentId: string;
  sku: string;
  type: PriceResult['bom'][number]['type'];
  name: string;
  quantity: number;
  weightKg: number;
}

export interface PublicPriceResult {
  ok: true;
  configuration: PriceResult['configuration'];
  bom: PublicKitLine[];
  breakdown: PublicPriceBreakdown;
  totalWeightKg: number;
  rowLengthMm: number;
  leadTimeDays: number;
  deliveryNote: string | null;
  warnings: string[];
}

export function toPublicPriceBreakdown(b: PriceBreakdown): PublicPriceBreakdown {
  return {
    unitNet: b.unitNet,
    quantity: b.quantity,
    itemsNet: b.itemsNet,
    assembly: b.assembly,
    delivery: b.delivery,
    discount: b.discount,
    discountReasons: [...b.discountReasons],
    net: b.net,
    vatPercent: b.vatPercent,
    vat: b.vat,
    total: b.total,
    unitTotal: b.unitTotal,
  };
}

/**
 * Where to find the Kazakh name of a kit line: the catalog rows the BOM line
 * was built from (ShelvingComponent / Accessory, their *Kk columns).
 */
export interface KitNameSource {
  components: readonly { id: string; name: { ru: string; kk: string } }[];
  accessories: readonly { id: string; name: { ru: string; kk: string } }[];
}

/**
 * `locale` + `names` only change the language of each kit line's name
 * (looked up by componentId; the BOM's own Russian name is the fallback).
 * Quantities, grouping and every amount are exactly the engine's.
 */
export function toPublicPriceResult(
  result: PriceResult,
  options: { locale: Locale; names: KitNameSource } | undefined = undefined,
): PublicPriceResult {
  const localizedName = (componentId: string, fallback: string): string => {
    if (!options || options.locale === 'ru') return fallback;
    const source =
      options.names.components.find((c) => c.id === componentId) ??
      options.names.accessories.find((a) => a.id === componentId);
    return source ? pick(source.name, options.locale) : fallback;
  };

  return {
    ok: true,
    configuration: result.configuration,
    // toPublicBom keeps MS Standard's customer kit grouping; only its
    // non-price fields are carried over.
    bom: toPublicBom(result.bom, result.configuration.modelSlug).map((line) => ({
      componentId: line.componentId,
      sku: line.sku,
      type: line.type,
      name: localizedName(line.componentId, line.name),
      quantity: line.quantity,
      weightKg: line.weightKg,
    })),
    breakdown: toPublicPriceBreakdown(result.breakdown),
    totalWeightKg: result.totalWeightKg,
    rowLengthMm: result.rowLengthMm,
    leadTimeDays: result.leadTimeDays,
    deliveryNote: result.deliveryNote,
    // The customer-facing channel only. PriceResult.internalWarnings (missing
    // BOM components, formula failures, the margin floor that capped a
    // discount) is absent by construction — this object is built field by
    // field, so a diagnostic added to the engine stays server-side until
    // someone deliberately promotes it here.
    warnings: [...result.warnings],
  };
}

/** The customer-safe shape of a failed calculation. */
export interface PublicPriceFailure {
  ok: false;
  code: PriceFailure['code'];
  message: string;
  details?: string[];
}

/**
 * Same allow-list discipline as toPublicPriceResult, for the failure branch:
 * `message` and `details` are the customer-facing fields, and
 * PriceFailure.internalDetails is omitted by construction. Every public route
 * that turns a PricingOutcome into a response goes through here, so a
 * diagnostic attached to a failure cannot reach a customer by accident.
 */
export function toPublicPriceFailure(failure: PriceFailure): PublicPriceFailure {
  return {
    ok: false,
    code: failure.code,
    message: failure.message,
    ...(failure.details ? { details: [...failure.details] } : {}),
  };
}
