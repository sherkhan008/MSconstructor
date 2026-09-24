import { site } from '@/lib/config/site';
import { formatPrice } from '@/lib/money';
import { METAL_FOOT_PAD_OPTION, SHELF_CORNER_BRACKETS_OPTION } from '@/lib/configurator/additional-options';
import type { PublicAccessory, ShelvingConfiguration } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import type { Locale } from '@/lib/i18n/locales';
import { pick, t } from '@/lib/i18n/format';
import { WA } from '@/lib/i18n/strings';
import { sectionHeightsSummary, sectionShelvesSummary } from '@/lib/configurator/section-dimensions';

/**
 * WhatsApp deep links for the MVP. `https://wa.me/<phone>?text=<message>` needs
 * no API credentials and works everywhere. (The WhatsApp Cloud API is used
 * only for the internal new-order admin alert — see
 * src/lib/notifications/providers/whatsapp.ts.)
 *
 * Every message built here only ever includes customer-facing data (the
 * configuration, the final server-calculated total, an order number) — never
 * purchase price, markup, margin, supplier info or an internal SKU/id.
 *
 * Customer-side messages are written in the page locale (owner-reviewed CSV
 * rows WA-001…WA-022); the admin → customer message at the bottom is
 * composed from the Russian-only admin panel and stays Russian.
 */

function buildWhatsAppUrl(phone: string, message: string): string {
  const params = new URLSearchParams({ text: message });
  return `https://wa.me/${phone}?${params.toString()}`;
}

export function whatsAppContactUrl(locale: Locale, message?: string): string {
  return buildWhatsAppUrl(site.whatsapp, message ?? t(WA['WA-001'], locale));
}

export function whatsAppProductUrl(modelName: string, url: string, locale: Locale): string {
  return buildWhatsAppUrl(site.whatsapp, t(WA['WA-002'], locale, { model: modelName, url }));
}

/** Human-readable names of every selected "Дополнительные параметры" rack
 * option — never an internal id/SKU. Three options are real accessories, so
 * their names come from the (already purchase-price-stripped) public
 * catalog, the authoritative source; the other two have no catalog entry
 * (see additional-options.ts), so they use the same fixed labels the
 * configurator UI itself shows. Multiple selections of the same accessory
 * (e.g. a cross brace on two different 1000mm sections) collapse into one
 * line — the customer cares which options were chosen, not how many
 * section-scoped selections back them. */
function selectedOptionNames(config: ShelvingConfiguration, accessories: PublicAccessory[], locale: Locale): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const selection of config.accessories) {
    if (seen.has(selection.accessoryId)) continue;
    seen.add(selection.accessoryId);
    const accessory = accessories.find((a) => a.id === selection.accessoryId);
    if (accessory) names.push(pick(accessory.name, locale));
  }
  if (config.metalFootPad) names.push(t(METAL_FOOT_PAD_OPTION, locale));
  if (config.shelfCornerBrackets) names.push(t(SHELF_CORNER_BRACKETS_OPTION, locale));
  return names;
}

/** One line per section, only when at least one section actually has a wall
 * selected anywhere in the row — an all-"без стенок" row omits this block
 * entirely rather than padding the message with rows that say nothing. */
function wallSummaryLines(config: ShelvingConfiguration, locale: Locale): string[] {
  const anyWalls = config.sections.some((s) => s.rearWall || s.leftWall || s.rightWall);
  if (!anyWalls) return [];
  return config.sections.map((section, i) => {
    const walls = [
      section.rearWall && t(WA['WA-012'], locale),
      section.leftWall && t(WA['WA-013'], locale),
      section.rightWall && t(WA['WA-014'], locale),
    ].filter((w): w is string => Boolean(w));
    if (walls.length > 0) return t(WA['WA-011'], locale, { N: i + 1, list: walls.join(' + ') });
    // "Секция 1: без стенок" / "1-секция: қабырғасыз" — WA-011's own section
    // label (the part before its colon) followed by WA-015.
    const [sectionLabel] = t(WA['WA-011'], locale, { N: i + 1 }).split(':');
    return `${sectionLabel}: ${t(WA['WA-015'], locale)}`;
  });
}

/**
 * The configurator's "Написать в WhatsApp" message — the real current
 * configuration and the real current server price, never example/hardcoded
 * values. `accessories` is the public catalog's accessory list (purchase
 * price already stripped), used only to resolve customer-facing names.
 */
export function whatsAppConfiguratorUrl(
  price: PublicPriceResult,
  accessories: PublicAccessory[],
  shareUrl: string,
  locale: Locale,
): string {
  const c = price.configuration;
  const widths = c.sections.map((s) => s.width).join(' + ');

  const lines = [
    t(WA['WA-003'], locale),
    '',
    t(WA['WA-004'], locale),
    t(WA['WA-005'], locale, { H: sectionHeightsSummary(c.sections) }),
    t(WA['WA-006'], locale, { D: c.depth }),
    t(WA['WA-007'], locale, { N: c.sections.length }),
    t(WA['WA-008'], locale, { W: widths }),
    t(WA['WA-009'], locale, { N: sectionShelvesSummary(c.sections) }),
    t(WA['WA-010'], locale, { N: c.loadCapacity }),
    ...wallSummaryLines(c, locale),
  ];

  const optionNames = selectedOptionNames(c, accessories, locale);
  if (optionNames.length > 0) {
    lines.push('', t(WA['WA-016'], locale), ...optionNames.map((name) => `- ${name}`));
  }

  lines.push('', t(WA['WA-017'], locale, { amount: formatPrice(price.breakdown.total) }), '', t(WA['WA-018'], locale), shareUrl);

  return buildWhatsAppUrl(site.whatsapp, lines.join('\n'));
}

/**
 * The order-success page's "Написать в WhatsApp" message. `grandTotal` must
 * come from the saved/recalculated order record (see /order/success), never
 * a client-submitted value — omitted entirely (not zero, not guessed) when
 * it genuinely isn't available.
 */
export function whatsAppOrderUrl(orderNumber: string, grandTotal: number | undefined, locale: Locale): string {
  const lines = [t(WA['WA-019'], locale), '', t(WA['WA-020'], locale, { number: orderNumber })];
  if (grandTotal !== undefined) {
    lines.push('', t(WA['WA-021'], locale, { amount: formatPrice(grandTotal) }));
  }
  lines.push('', t(WA['WA-022'], locale));
  return buildWhatsAppUrl(site.whatsapp, lines.join('\n'));
}

/**
 * Admin-only: opens a chat with the CUSTOMER (not the company's own number
 * used by every other helper above) from an order's detail page in
 * /admin/orders/[id]. `customerPhone` may be in any of the formats the
 * checkout form accepts (e.g. "+7 707 123 45 67") — sanitised to the
 * digits-only format wa.me requires the same way site.ts sanitises the
 * company number.
 */
export function whatsAppAdminOrderUrl(customerPhone: string, customerName: string, orderNumber: string): string {
  const digitsOnlyPhone = customerPhone.replace(/\D/g, '');
  const message = `Здравствуйте, ${customerName}!\nПо вашему заказу №${orderNumber} хотим уточнить детали.`;
  return buildWhatsAppUrl(digitsOnlyPhone, message);
}
