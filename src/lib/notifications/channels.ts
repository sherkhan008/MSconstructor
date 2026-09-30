import { env } from '@/lib/env';
import { getContactLeadById, type ContactLeadRecord } from '@/lib/contact-leads/store';
import {
  formatContactLeadText,
  formatOrderEventText,
  isContactLeadEvent,
  type NotificationEventPayload,
  type NotificationEventType,
} from './events';
import { createWhatsAppChannel } from './providers/whatsapp';

/**
 * Channel adapters. Each one answers two questions and nothing else:
 * "can you send right now?" and "send this". Neither ever throws — failures
 * are returned as short codes so they can be stored and logged verbatim
 * (a code can never contain a token; a provider's raw message might).
 */

export type ChannelAvailability = { ok: true } | { ok: false; reason: 'NOT_CONFIGURED' | 'NO_TRANSPORT' };
export type ChannelSendResult = { ok: true } | { ok: false; error: string };

export interface NotificationChannel {
  id: string;
  /** Events this channel handles; omitted = every event. Others are ignored silently. */
  events?: readonly NotificationEventType[];
  /** Skip an event already SENT on this channel for the same subject — order
   * or contact lead (outbox check). */
  oncePerSubject?: boolean;
  availability(): ChannelAvailability;
  send(payload: NotificationEventPayload): Promise<ChannelSendResult>;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface TelegramChannelOptions {
  botToken?: string;
  chatId?: string;
  fetch?: FetchLike;
  loadContactLead?: (id: string) => Promise<ContactLeadRecord | undefined>;
}

/** Telegram Bot API — a secondary manager channel next to WhatsApp, sent in
 * parallel (never conditional on WhatsApp's outcome). Order events keep their
 * redacted text; a contact lead is sent as name, phone and message, read from
 * the stored lead at send time (the outbox keeps only its id). Plain text, no
 * parse_mode, so nothing a customer typed can become markup.
 *
 * The token lives only in the request URL, is never logged and is never part
 * of an error code. `fetch` is injectable so tests never touch the network. */
export function createTelegramChannel(options: TelegramChannelOptions = {}): NotificationChannel {
  const botToken = options.botToken ?? env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? env.TELEGRAM_CHAT_ID;
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const loadContactLead = options.loadContactLead ?? getContactLeadById;
  return {
    id: 'telegram',
    availability: () => (botToken && chatId ? { ok: true } : { ok: false, reason: 'NOT_CONFIGURED' }),
    async send(payload) {
      if (!botToken || !chatId) return { ok: false, error: 'NOT_CONFIGURED' };
      let text: string;
      if (isContactLeadEvent(payload)) {
        let lead: ContactLeadRecord | undefined;
        try {
          lead = await loadContactLead(payload.contactLeadId);
        } catch {
          return { ok: false, error: 'LEAD_LOOKUP_FAILED' };
        }
        if (!lead) return { ok: false, error: 'LEAD_NOT_FOUND' };
        text = formatContactLeadText(lead);
      } else {
        text = formatOrderEventText(payload);
      }
      try {
        const response = await doFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        return response.ok ? { ok: true } : { ok: false, error: `HTTP_${response.status}` };
      } catch {
        return { ok: false, error: 'NETWORK_ERROR' };
      }
    },
  };
}

/**
 * Email. No SMTP transport library is installed, so this channel is honestly
 * unavailable: it never reports a delivery it did not make. Adding nodemailer
 * (or a provider SDK) means implementing `send` here and returning
 * `{ ok: true }` from `availability` when SMTP_* and a recipient are set.
 */
export function createEmailChannel(): NotificationChannel {
  return {
    id: 'email',
    availability: () =>
      env.SMTP_HOST && env.SMTP_USER && (env.MANAGER_EMAIL ?? env.EMAIL_FROM)
        ? { ok: false, reason: 'NO_TRANSPORT' }
        : { ok: false, reason: 'NOT_CONFIGURED' },
    send: async () => ({ ok: false, error: 'NO_TRANSPORT' }),
  };
}

/** WhatsApp (internal manager alert: order.created and contact.created) is
 * added only when WHATSAPP_NOTIFICATIONS_ENABLED is exactly "true": disabled
 * means no channel, no log line, no network call. */
export function defaultChannels(): NotificationChannel[] {
  const channels = [createTelegramChannel(), createEmailChannel()];
  if (env.WHATSAPP_NOTIFICATIONS_ENABLED?.trim() === 'true') channels.push(createWhatsAppChannel());
  return channels;
}
