import { z } from 'zod';

/**
 * Validation for a customer-submitted configuration. This is the boundary
 * between untrusted client input and the pricing engine — every field the
 * engine reads must be validated here first, on the server, regardless of
 * what the client-side configurator already checked.
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

export const MIN_SECTIONS = 1;
export const MAX_SECTIONS = 10;

export const shelvingSectionSchema = z.object({
  id: z.string().min(1).max(64),
  width: z.number().int().min(300).max(6000),
  rearWall: z.boolean(),
  leftWall: z.boolean(),
  rightWall: z.boolean(),
});

export const shelvingConfigurationSchema = z.object({
  modelSlug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Недопустимый идентификатор модели'),
  height: z.number().int().min(500).max(6000),
  depth: z.number().int().min(150).max(2000),
  shelves: z.number().int().min(1).max(20),
  sections: z
    .array(shelvingSectionSchema)
    .min(MIN_SECTIONS, `Должна быть хотя бы одна секция`)
    .max(MAX_SECTIONS, `Достигнуто максимальное количество секций (${MAX_SECTIONS})`)
    .refine(
      (sections) => new Set(sections.map((s) => s.id)).size === sections.length,
      'Идентификаторы секций должны быть уникальными',
    ),
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

export type ShelvingConfigurationInput = z.infer<typeof shelvingConfigurationSchema>;

export function parseConfiguration(input: unknown) {
  return shelvingConfigurationSchema.safeParse(input);
}

/* -------------------------------------------------------------------------- */
/* Customer + order validation                                                */
/* -------------------------------------------------------------------------- */

const kzPhoneRegex = /^\+?7\d{10}$/;
const PHONE_ERROR = 'Укажите корректный номер телефона';

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

export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhoneDigits)
  .refine((v) => kzPhoneRegex.test(v), PHONE_ERROR);

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
export const customerPaymentPreferenceSchema = z.enum(CUSTOMER_PAYMENT_METHODS, {
  message: 'Выберите способ оплаты',
});

export const orderItemSchema = z.object({
  configuration: shelvingConfigurationSchema,
});

const orderRequestObjectSchema = z.object({
  fullName: z.string().trim().min(2, 'Введите имя').max(200),
  phone: phoneSchema,
  whatsapp: z
    .string()
    .trim()
    .transform(normalizePhoneDigits)
    .refine((v) => v === '' || kzPhoneRegex.test(v), PHONE_ERROR)
    .optional(),
  email: z.string().trim().max(200).email('Укажите корректный email'),
  city: z.string().trim().min(1).max(120),
  companyName: z.string().trim().max(300).optional(),
  binIin: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'ИИН/БИН должен содержать 12 цифр')
    .optional()
    .or(z.literal('')),
  deliveryAddress: z.string().trim().max(500).optional(),
  customerType: customerTypeSchema,
  paymentPreference: customerPaymentPreferenceSchema,
  comment: z.string().trim().max(2000).optional(),
  items: z.array(orderItemSchema).min(1).max(50),
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['companyName'], message: 'Укажите название компании' });
  }
  if (!data.binIin?.trim() || !/^\d{12}$/.test(data.binIin.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['binIin'], message: 'БИН должен содержать 12 цифр' });
  }
}

export const orderRequestSchema = orderRequestObjectSchema.superRefine(checkCustomerTypeFields);
export type OrderRequestInput = z.infer<typeof orderRequestSchema>;

/** Customer-facing subset of the order request — the checkout form collects
 * exactly these fields; `items` comes from the cart, not user input. */
export const orderFormSchema = orderRequestObjectSchema.omit({ items: true }).superRefine(checkCustomerTypeFields);
export type OrderFormInput = z.infer<typeof orderFormSchema>;
