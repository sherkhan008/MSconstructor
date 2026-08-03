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
import { buildBom } from './bom';
import { validateCompatibility } from './compatibility';
import { parseConfiguration } from './schema';

export interface PricingContext {
  /** Discount code entered at checkout; independent of config.promoCode for convenience. */
  promoCode?: string;
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
  const parsed = parseConfiguration(rawConfig);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Некорректные данные конфигурации',
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const config = parsed.data as ShelvingConfiguration;

  const model = findModel(catalog, config.modelSlug);
  if (!model) {
    return { ok: false, code: 'UNKNOWN_MODEL', message: 'Модель не найдена' };
  }

  const issues = validateCompatibility(config, catalog);
  if (issues.length > 0) {
    return {
      ok: false,
      code: 'INCOMPATIBLE_CONFIGURATION',
      message: issues[0].message,
      details: issues.map((i) => i.message),
    };
  }

  const bomResult = buildBom(config, catalog);
  if (bomResult.missingCritical) {
    return {
      ok: false,
      code: 'INDIVIDUAL_QUOTE_REQUIRED',
      message: 'Эта конфигурация требует индивидуального расчёта. Пожалуйста, свяжитесь с менеджером.',
      details: bomResult.warnings,
    };
  }

  const color = findColor(catalog, config.colorId);
  const assembly = findAssembly(catalog, config.assemblyId);
  const delivery = findDelivery(catalog, config.deliveryId);
  if (!color || !assembly || !delivery) {
    return { ok: false, code: 'MISSING_COMPONENT', message: 'Часть выбранных опций недоступна' };
  }

  const warnings = [...bomResult.warnings];

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
    assemblyTotal = multiply(assembly.value, config.sections * config.quantity);
  } else if (assembly.method === 'PERCENT') {
    assemblyTotal = percentOf(itemsNet, assembly.value);
  } else {
    warnings.push('Стоимость сборки будет рассчитана индивидуально менеджером');
  }

  let deliveryTotal: Tenge | null = null;
  let deliveryNote: string | null = null;
  if (delivery.basePrice === null) {
    deliveryNote = 'Стоимость доставки будет подтверждена менеджером.';
  } else {
    deliveryTotal = roundTenge(delivery.basePrice);
  }

  const settings = catalog.pricingSettings;
  const discountReasons: string[] = [];
  let discountPercent = 0;
  let discountFixed = 0;

  const levelDiscount = config.priceLevel ? settings.priceLevelDiscounts[config.priceLevel] ?? 0 : 0;
  if (levelDiscount > 0) {
    discountPercent += levelDiscount;
    discountReasons.push(`Скидка уровня цены (${config.priceLevel}): ${levelDiscount}%`);
  }

  const qtyBreak = [...settings.quantityBreaks]
    .sort((a, b) => b.minQuantity - a.minQuantity)
    .find((b) => config.quantity >= b.minQuantity);
  if (qtyBreak) {
    discountPercent += qtyBreak.discountPercent;
    discountReasons.push(`Скидка за количество (от ${qtyBreak.minQuantity} шт.): ${qtyBreak.discountPercent}%`);
  }

  const promoCodeText = context.promoCode ?? config.promoCode;
  if (promoCodeText) {
    const promo = findPromoCode(catalog, promoCodeText);
    const preDiscountTotal = itemsNet + assemblyTotal;
    if (!promo) {
      warnings.push(`Промокод «${promoCodeText}» не найден или недействителен`);
    } else if (preDiscountTotal < promo.minTotal) {
      warnings.push(`Промокод «${promo.code}» действует от суммы ${promo.minTotal.toLocaleString('ru-RU')} ₸`);
    } else {
      if (promo.discountPercent > 0) {
        discountPercent += promo.discountPercent;
        discountReasons.push(`Промокод ${promo.code}: ${promo.discountPercent}%`);
      }
      if (promo.discountFixed > 0) {
        discountFixed += promo.discountFixed;
        discountReasons.push(`Промокод ${promo.code}: −${promo.discountFixed.toLocaleString('ru-RU')} ₸`);
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
    warnings.push('Скидка ограничена минимальной наценкой и была уменьшена');
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

  const leadTimeDays = Math.max(
    color.leadTimeDays,
    catalog.heights.find((h) => h.value === config.height)?.leadTimeDays ?? 0,
    catalog.widths.find((w) => w.value === config.width)?.leadTimeDays ?? 0,
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
  };
  return result;
}
