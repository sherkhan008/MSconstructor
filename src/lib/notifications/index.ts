import { env, integrations } from '@/lib/env';
import { formatPrice } from '@/lib/money';
import type { OrderRecord } from '@/lib/orders/types';
import type { ContactRequestInput } from '@/lib/contact-schema';

/**
 * Notification + CRM integration layer (spec §33).
 *
 * Every channel below is independent and best-effort: a failure here must
 * never affect an already-saved order, so each function catches its own
 * errors and callers fire them with Promise.allSettled. A channel with no
 * credentials configured (the default in local development) is a silent
 * no-op rather than an error — see src/lib/env.ts `integrations`.
 */

interface NotificationOutcome {
  channel: string;
  success: boolean;
  error?: string;
}

function orderSummaryText(order: OrderRecord): string {
  const lines = [
    `Новый заказ №${order.orderNumber}`,
    `Клиент: ${order.customer.fullName} (${order.customer.phone})`,
    `Город: ${order.customer.city}`,
    `Позиций: ${order.items.length}`,
    `Сумма: ${formatPrice(order.grandTotal)}`,
    `Оплата: ${order.paymentPreference}`,
  ];
  return lines.join('\n');
}

async function notifyTelegram(order: OrderRecord): Promise<NotificationOutcome> {
  if (!integrations.telegram) return { channel: 'telegram', success: false, error: 'not_configured' };
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: orderSummaryText(order) }),
    });
    if (!response.ok) throw new Error(`Telegram API responded ${response.status}`);
    return { channel: 'telegram', success: true };
  } catch (error) {
    return { channel: 'telegram', success: false, error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

/**
 * SMTP email is intentionally not wired to a transport library in the MVP —
 * see EMAIL_FROM/SMTP_* in .env.example. Plug nodemailer (or another
 * provider) into this function; every caller already treats it as
 * best-effort and ignores its absence.
 */
async function notifyEmail(order: OrderRecord): Promise<NotificationOutcome> {
  if (!integrations.email) return { channel: 'email', success: false, error: 'not_configured' };
  try {
     
    console.info(`[email:stub] Would email ${env.MANAGER_EMAIL ?? env.EMAIL_FROM} about order ${order.orderNumber}`);
    return { channel: 'email', success: true };
  } catch (error) {
    return { channel: 'email', success: false, error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

async function notifyWhatsAppBusinessApi(order: OrderRecord): Promise<NotificationOutcome> {
  if (!integrations.whatsappApi) return { channel: 'whatsapp_api', success: false, error: 'not_configured' };
  try {
    const url = `${env.WHATSAPP_API_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: order.customer.whatsapp ?? order.customer.phone,
        type: 'text',
        text: { body: orderSummaryText(order) },
      }),
    });
    if (!response.ok) throw new Error(`WhatsApp API responded ${response.status}`);
    return { channel: 'whatsapp_api', success: true };
  } catch (error) {
    return { channel: 'whatsapp_api', success: false, error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

async function notifyCrmWebhook(name: 'amocrm' | 'bitrix24', webhookUrl: string | undefined, order: OrderRecord): Promise<NotificationOutcome> {
  if (!webhookUrl) return { channel: name, success: false, error: 'not_configured' };
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: order.orderNumber,
        customer: order.customer,
        total: order.grandTotal,
        items: order.items.length,
      }),
    });
    if (!response.ok) throw new Error(`${name} webhook responded ${response.status}`);
    return { channel: name, success: true };
  } catch (error) {
    return { channel: name, success: false, error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

/**
 * Fires every configured notification channel for a newly created order.
 * Never throws — order creation must succeed even if every channel fails.
 */
export async function notifyNewOrder(order: OrderRecord): Promise<NotificationOutcome[]> {
  const results = await Promise.allSettled([
    notifyTelegram(order),
    notifyEmail(order),
    notifyWhatsAppBusinessApi(order),
    notifyCrmWebhook('amocrm', env.AMOCRM_WEBHOOK_URL, order),
    notifyCrmWebhook('bitrix24', env.BITRIX24_WEBHOOK_URL, order),
  ]);

  return results.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : { channel: ['telegram', 'email', 'whatsapp_api', 'amocrm', 'bitrix24'][index], success: false, error: 'rejected' },
  );
}

/** Fires notification channels for a general contact-form submission. */
export async function notifyContactRequest(input: ContactRequestInput): Promise<NotificationOutcome[]> {
  const text = `Новое обращение с сайта\nИмя: ${input.name}\nТелефон: ${input.phone}\nСообщение: ${input.message}`;

  const results = await Promise.allSettled([
    (async (): Promise<NotificationOutcome> => {
      if (!integrations.telegram) return { channel: 'telegram', success: false, error: 'not_configured' };
      try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
        });
        if (!response.ok) throw new Error(`Telegram API responded ${response.status}`);
        return { channel: 'telegram', success: true };
      } catch (error) {
        return { channel: 'telegram', success: false, error: error instanceof Error ? error.message : 'unknown_error' };
      }
    })(),
  ]);

  return results.map((result) =>
    result.status === 'fulfilled' ? result.value : { channel: 'telegram', success: false, error: 'rejected' },
  );
}
