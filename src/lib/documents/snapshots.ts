import { z } from 'zod';
import { METAL_FOOT_PAD_LABEL, SHELF_CORNER_BRACKETS_LABEL } from '@/lib/configurator/additional-options';
import { findAssembly, findColor, findDelivery, findModel, type Catalog } from '@/lib/data/repository';
import { toPublicBom } from '@/lib/pricing/bom';
import type { BomLine, CustomerType, PriceBreakdown, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Order-time snapshots that commercial documents are printed from.
 *
 * Written once, when POST /api/orders saves the order, and never updated.
 * A document never falls back to today's Customer row, catalog names or
 * pricing settings: an order without these snapshots (placed before they
 * existed) is refused rather than reconstructed from data that may have
 * changed since.
 *
 * Every snapshot carries `version`, so a future shape can be told apart from
 * this one instead of being misread. Money is stored as fixed two-decimal
 * strings — exactly what the Decimal(14, 2) order columns hold — and is only
 * ever read back through toTiyn().
 */

export const DOCUMENT_SNAPSHOT_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Buyer                                                                       */
/* -------------------------------------------------------------------------- */

/** Commercial-party data captured at checkout, before the shared Customer
 * profile (upserted by phone + type on every order) can change. */
export interface OrderBuyerSnapshot {
  version: typeof DOCUMENT_SNAPSHOT_VERSION;
  type: CustomerType;
  fullName: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  companyName?: string;
  binIin?: string;
}

export interface BuyerSnapshotInput {
  type: CustomerType;
  fullName: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  companyName?: string;
  binIin?: string;
}

const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function createOrderBuyerSnapshot(input: BuyerSnapshotInput): OrderBuyerSnapshot {
  return {
    version: DOCUMENT_SNAPSHOT_VERSION,
    type: input.type,
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    whatsapp: present(input.whatsapp),
    email: present(input.email),
    city: present(input.city),
    // A company name only identifies a legal-entity buyer.
    companyName: input.type === 'LEGAL_ENTITY' ? present(input.companyName) : undefined,
    binIin: present(input.binIin),
  };
}

// Limits mirror orderRequestSchema, so every snapshot a valid checkout writes
// parses back; anything larger was not written by this application.
const buyerSnapshotSchema = z.object({
  version: z.literal(DOCUMENT_SNAPSHOT_VERSION),
  type: z.enum(['INDIVIDUAL', 'LEGAL_ENTITY']),
  fullName: z.string().min(1).max(200),
  phone: z.string().min(1).max(40),
  whatsapp: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  companyName: z.string().max(300).optional(),
  binIin: z.string().max(20).optional(),
});

/** Runtime-validated read of Order.buyerSnapshot. Null when absent or not a
 * snapshot this application wrote — never a partial guess. */
export function parseOrderBuyerSnapshot(raw: unknown): OrderBuyerSnapshot | null {
  const parsed = buyerSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* -------------------------------------------------------------------------- */
/* Item                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The order-time price breakdown of one item, exactly as the pricing engine
 * returned it (src/lib/pricing/engine.ts).
 *
 * `unitPrice`, `goodsAmount`, `assembly`, `delivery` and `discount` are all on
 * one basis — VAT-inclusive when `pricesIncludeVat`, VAT-exclusive otherwise:
 *
 *   base = goodsAmount + assembly + (delivery ?? 0) − discount
 *   VAT-exclusive: net = base,  total = net + vat
 *   VAT-inclusive: total = base, net = total − vat
 *
 * `delivery` is null when its price was not known at order time (confirmed
 * by a manager) — it was not charged, so it is not invoiced.
 */
export interface OrderItemPricingSnapshot {
  pricesIncludeVat: boolean;
  vatPercent: number;
  quantity: number;
  unitPrice: string;
  goodsAmount: string;
  assembly: string;
  delivery: string | null;
  discount: string;
  net: string;
  vat: string;
  total: string;
}

/** Customer-safe labels, public kit and price breakdown captured with an
 * OrderItem. Never contains component prices, costs, SKUs or markup. */
export interface OrderItemDocumentSnapshot {
  version: typeof DOCUMENT_SNAPSHOT_VERSION;
  modelName: string;
  colorName?: string;
  assemblyName?: string;
  deliveryName?: string;
  /** Selected additional options, as the customer saw them named. */
  options: string[];
  /** toPublicBom() at order time: name + quantity only. */
  kit: { name: string; quantity: number }[];
  pricing: OrderItemPricingSnapshot;
}

export interface ItemSnapshotInput {
  configuration: ShelvingConfiguration;
  /** The priced BOM; only public names and quantities are kept. */
  bom: BomLine[];
  breakdown: PriceBreakdown;
  /** catalog.pricingSettings.pricesIncludeVat of the catalog the item was priced against. */
  pricesIncludeVat: boolean;
}

function money(tenge: number): string {
  if (!Number.isFinite(tenge)) throw new Error('Order snapshot: non-finite amount');
  return tenge.toFixed(2);
}

export function createOrderItemDocumentSnapshot(input: ItemSnapshotInput, catalog: Catalog): OrderItemDocumentSnapshot {
  const { configuration: config, breakdown: b } = input;
  const options = [
    config.metalFootPad ? METAL_FOOT_PAD_LABEL : undefined,
    config.shelfCornerBrackets ? SHELF_CORNER_BRACKETS_LABEL : undefined,
  ].filter((label): label is string => Boolean(label));

  return {
    version: DOCUMENT_SNAPSHOT_VERSION,
    modelName: findModel(catalog, config.modelSlug)?.name.ru ?? config.modelSlug,
    colorName: findColor(catalog, config.colorId)?.name.ru,
    assemblyName: findAssembly(catalog, config.assemblyId)?.name.ru,
    deliveryName: findDelivery(catalog, config.deliveryId)?.name.ru,
    options,
    // The established customer-facing kit boundary (MS Standard folds its
    // beams, frame ties and connectors into shelves and frames).
    kit: toPublicBom(input.bom, config.modelSlug).map((line) => ({ name: line.name, quantity: line.quantity })),
    pricing: {
      pricesIncludeVat: input.pricesIncludeVat,
      vatPercent: b.vatPercent,
      quantity: b.quantity,
      unitPrice: money(b.unitNet),
      goodsAmount: money(b.itemsNet),
      assembly: money(b.assembly),
      delivery: b.delivery === null ? null : money(b.delivery),
      discount: money(b.discount),
      net: money(b.net),
      vat: money(b.vat),
      total: money(b.total),
    },
  };
}

const amount = z.string().regex(/^-?\d{1,12}\.\d{2}$/);
const label = z.string().min(1).max(300);

const itemSnapshotSchema = z.object({
  version: z.literal(DOCUMENT_SNAPSHOT_VERSION),
  modelName: label,
  colorName: label.optional(),
  assemblyName: label.optional(),
  deliveryName: label.optional(),
  options: z.array(label).max(20),
  kit: z.array(z.object({ name: label, quantity: z.number().int().positive() })).max(500),
  pricing: z.object({
    pricesIncludeVat: z.boolean(),
    vatPercent: z.number().finite().min(0).max(100),
    quantity: z.number().int().positive(),
    unitPrice: amount,
    goodsAmount: amount,
    assembly: amount,
    delivery: amount.nullable(),
    discount: amount,
    net: amount,
    vat: amount,
    total: amount,
  }),
});

/** Runtime-validated read of OrderItem.documentSnapshot; null when absent or
 * malformed. Unknown keys are dropped, so nothing unexpected reaches a PDF. */
export function parseOrderItemDocumentSnapshot(raw: unknown): OrderItemDocumentSnapshot | null {
  const parsed = itemSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
