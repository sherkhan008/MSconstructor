import { site } from '@/lib/config/site';
import { formatPrice } from '@/lib/money';
import { METAL_FOOT_PAD_LABEL, SHELF_CORNER_BRACKETS_LABEL } from '@/lib/configurator/additional-options';
import type { PublicAccessory, ShelvingConfiguration } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';

/**
 * WhatsApp deep links for the MVP. `https://wa.me/<phone>?text=<message>` needs
 * no API credentials and works everywhere. (The WhatsApp Cloud API is used
 * only for the internal new-order admin alert — see
 * src/lib/notifications/providers/whatsapp.ts.)
 *
 * Every message built here only ever includes customer-facing data (the
 * configuration, the final server-calculated total, an order number) — never
 * purchase price, markup, margin, supplier info or an internal SKU/id.
 */

function buildWhatsAppUrl(phone: string, message: string): string {
  const params = new URLSearchParams({ text: message });
  return `https://wa.me/${phone}?${params.toString()}`;
}

export function whatsAppContactUrl(message?: string): string {
  return buildWhatsAppUrl(site.whatsapp, message ?? 'Здравствуйте! Хочу узнать подробнее о металлических стеллажах.');
}

export function whatsAppProductUrl(modelNameRu: string, url: string): string {
  const message = `Здравствуйте! Интересует стеллаж «${modelNameRu}». Ссылка: ${url}`;
  return buildWhatsAppUrl(site.whatsapp, message);
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
function selectedOptionNames(config: ShelvingConfiguration, accessories: PublicAccessory[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const selection of config.accessories) {
    if (seen.has(selection.accessoryId)) continue;
    seen.add(selection.accessoryId);
    const accessory = accessories.find((a) => a.id === selection.accessoryId);
    if (accessory) names.push(accessory.name.ru);
  }
  if (config.metalFootPad) names.push(METAL_FOOT_PAD_LABEL);
  if (config.shelfCornerBrackets) names.push(SHELF_CORNER_BRACKETS_LABEL);
  return names;
}

/** One line per section, only when at least one section actually has a wall
 * selected anywhere in the row — an all-"без стенок" row omits this block
 * entirely rather than padding the message with rows that say nothing. */
function wallSummaryLines(config: ShelvingConfiguration): string[] {
  const anyWalls = config.sections.some((s) => s.rearWall || s.leftWall || s.rightWall);
  if (!anyWalls) return [];
  return config.sections.map((section, i) => {
    const walls = [section.rearWall && 'задняя', section.leftWall && 'левая', section.rightWall && 'правая'].filter(
      (w): w is string => Boolean(w),
    );
    const summary = walls.length > 0 ? `${walls.join(' + ')} стенка` : 'без стенок';
    return `Секция ${i + 1}: ${summary}`;
  });
}

/**
 * The configurator's "Написать в WhatsApp" message — the real current
 * configuration and the real current server price, never example/hardcoded
 * values. `accessories` is the public catalog's accessory list (purchase
 * price already stripped), used only to resolve customer-facing names.
 */
export function whatsAppConfiguratorUrl(price: PublicPriceResult, accessories: PublicAccessory[], shareUrl: string): string {
  const c = price.configuration;
  const widths = c.sections.map((s) => s.width).join(' + ');

  const lines = [
    'Здравствуйте! Хочу заказать стеллаж.',
    '',
    'Конфигурация:',
    `Высота: ${c.height} мм`,
    `Глубина: ${c.depth} мм`,
    `Секций: ${c.sections.length}`,
    `Ширина секций: ${widths} мм`,
    `Полок: ${c.shelves}`,
    `Нагрузка: ${c.loadCapacity} кг/полку`,
    ...wallSummaryLines(c),
  ];

  const optionNames = selectedOptionNames(c, accessories);
  if (optionNames.length > 0) {
    lines.push('', 'Дополнительные параметры:', ...optionNames.map((name) => `- ${name}`));
  }

  lines.push('', `Итого: ${formatPrice(price.breakdown.total)}`, '', 'Ссылка на конфигурацию:', shareUrl);

  return buildWhatsAppUrl(site.whatsapp, lines.join('\n'));
}

/**
 * The order-success page's "Написать в WhatsApp" message. `grandTotal` must
 * come from the saved/recalculated order record (see /order/success), never
 * a client-submitted value — omitted entirely (not zero, not guessed) when
 * it genuinely isn't available.
 */
export function whatsAppOrderUrl(orderNumber: string, grandTotal?: number): string {
  const lines = ['Здравствуйте!', '', `Я оформил заказ №${orderNumber} на сайте.`];
  if (grandTotal !== undefined) {
    lines.push('', `Сумма заказа: ${formatPrice(grandTotal)}`);
  }
  lines.push('', 'Хочу уточнить детали заказа.');
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
