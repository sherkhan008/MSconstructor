import { z } from 'zod';
import type { Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { VL } from '@/lib/i18n/strings';
import { MAX_SECTIONS, MIN_SECTIONS } from '@/lib/configurator/limits';
import { getPhysicalKitCount, MAX_KITS_PER_ORDER } from '@/lib/orders/limits';

/**
 * Validation for a customer-submitted configuration. This is the boundary
 * between untrusted client input and the pricing engine — every field the
 * engine reads must be validated here first, on the server, regardless of
 * what the client-side configurator already checked.
 *
 * Localization: the rules are defined ONCE (buildSchemas) and instantiated
 * per public locale, so the Kazakh and Russian schemas are the same schema
 * with different customer-facing messages (owner-reviewed CSV rows VL-*).
 * The plain named exports below are the Russian instances — the language
 * these schemas have always spoken, kept for server code, the admin panel and
 * tests. Public routes and forms pick their locale's instance via
 * schemasFor(locale).
 */

export const shelfTypeSchema = z.enum([
  'STANDARD',
  'REINFORCED',
  'EXTRA_REINFORCED',
  'PERFORATED',
  'GALVANIZED',
]);

export const priceLevelSchema = z.enum(['RETAIL', 'WHOLESALE', 'DEALER', 'CORPORATE', 'GOVERNMENT']);

export const configurationAccessorySchema = z.object({
  accessoryId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(200),
  sectionId: z.string().min(1).max(64).optional(),
});

export { MAX_SECTIONS, MIN_SECTIONS };

/** Every section owns its own width, height and shelf count (V2.2A). There
 * is no row-level height/shelves field; the per-model matrix (which heights,
 * how many shelves for that height) is checked in compatibility.ts. */
export const shelvingSectionSchema = z.object({
  id: z.string().min(1).max(64),
  width: z.number().int().min(300).max(6000),
  height: z.number().int().min(500).max(6000),
  shelves: z.number().int().min(1).max(20),
  rearWall: z.boolean(),
  leftWall: z.boolean(),
  rightWall: z.boolean(),
});

const kzPhoneRegex = /^\+?7\d{10}$/;

/**
 * Kazakhstan phone numbers are commonly typed with spaces/parens/hyphens
 * (+7 (777) 123-45-67) and with either the international "+7" country code
 * or the domestic "8" trunk prefix (87771234567) — both reach the exact
 * same physical number, so normalizing "8" to "+7" here is a standard
 * telecom convention, not inventing/replacing a different number: every
 * digit after the prefix is preserved untouched.
 */
function normalizePhoneDigits(value: string): string {
  const stripped = value.replace(/[\s()-]/g, '');
  if (/^8\d{10}$/.test(stripped)) {
    return `+7${stripped.slice(1)}`;
  }
  return stripped;
}

export const customerTypeSchema = z.enum(['INDIVIDUAL', 'LEGAL_ENTITY']);

/** Full domain enum — kept for DB/type compatibility (see PaymentPreference
 * in src/lib/types/domain.ts) and any future internal/admin use. */
export const paymentPreferenceSchema = z.enum([
  'BANK_TRANSFER',
  'BANK_INVOICE',
  'CASH',
  'KASPI_PAY',
  'KASPI_QR',
]);

/** Payment methods a customer can actually select today. KASPI_PAY/KASPI_QR
 * stay in `paymentPreferenceSchema` above for forward compatibility once a
 * real provider is integrated (see src/lib/payments/), but neither the
 * checkout UI nor this server-side schema may accept them yet — this is the
 * single list both read from. */
export const CUSTOMER_PAYMENT_METHODS = ['BANK_TRANSFER', 'BANK_INVOICE', 'CASH'] as const;

function buildSchemas(locale: Locale) {
  const phoneError = t(VL['VL-001'], locale);

  const shelvingConfigurationSchema = z.object({
    modelSlug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, t(VL['VL-009'], locale)),
    depth: z.number().int().min(150).max(2000),
    sections: z
      .array(shelvingSectionSchema)
      .min(MIN_SECTIONS, t(VL['VL-010'], locale))
      .max(MAX_SECTIONS, t(VL['VL-011'], locale, { N: MAX_SECTIONS }))
      .refine((sections) => new Set(sections.map((s) => s.id)).size === sections.length, t(VL['VL-012'], locale)),
    loadCapacity: z.number().int().min(1).max(2000),
    shelfType: shelfTypeSchema,
    colorId: z.string().min(1).max(100),
    accessories: z.array(configurationAccessorySchema).max(50),
    assemblyId: z.string().min(1).max(100),
    deliveryId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(200),
    promoCode: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9-]*$/)
      .optional(),
    priceLevel: priceLevelSchema.optional(),
    name: z.string().trim().max(120).optional(),
    // Not yet priced/BOM-backed — see ShelvingConfiguration's own doc comment.
    metalFootPad: z.boolean().optional(),
    shelfCornerBrackets: z.boolean().optional(),
  });

  const phoneSchema = z
    .string()
    .trim()
    .transform(normalizePhoneDigits)
    .refine((v) => kzPhoneRegex.test(v), phoneError);

  const customerPaymentPreferenceSchema = z.enum(CUSTOMER_PAYMENT_METHODS, {
    message: t(VL['VL-007'], locale),
  });

  const orderItemSchema = z.object({
    configuration: shelvingConfigurationSchema,
  });

  const orderRequestObjectSchema = z.object({
    fullName: z.string().trim().min(2, t(VL['VL-002'], locale)).max(200),
    phone: phoneSchema,
    whatsapp: z
      .string()
      .trim()
      .transform(normalizePhoneDigits)
      .refine((v) => v === '' || kzPhoneRegex.test(v), phoneError)
      .optional(),
    email: z.string().trim().max(200).email(t(VL['VL-003'], locale)),
    city: z.string().trim().min(1, t(VL['VL-014'], locale)).max(120),
    companyName: z.string().trim().max(300).optional(),
    binIin: z
      .string()
      .trim()
      .regex(/^\d{12}$/, t(VL['VL-004'], locale))
      .optional()
      .or(z.literal('')),
    deliveryAddress: z.string().trim().max(500).optional(),
    customerType: customerTypeSchema,
    paymentPreference: customerPaymentPreferenceSchema,
    comment: z.string().trim().max(2000).optional(),
    // The physical-kit limit counts quantities, not lines (see
    // src/lib/orders/limits.ts). Enforced here, on the server, so a forged
    // request or a stale browser cart can never exceed it.
    items: z
      .array(orderItemSchema)
      .min(1)
      .max(50)
      .refine(
        (items) => getPhysicalKitCount(items) <= MAX_KITS_PER_ORDER,
        t(VL['VL-018'], locale, { N: MAX_KITS_PER_ORDER }),
      ),
  });

  /** For LEGAL_ENTITY, companyName and a valid 12-digit binIin are required —
   * enforced here (not only in the conditionally-rendered React fields) so a
   * direct API request cannot skip them. */
  function checkCustomerTypeFields(
    data: { customerType: 'INDIVIDUAL' | 'LEGAL_ENTITY'; companyName?: string; binIin?: string },
    ctx: z.RefinementCtx,
  ): void {
    if (data.customerType !== 'LEGAL_ENTITY') return;

    if (!data.companyName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['companyName'], message: t(VL['VL-006'], locale) });
    }
    if (!data.binIin?.trim() || !/^\d{12}$/.test(data.binIin.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['binIin'], message: t(VL['VL-005'], locale) });
    }
  }

  const orderRequestSchema = orderRequestObjectSchema.superRefine(checkCustomerTypeFields);

  /** Customer-facing subset of the order request — the checkout form collects
   * exactly these fields; `items` comes from the cart, not user input. */
  const orderFormSchema = orderRequestObjectSchema.omit({ items: true }).superRefine(checkCustomerTypeFields);

  return {
    shelvingConfigurationSchema,
    phoneSchema,
    customerPaymentPreferenceSchema,
    orderItemSchema,
    orderRequestSchema,
    orderFormSchema,
  };
}

const SCHEMAS: Record<Locale, ReturnType<typeof buildSchemas>> = {
  ru: buildSchemas('ru'),
  kk: buildSchemas('kk'),
};

/** The public schemas with customer messages in `locale`. */
export function schemasFor(locale: Locale): ReturnType<typeof buildSchemas> {
  return SCHEMAS[locale];
}

export const shelvingConfigurationSchema = SCHEMAS.ru.shelvingConfigurationSchema;
export const phoneSchema = SCHEMAS.ru.phoneSchema;
export const customerPaymentPreferenceSchema = SCHEMAS.ru.customerPaymentPreferenceSchema;
export const orderItemSchema = SCHEMAS.ru.orderItemSchema;
export const orderRequestSchema = SCHEMAS.ru.orderRequestSchema;
export const orderFormSchema = SCHEMAS.ru.orderFormSchema;

export type ShelvingConfigurationInput = z.infer<typeof shelvingConfigurationSchema>;
export type OrderRequestInput = z.infer<typeof orderRequestSchema>;
export type OrderFormInput = z.infer<typeof orderFormSchema>;

export function parseConfiguration(input: unknown, locale: Locale = 'ru') {
  return SCHEMAS[locale].shelvingConfigurationSchema.safeParse(input);
}
