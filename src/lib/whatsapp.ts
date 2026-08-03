import { site } from '@/lib/config/site';
import { formatPrice } from '@/lib/money';
import type { PriceResult } from '@/lib/types/domain';

/**
 * WhatsApp deep links for the MVP. `https://wa.me/<phone>?text=<message>` needs
 * no API credentials and works everywhere — the WhatsApp Business API (see
 * src/lib/env.ts `integrations.whatsappApi`) can replace this later behind
 * the same call sites without touching UI code.
 */

function buildWhatsAppUrl(phone: string, message: string): string {
  const params = new URLSearchParams({ text: message });
  return `https://wa.me/${phone}?${params.toString()}`;
}

export function whatsAppContactUrl(message?: string): string {
  return buildWhatsAppUrl(site.whatsapp, message ?? 'Здравствуйте! Хочу узнать подробнее о стеллажах MS.');
}

export function whatsAppProductUrl(modelNameRu: string, url: string): string {
  const message = `Здравствуйте! Интересует стеллаж «${modelNameRu}». Ссылка: ${url}`;
  return buildWhatsAppUrl(site.whatsapp, message);
}

const CONFIG_TYPE_LABEL: Record<string, string> = {
  SINGLE: 'одна секция',
  MULTIPLE_INDEPENDENT: 'несколько независимых секций',
  STARTER_WITH_EXTENSIONS: 'стартовая + пристроенные секции',
  CONTINUOUS_ROW: 'сплошной ряд',
  L_SHAPE: 'Г-образная',
  U_SHAPE: 'П-образная',
};

export function whatsAppConfiguratorUrl(price: PriceResult, modelNameRu: string, shareUrl: string): string {
  const c = price.configuration;
  const lines = [
    'Здравствуйте! Хочу заказать стеллаж со следующей конфигурацией:',
    `Модель: ${modelNameRu}`,
    `Размеры: ${c.height}×${c.width}×${c.depth} мм`,
    `Полки: ${c.shelves} шт., секций: ${c.sections} (${CONFIG_TYPE_LABEL[c.configurationType] ?? c.configurationType})`,
    `Нагрузка: ${c.loadCapacity} кг на полку`,
    c.accessories.length > 0 ? `Аксессуары: ${c.accessories.length} позиций` : undefined,
    `Итоговая цена: ${formatPrice(price.breakdown.total)}`,
    `Ссылка на конфигурацию: ${shareUrl}`,
  ].filter(Boolean);
  return buildWhatsAppUrl(site.whatsapp, lines.join('\n'));
}

export function whatsAppOrderUrl(orderNumber: string): string {
  return buildWhatsAppUrl(
    site.whatsapp,
    `Здравствуйте! Я оформил(а) заказ №${orderNumber} на сайте. Хочу уточнить детали.`,
  );
}
