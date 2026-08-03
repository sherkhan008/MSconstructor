import { z } from 'zod';

/**
 * Validation for a customer-submitted configuration. This is the boundary
 * between untrusted client input and the pricing engine — every field the
 * engine reads must be validated here first, on the server, regardless of
 * what the client-side configurator already checked.
 */

export const configurationTypeSchema = z.enum([
  'SINGLE',
  'MULTIPLE_INDEPENDENT',
  'STARTER_WITH_EXTENSIONS',
  'CONTINUOUS_ROW',
  'L_SHAPE',
  'U_SHAPE',
]);

export const shelfTypeSchema = z.enum([
  'STANDARD',
  'REINFORCED',
  'EXTRA_REINFORCED',
  'PERFORATED',
  'GALVANIZED',
]);

export const rearOptionSchema = z.enum(['NONE', 'CROSS_BRACE', 'SOLID', 'PERFORATED']);

export const sideOptionSchema = z.enum([
  'NONE',
  'LEFT',
  'RIGHT',
  'BOTH',
  'LEFT_PERFORATED',
  'RIGHT_PERFORATED',
  'BOTH_PERFORATED',
]);

export const priceLevelSchema = z.enum(['RETAIL', 'WHOLESALE', 'DEALER', 'CORPORATE', 'GOVERNMENT']);

export const configurationAccessorySchema = z.object({
  accessoryId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(200),
});

export const shelvingConfigurationSchema = z.object({
  modelSlug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Недопустимый идентификатор модели'),
  configurationType: configurationTypeSchema,
  height: z.number().int().min(500).max(6000),
  width: z.number().int().min(300).max(6000),
  depth: z.number().int().min(150).max(2000),
  shelves: z.number().int().min(1).max(20),
  sections: z.number().int().min(1).max(20),
  loadCapacity: z.number().int().min(1).max(2000),
  shelfType: shelfTypeSchema,
  colorId: z.string().min(1).max(100),
  rear: rearOptionSchema,
  side: sideOptionSchema,
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
});

export type ShelvingConfigurationInput = z.infer<typeof shelvingConfigurationSchema>;

export function parseConfiguration(input: unknown) {
  return shelvingConfigurationSchema.safeParse(input);
}

/* -------------------------------------------------------------------------- */
/* Customer + order validation                                                */
/* -------------------------------------------------------------------------- */

const kzPhoneRegex = /^\+?7\d{10}$/;

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => kzPhoneRegex.test(v), 'Введите номер в формате +7XXXXXXXXXX');

export const customerTypeSchema = z.enum(['INDIVIDUAL', 'LEGAL_ENTITY']);
export const paymentPreferenceSchema = z.enum([
  'BANK_TRANSFER',
  'BANK_INVOICE',
  'CASH',
  'KASPI_PAY',
  'KASPI_QR',
]);

export const orderItemSchema = z.object({
  configuration: shelvingConfigurationSchema,
});

export const orderRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: phoneSchema,
  whatsapp: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ''))
    .refine((v) => v === '' || kzPhoneRegex.test(v), 'Введите номер в формате +7XXXXXXXXXX')
    .optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
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
  paymentPreference: paymentPreferenceSchema,
  comment: z.string().trim().max(2000).optional(),
  items: z.array(orderItemSchema).min(1).max(50),
});

export type OrderRequestInput = z.infer<typeof orderRequestSchema>;

/** Customer-facing subset of the order request — the checkout form collects
 * exactly these fields; `items` comes from the cart, not user input. */
export const orderFormSchema = orderRequestSchema.omit({ items: true });
export type OrderFormInput = z.infer<typeof orderFormSchema>;
