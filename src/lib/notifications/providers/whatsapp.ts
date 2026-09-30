import { env } from '@/lib/env';
import { formatPrice } from '@/lib/money';
import { getOrderByNumber } from '@/lib/orders/store';
import type { OrderRecord } from '@/lib/orders/types';
import { getContactLeadById, type ContactLeadRecord } from '@/lib/contact-leads/store';
import type { NotificationChannel } from '../channels';
import { CONTACT_MESSAGE_NOTIFICATION_MAX } from '../events';
import { resolveWhatsAppConfig, type WhatsAppConfigResolution } from './whatsapp-config';

/**
 * WhatsApp Cloud API (official Meta Graph API) — INTERNAL manager alerts:
 * a new order (order.created) and a new contact-form lead (contact.created).
 *
 * Sent FROM the technical Cloud API number (config.phoneNumberId, never shown
 * to customers) TO the manager's working/public number (config.recipient,
 * WHATSAPP_ADMIN_RECIPIENT). It never messages a customer: the only recipient
 * is the configured manager.
 *
 * Business-initiated messages outside a 24-hour window must be approved
 * templates, so each event sends a TEMPLATE with text body parameters (see
 * WHATSAPP_TEMPLATE_PARAMETERS / WHATSAPP_CONTACT_TEMPLATE_PARAMETERS).
 *
 * Event payloads are redacted by design (../events.ts) and are what the
 * outbox stores. The fields the manager needs are read from the persisted
 * order / lead at send time, so they never reach the outbox or a log line.
 *
 * Like every channel it never throws and returns only short codes: the access
 * token lives in the Authorization header alone and is never logged, stored
 * or part of an error; Meta's response text is never surfaced — only its
 * numeric error code.
 */

/** Body parameter order of the approved order template, {{1}}…{{6}}. */
export const WHATSAPP_TEMPLATE_PARAMETERS = [
  'orderNumber',
  'customerName',
  'phone',
  'city',
  'total',
  'deliveryMethod',
] as const;

/** Body parameter order of the approved contact-lead template, {{1}}…{{3}}. */
export const WHATSAPP_CONTACT_TEMPLATE_PARAMETERS = ['customerName', 'phone', 'message'] as const;

export const WHATSAPP_REQUEST_TIMEOUT_MS = 10_000;

/** Meta rejects template parameters with newlines, tabs or 4+ consecutive spaces, and empty ones. */
function templateText(value: string | undefined, max = 200): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  const cut = clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
  return cut || '—';
}

/** Delivery method name(s) frozen on the order at creation time; never guessed. */
function deliveryMethodName(order: OrderRecord): string | undefined {
  const names = [...new Set(order.items.map((item) => item.documentSnapshot?.deliveryName).filter(Boolean))];
  return names.length > 0 ? names.join(', ') : undefined;
}

/**
 * The order template body parameters, in WHATSAPP_TEMPLATE_PARAMETERS order.
 * Only these operational fields — no email, address, comment, BOM or pricing
 * internals. The total is the stored server-calculated grand total.
 */
export function buildWhatsAppTemplateParameters(order: OrderRecord): string[] {
  return [
    order.orderNumber,
    order.customer.fullName,
    order.customer.phone,
    order.customer.city,
    formatPrice(order.grandTotal),
    deliveryMethodName(order),
  ].map((value) => templateText(value));
}

/**
 * The contact-lead template body parameters, in
 * WHATSAPP_CONTACT_TEMPLATE_PARAMETERS order: name, phone and the message
 * (flattened to one line and capped; the full text is in /admin/leads).
 */
export function buildWhatsAppContactTemplateParameters(lead: Pick<ContactLeadRecord, 'name' | 'phone' | 'message'>): string[] {
  return [templateText(lead.name), templateText(lead.phone), templateText(lead.message, CONTACT_MESSAGE_NOTIFICATION_MAX)];
}

type WhatsAppFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

export interface WhatsAppChannelOptions {
  config?: WhatsAppConfigResolution;
  fetch?: WhatsAppFetch;
  loadOrder?: (orderNumber: string) => Promise<OrderRecord | undefined>;
  loadContactLead?: (id: string) => Promise<ContactLeadRecord | undefined>;
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

type TemplateResolution = { ok: true; name: string; parameters: string[] } | { ok: false; error: string };

export function createWhatsAppChannel(options: WhatsAppChannelOptions = {}): NotificationChannel {
  const resolution = options.config ?? whatsAppConfigFromEnv();
  const doFetch: WhatsAppFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const loadOrder = options.loadOrder ?? getOrderByNumber;
  const loadContactLead = options.loadContactLead ?? getContactLeadById;
  const timeoutMs = options.timeoutMs ?? WHATSAPP_REQUEST_TIMEOUT_MS;

  return {
    id: 'whatsapp',
    events: ['order.created', 'contact.created'],
    oncePerSubject: true,
    availability: () => (resolution.state === 'ready' ? { ok: true } : { ok: false, reason: 'NOT_CONFIGURED' }),
    async send(payload) {
      if (resolution.state !== 'ready') return { ok: false, error: 'NOT_CONFIGURED' };
      const { config } = resolution;

      let template: TemplateResolution;
      if (payload.event === 'order.created') {
        let order: OrderRecord | undefined;
        try {
          order = await loadOrder(payload.orderNumber);
        } catch {
          return { ok: false, error: 'ORDER_LOOKUP_FAILED' };
        }
        template = order
          ? { ok: true, name: config.templateName, parameters: buildWhatsAppTemplateParameters(order) }
          : { ok: false, error: 'ORDER_NOT_FOUND' };
      } else if (payload.event === 'contact.created') {
        let lead: ContactLeadRecord | undefined;
        try {
          lead = await loadContactLead(payload.contactLeadId);
        } catch {
          return { ok: false, error: 'LEAD_LOOKUP_FAILED' };
        }
        template = lead
          ? { ok: true, name: config.contactTemplateName, parameters: buildWhatsAppContactTemplateParameters(lead) }
          : { ok: false, error: 'LEAD_NOT_FOUND' };
      } else {
        return { ok: false, error: 'UNSUPPORTED_EVENT' };
      }
      if (!template.ok) return { ok: false, error: template.error };

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
                name: template.name,
                language: { code: config.templateLanguage },
                components: [
                  {
                    type: 'body',
                    parameters: template.parameters.map((text) => ({ type: 'text', text })),
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
