import { z } from 'zod';
import { ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';
import { parsePriceInput } from '@/lib/admin/price-input';
import { INTERNAL_NOTES_MAX_LENGTH, toPlainTextNotes } from '@/lib/admin/internal-notes';
import { UNASSIGNED_MANAGER_VALUE } from '@/lib/admin/order-filters';
import type { PriceEntityType } from '@/lib/admin/prices';

export const adminLoginSchema = z.object({
  email: z.string().trim().min(1).max(200).email(),
  password: z.string().min(1).max(200),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/**
 * A workflow step. Parsing only answers "is this a real status value" — which
 * step is legal from where, and who is trusted to take it, is decided by
 * src/lib/orders/status-transitions.ts inside updateOrderStatus().
 */
export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  /** Order.updatedAt as the client loaded it — the lost-update guard. */
  expectedUpdatedAt: z.string().datetime().optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Price management                                                            */
/* -------------------------------------------------------------------------- */

// Type-only import: keeps the heavy admin price service out of this module's
// runtime graph while still failing the build if the two ever drift apart.
const PRICE_ENTITY_TYPE_VALUES = ['COMPONENT', 'ACCESSORY'] as const satisfies readonly PriceEntityType[];

export const priceEntityTypeSchema = z.enum(PRICE_ENTITY_TYPE_VALUES);

/**
 * One price field. Accepts only a validated decimal string and yields a
 * Prisma.Decimal — the value is never a JS float anywhere on this path. See
 * src/lib/admin/price-input.ts for the exact accept/reject contract.
 */
const priceValueSchema = z
  .unknown()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined) return undefined;
    const parsed = parsePriceInput(raw);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
      return z.NEVER;
    }
    return parsed.value;
  });

/** An edit may move the selling price, the purchase price, or both. */
export const updatePricesSchema = z
  .object({
    sellingPrice: priceValueSchema,
    purchasePrice: priceValueSchema,
    /** `updatedAt` as the admin loaded it — the lost-update guard. */
    expectedUpdatedAt: z.string().datetime().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.sellingPrice !== undefined || value.purchasePrice !== undefined, {
    message: 'Укажите хотя бы одну цену для изменения.',
  });
export type UpdatePricesInput = z.infer<typeof updatePricesSchema>;

const optionalPage = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().int().min(1).max(100_000).optional(),
);

export const adminPriceListQuerySchema = z.object({
  /** Free-text search over SKU and Russian name. */
  q: z.string().trim().max(200).optional(),
  entityType: z.enum(['ALL', ...PRICE_ENTITY_TYPE_VALUES]).optional(),
  componentType: z.string().trim().max(40).regex(/^[A-Z_]+$/).optional(),
  model: z.string().trim().max(100).optional(),
  page: optionalPage,
});
export type AdminPriceListQuery = z.infer<typeof adminPriceListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Order assignment and internal notes                                         */
/* -------------------------------------------------------------------------- */

/**
 * Who is responsible for an order.
 *
 * `null` — and the two spellings the UI's <select> can produce for "nobody"
 * (the empty option and the UNASSIGNED sentinel the list filter also uses) —
 * all mean "снять ответственного". Which roles may actually do that is not a
 * parsing question: it is decided in assignOrderManager().
 */
export const assignOrderManagerSchema = z.object({
  managerId: z
    .union([z.string().trim().max(64), z.null()])
    .transform((value) =>
      value === null || value === '' || value === UNASSIGNED_MANAGER_VALUE ? null : value,
    )
    .refine((value) => value === null || /^[A-Za-z0-9_-]{1,64}$/.test(value), {
      message: 'Некорректный идентификатор сотрудника.',
    }),
  /** Order.updatedAt as the client loaded it — the lost-update guard. */
  expectedUpdatedAt: z.string().datetime().optional(),
});
export type AssignOrderManagerInput = z.infer<typeof assignOrderManagerSchema>;

/**
 * Internal notes. The length cap is checked on the RAW text, before tags are
 * stripped, so a 6000-character payload is rejected rather than quietly
 * shortened into an accepted one.
 */
export const updateOrderInternalNotesSchema = z.object({
  internalNotes: z
    .string()
    .max(INTERNAL_NOTES_MAX_LENGTH, `Заметка не может быть длиннее ${INTERNAL_NOTES_MAX_LENGTH} символов.`)
    .transform(toPlainTextNotes),
  expectedUpdatedAt: z.string().datetime().optional(),
});
export type UpdateOrderInternalNotesInput = z.infer<typeof updateOrderInternalNotesSchema>;
