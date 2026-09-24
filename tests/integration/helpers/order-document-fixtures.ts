import type { DocumentIssuance } from '@/lib/documents/build';
import type { DecimalLike } from '@/lib/documents/money';
import type { OrderDocumentSource, OrderDocumentSourceItem } from '@/lib/documents/order-source';
import type { OrderBuyerSnapshot, OrderItemDocumentSnapshot, OrderItemPricingSnapshot } from '@/lib/documents/snapshots';

/**
 * Persisted-order shapes for document tests, mirroring exactly what
 * POST /api/orders + saveOrderToDb() write: configuration JSON, the
 * order-time buyer snapshot, a per-item document snapshot (labels, public
 * kit, price breakdown) and Decimal-like money columns.
 *
 * Amounts are computed in integer tiyn so every fixture is internally
 * consistent — the same identities the pricing engine guarantees:
 *   goods = unit × quantity; base = goods + assembly + delivery − discount
 *   VAT-exclusive: net = base, total = net + vat
 *   VAT-inclusive: total = base, net = total − vat
 */

type Money = number | string;

/** Tenge (number or "1000.55") → integer tiyn, exactly. */
function tiyn(value: Money): number {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const [whole, fraction = ''] = text.split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, '0')));
}

function money(t: number): string {
  const sign = t < 0 ? '-' : '';
  const abs = Math.abs(t);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function decimal(value: Money) {
  const text = money(tiyn(value));
  return { toFixed: () => text };
}

function asTiyn(value: DecimalLike): number {
  return tiyn(typeof value === 'object' ? value.toFixed(2) : value);
}

/** What the customer-facing kit of the fixture BOM looks like after
 * toPublicBom() for MS Standard: beams, frame ties folded away. */
export const PUBLIC_KIT = [
  { name: 'Стойка 2000 мм', quantity: 4 },
  { name: 'Полка Стандартная 1000×400', quantity: 5 },
  { name: 'Болт с гайкой М6', quantity: 36 },
];

export function configuration(widths: number[], overrides: Record<string, unknown> = {}) {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    metalFootPad: false,
    shelfCornerBrackets: false,
    sections: widths.map((width, i) => ({ id: `sec-${i}`, width, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false })),
    ...overrides,
  };
}

export interface PricingInput {
  unit?: Money;
  quantity?: number;
  assembly?: Money;
  delivery?: Money | null;
  discount?: Money;
  pricesIncludeVat?: boolean;
  vatPercent?: number;
  /** Persisted VAT; defaults to the engine's rounding of the given rate. */
  vat?: Money;
}

export function pricing(input: PricingInput = {}): OrderItemPricingSnapshot {
  const quantity = input.quantity ?? 1;
  const vatPercent = input.vatPercent ?? 16;
  const pricesIncludeVat = input.pricesIncludeVat ?? false;
  const unit = tiyn(input.unit ?? 191979);
  const goods = unit * quantity;
  const assembly = tiyn(input.assembly ?? 0);
  const delivery = input.delivery === null ? null : tiyn(input.delivery ?? 0);
  const discount = tiyn(input.discount ?? 0);
  const base = goods + assembly + (delivery ?? 0) - discount;

  let net: number;
  let vat: number;
  let total: number;
  if (pricesIncludeVat) {
    total = base;
    vat = input.vat !== undefined ? tiyn(input.vat) : Math.round((total * vatPercent) / (100 + vatPercent) / 100) * 100;
    net = total - vat;
  } else {
    net = base;
    vat = input.vat !== undefined ? tiyn(input.vat) : Math.round((net * vatPercent) / 100 / 100) * 100;
    total = net + vat;
  }
  return {
    pricesIncludeVat,
    vatPercent,
    quantity,
    unitPrice: money(unit),
    goodsAmount: money(goods),
    assembly: money(assembly),
    delivery: delivery === null ? null : money(delivery),
    discount: money(discount),
    net: money(net),
    vat: money(vat),
    total: money(total),
  };
}

