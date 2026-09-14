import { toPublicBom } from './bom';
import type { PriceBreakdown, PriceResult } from '@/lib/types/domain';

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

export function toPublicPriceResult(result: PriceResult): PublicPriceResult {
  return {
    ok: true,
    configuration: result.configuration,
    // toPublicBom keeps MS Standard's customer kit grouping; only its
    // non-price fields are carried over.
    bom: toPublicBom(result.bom, result.configuration.modelSlug).map((line) => ({
      componentId: line.componentId,
      sku: line.sku,
      type: line.type,
      name: line.name,
      quantity: line.quantity,
      weightKg: line.weightKg,
    })),
    breakdown: toPublicPriceBreakdown(result.breakdown),
    totalWeightKg: result.totalWeightKg,
    rowLengthMm: result.rowLengthMm,
    leadTimeDays: result.leadTimeDays,
    deliveryNote: result.deliveryNote,
    warnings: [...result.warnings],
  };
}
