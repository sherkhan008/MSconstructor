import { env } from '@/lib/env';
import { formatOrderEventText, type OrderEventPayload } from './events';

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
  availability(): ChannelAvailability;
  send(payload: OrderEventPayload): Promise<ChannelSendResult>;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface TelegramChannelOptions {
  botToken?: string;
  chatId?: string;
  fetch?: FetchLike;
}

/** Telegram Bot API. The token lives only in the request URL, is never logged
 * and is never part of an error code. `fetch` is injectable so tests never
 * touch the network. */
export function createTelegramChannel(options: TelegramChannelOptions = {}): NotificationChannel {
  const botToken = options.botToken ?? env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? env.TELEGRAM_CHAT_ID;
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    id: 'telegram',
    availability: () => (botToken && chatId ? { ok: true } : { ok: false, reason: 'NOT_CONFIGURED' }),
    async send(payload) {
      if (!botToken || !chatId) return { ok: false, error: 'NOT_CONFIGURED' };
      try {
        const response = await doFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: formatOrderEventText(payload) }),
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

// WhatsApp is a future provider: implement NotificationChannel and add it here.
export function defaultChannels(): NotificationChannel[] {
  return [createTelegramChannel(), createEmailChannel()];
}
