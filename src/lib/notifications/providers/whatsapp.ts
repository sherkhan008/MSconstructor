import { env } from '@/lib/env';
import { formatPrice } from '@/lib/money';
import { getOrderByNumber } from '@/lib/orders/store';
import type { OrderRecord } from '@/lib/orders/types';
import type { NotificationChannel } from '../channels';
import { resolveWhatsAppConfig, type WhatsAppConfigResolution } from './whatsapp-config';

/**
 * WhatsApp Cloud API (official Meta Graph API) — INTERNAL new-order alert to
 * the shop owner/admin number (WHATSAPP_ADMIN_RECIPIENT). It never messages a
 * customer: the only recipient is the configured admin.
 *
 * Business-initiated messages outside a 24-hour window must be approved
 * templates, so this sends a TEMPLATE whose body takes six text parameters
 * (see WHATSAPP_TEMPLATE_PARAMETERS).
 *
 * The event payload is redacted by design (./events.ts) and is what the
 * outbox stores. The operational fields the admin needs are read from the
 * persisted order at send time, so they never reach the outbox or a log line.
 *
 * Like every channel it never throws and returns only short codes: the access
 * token lives in the Authorization header alone and is never logged, stored
 * or part of an error.
 */

/** Body parameter order of the approved template, {{1}}…{{6}}. */
export const WHATSAPP_TEMPLATE_PARAMETERS = [
  'orderNumber',
  'customerName',
  'phone',
  'city',
  'total',
  'deliveryMethod',
] as const;

export const WHATSAPP_REQUEST_TIMEOUT_MS = 10_000;

/** Meta rejects template parameters with newlines, tabs or 4+ consecutive spaces, and empty ones. */
function templateText(value: string | undefined): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return clean || '—';
}

/** Delivery method name(s) frozen on the order at creation time; never guessed. */
function deliveryMethodName(order: OrderRecord): string | undefined {
  const names = [...new Set(order.items.map((item) => item.documentSnapshot?.deliveryName).filter(Boolean))];
  return names.length > 0 ? names.join(', ') : undefined;
}

/**
 * The template body parameters, in WHATSAPP_TEMPLATE_PARAMETERS order. Only
 * these operational fields — no email, address, comment, BOM or pricing
 * internals.
 */
export function buildWhatsAppTemplateParameters(order: OrderRecord): string[] {
  return [
    order.orderNumber,
    order.customer.fullName,
    order.customer.phone,
    order.customer.city,
    formatPrice(order.grandTotal),
    deliveryMethodName(order),
  ].map(templateText);
}

type WhatsAppFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

export interface WhatsAppChannelOptions {
  config?: WhatsAppConfigResolution;
  fetch?: WhatsAppFetch;
  loadOrder?: (orderNumber: string) => Promise<OrderRecord | undefined>;
  timeoutMs?: number;
}

export function whatsAppConfigFromEnv(): WhatsAppConfigResolution {
  return resolveWhatsAppConfig(env);
}

/** Meta's numeric error code only (e.g. 132001 "template does not exist"); never its message text. */
async function metaErrorCode(response: { json?: () => Promise<unknown> }): Promise<string> {
  try {
    const body = (await response.json?.()) as { error?: { code?: unknown } } | undefined;
    const code = body?.error?.code;
    return typeof code === 'number' && Number.isInteger(code) ? `_META_${code}` : '';
  } catch {
    return '';
  }
}

export function createWhatsAppChannel(options: WhatsAppChannelOptions = {}): NotificationChannel {
  const resolution = options.config ?? whatsAppConfigFromEnv();
  const doFetch: WhatsAppFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const loadOrder = options.loadOrder ?? getOrderByNumber;
  const timeoutMs = options.timeoutMs ?? WHATSAPP_REQUEST_TIMEOUT_MS;

  return {
    id: 'whatsapp',
    events: ['order.created'],
    oncePerOrder: true,
    availability: () => (resolution.state === 'ready' ? { ok: true } : { ok: false, reason: 'NOT_CONFIGURED' }),
    async send(payload) {
      if (resolution.state !== 'ready') return { ok: false, error: 'NOT_CONFIGURED' };
      if (payload.event !== 'order.created') return { ok: false, error: 'UNSUPPORTED_EVENT' };
      const { config } = resolution;

      let order: OrderRecord | undefined;
      try {
        order = await loadOrder(payload.orderNumber);
      } catch {
        return { ok: false, error: 'ORDER_LOOKUP_FAILED' };
      }
      if (!order) return { ok: false, error: 'ORDER_NOT_FOUND' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(
          `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: config.recipient,
              type: 'template',
              template: {
                name: config.templateName,
                language: { code: config.templateLanguage },
                components: [
                  {
                    type: 'body',
                    parameters: buildWhatsAppTemplateParameters(order).map((text) => ({ type: 'text', text })),
                  },
                ],
              },
            }),
            signal: controller.signal,
          },
        );
        return response.ok ? { ok: true } : { ok: false, error: `HTTP_${response.status}${await metaErrorCode(response)}` };
      } catch {
        return { ok: false, error: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