export function itemSnapshot(overrides: Partial<OrderItemDocumentSnapshot> = {}, priced: PricingInput = {}): OrderItemDocumentSnapshot {
  return {
    version: 1,
    modelName: 'MS Стандарт',
    colorName: 'Стандартный серый',
    assemblyName: 'Самостоятельная сборка',
    deliveryName: 'Самовывоз со склада',
    options: [],
    kit: PUBLIC_KIT,
    pricing: pricing(priced),
    ...overrides,
  };
}

export interface ItemInput extends PricingInput {
  id?: string;
  configuration?: unknown;
  snapshot?: Partial<OrderItemDocumentSnapshot>;
  /** Raw column value, bypassing the generated snapshot (legacy/malformed). */
  documentSnapshot?: unknown;
}

export function item(input: ItemInput = {}): OrderDocumentSourceItem {
  const snapshot = itemSnapshot(input.snapshot, input);
  return {
    id: input.id ?? 'item-1',
    configuration: input.configuration ?? configuration([1000], { quantity: snapshot.pricing.quantity }),
    documentSnapshot: 'documentSnapshot' in input ? input.documentSnapshot : snapshot,
    quantity: snapshot.pricing.quantity,
    unitNetPrice: decimal(snapshot.pricing.unitPrice),
    totalNetPrice: decimal(snapshot.pricing.net),
  };
}

export function buyer(overrides: Partial<OrderBuyerSnapshot> = {}): OrderBuyerSnapshot {
  return {
    version: 1,
    type: 'INDIVIDUAL',
    fullName: 'Айгуль Тестова',
    phone: '+77001234567',
    email: 'aigul@example.com',
    city: 'Алматы',
    ...overrides,
  };
}

/** A consistent order: every total column is the sum of its items. */
export function orderSource(
  overrides: Partial<Omit<OrderDocumentSource, 'buyerSnapshot'>> & {
    buyer?: Partial<OrderBuyerSnapshot>;
    /** Raw column value, bypassing the generated buyer snapshot. */
    buyerSnapshot?: unknown;
  } = {},
): OrderDocumentSource {
  const { buyer: buyerOverrides, buyerSnapshot, ...rest } = overrides;
  const items = rest.items ?? [item()];
  const sum = (pick: (p: OrderItemPricingSnapshot) => string) =>
    items.reduce((acc, i) => {
      const snap = i.documentSnapshot as OrderItemDocumentSnapshot | null;
      return acc + (snap?.pricing ? tiyn(pick(snap.pricing)) : 0);
    }, 0);
  const net = items.reduce((acc, i) => acc + asTiyn(i.totalNetPrice), 0);
  const hasSnapshots = items.every((i) => i.documentSnapshot);
  const vat = hasSnapshots ? sum((p) => p.vat) : Math.round((net * 16) / 100 / 100) * 100;
  return {
    id: 'order-doc-1',
    orderNumber: 'MS-20260830-4HB57',
    createdAt: new Date('2026-08-30T08:15:00.000Z'),
    paymentPreference: 'BANK_TRANSFER',
    delivery: { methodId: null, address: null, city: null, floor: null, hasLift: null, date: null },
    netTotal: decimal(money(net)),
    vatTotal: decimal(money(vat)),
    discountTotal: decimal(money(hasSnapshots ? sum((p) => p.discount) : 0)),
    grandTotal: decimal(money(net + vat)),
    ...rest,
    buyerSnapshot: 'buyerSnapshot' in overrides ? buyerSnapshot : buyer(buyerOverrides),
    items,
  };
}

/** A persisted issuance — first opened 13 Sep 2026, two weeks after the order. */
export function issuance(number = 'KP-MS-20260830-4HB57', overrides: Partial<DocumentIssuance> = {}): DocumentIssuance {
  return {
    number,
    issuedAt: new Date('2026-09-13T06:30:00.000Z'),
    brandName: 'MS Стеллажи',
    seller: {},
    ...overrides,
  };
}
