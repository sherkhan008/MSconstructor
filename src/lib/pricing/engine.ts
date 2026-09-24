import type { Catalog } from '@/lib/data/repository';
import {
  findAssembly,
  findColor,
  findDelivery,
  findModel,
  findPromoCode,
} from '@/lib/data/repository';
import { addVat, clampMin, extractVat, multiply, percentOf, roundTenge, sum, type Tenge } from '@/lib/money';
import type { PriceBreakdown, PriceResult, PricingOutcome, ShelvingConfiguration } from '@/lib/types/domain';
import { quotedDeliveryPrice } from '@/lib/delivery/city-delivery';
import { buildBom } from './bom';
import { validateCompatibility } from './compatibility';
import { parseConfiguration } from './schema';
import type { Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { ER } from '@/lib/i18n/strings';

export interface PricingContext {
  /** Discount code entered at checkout; independent of config.promoCode for convenience. */
  promoCode?: string;
  /**
   * Language of the customer-facing texts in the result (failure messages,
   * warnings, discount reasons, the delivery note). Presentation only: every
   * amount is computed identically for every locale. Defaults to Russian,
   * which is also what orders and admin screens store.
   */
  locale?: Locale;
}

/**
 * The authoritative price calculation. Called from every place a price is
 * needed — the configurator's live preview, cart, checkout, and quote
 * generation all funnel through this single function so a client-submitted
 * number is never trusted.
 *
 * Returns a discriminated union: PriceResult on success, PriceFailure when
 * the configuration is invalid or cannot be priced automatically.
 */
export function calculatePrice(rawConfig: unknown, catalog: Catalog, context: PricingContext = {}): PricingOutcome {
  const locale = context.locale ?? 'ru';
  const parsed = parseConfiguration(rawConfig, locale);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: t(ER['ER-019'], locale),
      // Customer-facing: messages only. The schema paths (sections.0.width…)
      // are developer diagnostics and stay in the server-only channel.
      details: parsed.error.issues.map((issue) => issue.message),
      internalDetails: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const config = parsed.data as ShelvingConfiguration;

  const model = findModel(catalog, config.modelSlug);
  if (!model) {
    return { ok: false, code: 'UNKNOWN_MODEL', message: t(ER['ER-020'], locale) };
  }

  const issues = validateCompatibility(config, catalog, locale);
  if (issues.length > 0) {
    return {
      ok: false,
      code: 'INCOMPATIBLE_CONFIGURATION',
      message: issues[0].message,
      details: issues.map((i) => i.message),
    };
  }

  // Every section is priced from its own structural BOM (V2.2B — see
  // buildBom), so sections of different heights, shelf counts and widths are
  // all priced as built; there is no row-level assumption left to guard.
  const bomResult = buildBom(config, catalog);
  if (bomResult.missingCritical) {
    return {
      ok: false,
      code: 'INDIVIDUAL_QUOTE_REQUIRED',
      message: t(ER['ER-021'], locale),
      // No customer-facing `details`: the BOM's own diagnostics name the
      // internal rules and components that failed to resolve, which tells a
      // customer nothing and exposes how the kit is assembled internally.
      // They stay on the server for support and logs instead.
      internalDetails: bomResult.warnings,
    };
  }

  const color = findColor(catalog, config.colorId);
  const assembly = findAssembly(catalog, config.assemblyId);
  const delivery = findDelivery(catalog, config.deliveryId);
  if (!color || !assembly || !delivery) {
    return { ok: false, code: 'MISSING_COMPONENT', message: t(ER['ER-022'], locale) };
  }

  // Two separate channels, by audience: `warnings` is projected to the
  // browser verbatim, `internalWarnings` never is. The BOM's diagnostics
  // (missing component for rule «X», formula failures) name internal rules
  // and belong to the second channel.
  const warnings: string[] = [];
  const internalWarnings = [...bomResult.warnings];

  const componentsSubtotal: Tenge = sum(bomResult.lines.map((l) => l.totalPrice));
  const costSubtotal: Tenge = sum(bomResult.lines.map((l) => (l.unitCost ?? 0) * l.quantity));

  const colorSurcharge = percentOf(componentsSubtotal, color.pricePercent);
  const markup = percentOf(componentsSubtotal + colorSurcharge, model.markupPercent) + roundTenge(model.markupFixed);
  const unitNet = componentsSubtotal + colorSurcharge + markup;
  const itemsNet = multiply(unitNet, config.quantity);

  let assemblyTotal: Tenge = 0;
  if (assembly.method === 'FIXED') {
    assemblyTotal = roundTenge(assembly.value);
  } else if (assembly.method === 'PER_SECTION') {
    assemblyTotal = multiply(assembly.value, config.sections.length * config.quantity);
  } else if (assembly.method === 'PERCENT') {
    assemblyTotal = percentOf(itemsNet, assembly.value);
  } else {
    warnings.push(t(ER['ER-023'], locale));
  }

  // Regional delivery (anything but PICKUP / four-city CITY) is calculated
  // individually: null + a note, never a 0 ₸ that reads as free.
  const quotedDelivery = quotedDeliveryPrice(delivery);
  let deliveryTotal: Tenge | null = null;
  let deliveryNote: string | null = null;
  if (quotedDelivery === null) {
    deliveryNote = t(ER['ER-024'], locale);
  } else {
    deliveryTotal = roundTenge(quotedDelivery);
  }

  const settings = catalog.pricingSettings;
  const discountReasons: string[] = [];
  let discountPercent = 0;
  let discountFixed = 0;

  const levelDiscount = config.priceLevel ? settings.priceLevelDiscounts[config.priceLevel] ?? 0 : 0;
  if (levelDiscount > 0) {
    discountPercent += levelDiscount;
    // Deliberately without config.priceLevel: it is an internal enum value
    // (RETAIL/WHOLESALE/DEALER/CORPORATE/GOVERNMENT) and discountReasons is
    // customer-facing (PublicPriceBreakdown).
    discountReasons.push(t(ER['ER-028'], locale, { N: levelDiscount }));
  }

  const qtyBreak = [...settings.quantityBreaks]
    .sort((a, b) => b.minQuantity - a.minQuantity)
    .find((b) => config.quantity >= b.minQuantity);
  if (qtyBreak) {
    discountPercent += qtyBreak.discountPercent;
    discountReasons.push(t(ER['ER-029'], locale, { N: qtyBreak.minQuantity, P: qtyBreak.discountPercent }));
  }

  const promoCodeText = context.promoCode ?? config.promoCode;
  if (promoCodeText) {
    const promo = findPromoCode(catalog, promoCodeText);
    const preDiscountTotal = itemsNet + assemblyTotal;
    if (!promo) {
      warnings.push(t(ER['ER-025'], locale, { code: promoCodeText }));
    } else if (preDiscountTotal < promo.minTotal) {
      // Amounts are grouped identically on every locale (ru-RU grouping).
      warnings.push(t(ER['ER-026'], locale, { code: promo.code, amount: promo.minTotal.toLocaleString('ru-RU') }));
    } else {
      if (promo.discountPercent > 0) {
        discountPercent += promo.discountPercent;
        discountReasons.push(t(ER['ER-030'], locale, { code: promo.code, N: promo.discountPercent }));
      }
      if (promo.discountFixed > 0) {
        discountFixed += promo.discountFixed;
        discountReasons.push(t(ER['ER-031'], locale, { code: promo.code, amount: promo.discountFixed.toLocaleString('ru-RU') }));
      }
    }
  }

  const preDiscountNet = itemsNet + assemblyTotal + (deliveryTotal ?? 0);
  const rawDiscount = percentOf(preDiscountNet, discountPercent) + roundTenge(discountFixed);

  const totalCost = multiply(costSubtotal, config.quantity);
  const minAllowedNet = roundTenge(totalCost * (1 + settings.minMarginPercent / 100));
  const maxDiscount = clampMin(preDiscountNet - minAllowedNet, 0);
  const discount = Math.min(rawDiscount, maxDiscount);
  if (rawDiscount > maxDiscount) {
    // Internal only: the minimum margin is exactly the kind of commercial
    // internal the customer UI must never name. The discount the customer
    // actually receives is already in `discount`/`total` below.
    internalWarnings.push('Скидка ограничена минимальной наценкой и была уменьшена');
  }

  const netBeforeVat = preDiscountNet - discount;

  let net: Tenge;
  let vat: Tenge;
  let total: Tenge;
  if (settings.pricesIncludeVat) {
    // Component prices already include VAT — split the gross amount instead of adding on top.
    const split = extractVat(netBeforeVat, settings.vatPercent);
    net = split.net;
    vat = split.vat;
    total = netBeforeVat;
  } else {
    net = netBeforeVat;
    const withVat = addVat(net, settings.vatPercent);
    vat = withVat.vat;
    total = withVat.gross;
  }

  const breakdown: PriceBreakdown = {
    componentsSubtotal,
    colorSurcharge,
    markup,
    unitNet,
    quantity: config.quantity,
    itemsNet,
    assembly: assemblyTotal,
    delivery: deliveryTotal,
    discount,
    discountReasons,
    net,
    vatPercent: settings.vatPercent,
    vat,
    total,
    unitTotal: roundTenge(total / config.quantity),
  };

  // The kit ships when its slowest part is ready, so every section's own
  // height and width count (the maximum), exactly as widths always did.
  const leadTimeDays = Math.max(
    color.leadTimeDays,
    ...config.sections.map((s) => catalog.heights.find((h) => h.value === s.height)?.leadTimeDays ?? 0),
    ...config.sections.map((s) => catalog.widths.find((w) => w.value === s.width)?.leadTimeDays ?? 0),
    catalog.depths.find((d) => d.value === config.depth)?.leadTimeDays ?? 0,
    2,
  );

  const result: PriceResult = {
    ok: true,
    configuration: config,
    bom: bomResult.lines,
    breakdown,
    totalWeightKg: multiply(bomResult.totalWeightKg, config.quantity),
    rowLengthMm: bomResult.rowLengthMm,
    leadTimeDays,
    deliveryNote,
    warnings,
    internalWarnings,
  };
  return result;
}
