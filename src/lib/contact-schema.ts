import { z } from 'zod';
import type { Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { VL } from '@/lib/i18n/strings';
import { schemasFor } from '@/lib/pricing/schema';

const NAME_MAX = 200;
const MESSAGE_MAX = 2000;

/** Same rules for every locale; only the customer-facing messages differ. */
function buildContactRequestSchema(locale: Locale) {
  return z.object({
    name: z.string().trim().min(2, t(VL['VL-002'], locale)).max(NAME_MAX, t(VL['VL-016'], locale, { N: NAME_MAX })),
    phone: schemasFor(locale).phoneSchema,
    message: z.string().trim().min(1, t(VL['VL-015'], locale)).max(MESSAGE_MAX, t(VL['VL-017'], locale, { N: MESSAGE_MAX })),
  });
}

const CONTACT_SCHEMAS: Record<Locale, ReturnType<typeof buildContactRequestSchema>> = {
  ru: buildContactRequestSchema('ru'),
  kk: buildContactRequestSchema('kk'),
};

export function contactRequestSchemaFor(locale: Locale) {
  return CONTACT_SCHEMAS[locale];
}

export const contactRequestSchema = CONTACT_SCHEMAS.ru;

export type ContactRequestInput = z.infer<typeof contactRequestSchema>;
