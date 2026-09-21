/**
 * WhatsApp Cloud API configuration for the internal new-order notification.
 *
 * Pure functions of their input (no `env` import) so the same rules run in
 * the production startup check (src/lib/startup/production-config.ts) and in
 * the channel itself (./whatsapp.ts), and are unit-testable.
 *
 * OFF unless WHATSAPP_NOTIFICATIONS_ENABLED is the exact string "true" —
 * anything else leaves it off, so a typo fails closed. Problems are reported
 * by variable NAME only, never by value.
 */

/** Graph API version used when WHATSAPP_GRAPH_API_VERSION is not set. */
export const WHATSAPP_DEFAULT_GRAPH_API_VERSION = 'v24.0';

export interface WhatsAppEnvInput {
  WHATSAPP_NOTIFICATIONS_ENABLED?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ADMIN_RECIPIENT?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
  WHATSAPP_TEMPLATE_LANGUAGE?: string;
  WHATSAPP_GRAPH_API_VERSION?: string;
}

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  /** Normalised: digits only, with country code (Meta's `to` format). */
  recipient: string;
  templateName: string;
  templateLanguage: string;
  graphApiVersion: string;
}

export type WhatsAppConfigResolution =
  | { state: 'disabled' }
  | { state: 'invalid'; problems: string[] }
  | { state: 'ready'; config: WhatsAppConfig };

/**
 * "+7 (707) 123-45-67" / "00 7 707 1234567" → "77071234567". Returns null
 * when the value is not an international number (8–15 digits, E.164 limit)
 * or contains anything other than digits and phone punctuation. No national
 * trunk prefix is rewritten: a leading 8 is ambiguous (KZ/RU trunk prefix vs
 * a real country code), so the country code must be written out.
 */
export function normalizeWhatsAppRecipient(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function resolveWhatsAppConfig(input: WhatsAppEnvInput): WhatsAppConfigResolution {
  if (input.WHATSAPP_NOTIFICATIONS_ENABLED?.trim() !== 'true') return { state: 'disabled' };

  const problems: string[] = [];
  const accessToken = input.WHATSAPP_ACCESS_TOKEN?.trim() ?? '';
  const phoneNumberId = input.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '';
  const templateName = input.WHATSAPP_TEMPLATE_NAME?.trim() ?? '';
  const templateLanguage = input.WHATSAPP_TEMPLATE_LANGUAGE?.trim() ?? '';
  const graphApiVersion = input.WHATSAPP_GRAPH_API_VERSION?.trim() || WHATSAPP_DEFAULT_GRAPH_API_VERSION;
  const recipient = normalizeWhatsAppRecipient(input.WHATSAPP_ADMIN_RECIPIENT);

  if (!accessToken) problems.push('WHATSAPP_ACCESS_TOKEN is required');
  if (!phoneNumberId) problems.push('WHATSAPP_PHONE_NUMBER_ID is required');
  else if (!/^\d+$/.test(phoneNumberId)) problems.push('WHATSAPP_PHONE_NUMBER_ID must be the numeric Phone Number ID');
  if (!input.WHATSAPP_ADMIN_RECIPIENT?.trim()) problems.push('WHATSAPP_ADMIN_RECIPIENT is required');
  else if (!recipient) problems.push('WHATSAPP_ADMIN_RECIPIENT must be an international phone number with country code');
  if (!templateName) problems.push('WHATSAPP_TEMPLATE_NAME is required');
  else if (!/^[a-z0-9_]{1,512}$/.test(templateName)) problems.push('WHATSAPP_TEMPLATE_NAME must use lowercase letters, digits and underscores');
  if (!templateLanguage) problems.push('WHATSAPP_TEMPLATE_LANGUAGE is required');
  else if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(templateLanguage)) problems.push('WHATSAPP_TEMPLATE_LANGUAGE must be a template language code such as "ru"');
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) problems.push('WHATSAPP_GRAPH_API_VERSION must look like "v24.0"');

  if (problems.length > 0 || !recipient) return { state: 'invalid', problems };
  return {
    state: 'ready',
    config: { accessToken, phoneNumberId, recipient, templateName, templateLanguage, graphApiVersion },
  };
}
