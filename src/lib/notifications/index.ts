import { env } from '@/lib/env';
import type { OrderRecord } from '@/lib/orders/types';

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

// Telegram/email/WhatsApp for order events AND contact-form leads live in
// ./service.ts (redacted payloads, delivery outbox, retries; WhatsApp is an
// internal manager alert only — see ./providers/whatsapp.ts). This file keeps
// only the legacy CRM fan-out. The former customer-addressed WhatsApp send was
// removed: no notification is ever sent to a customer.

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
    notifyCrmWebhook('amocrm', env.AMOCRM_WEBHOOK_URL, order),
    notifyCrmWebhook('bitrix24', env.BITRIX24_WEBHOOK_URL, order),
  ]);

  return results.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : { channel: ['amocrm', 'bitrix24'][index], success: false, error: 'rejected' },
  );
}
