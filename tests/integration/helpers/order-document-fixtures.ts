import type { DecimalLike } from '@/lib/documents/money';
import type { OrderDocumentSource, OrderDocumentSourceItem } from '@/lib/documents/order-source';

/**
 * Persisted-order shapes for document tests, mirroring exactly what
 * saveOrderToDb() writes: configuration JSON, a cost-stripped internal BOM
 * snapshot (production parts included), Decimal-like money columns.
 */

function asNumber(value: DecimalLike): number {
  return typeof value === 'object' ? Number(value.toFixed(2)) : Number(value);
}

export function decimal(value: string | number) {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  return { toFixed: () => text };
}

export const INTERNAL_BOM = [
  { componentId: 'c-upr', sku: 'UPR-0015', type: 'UPRIGHT', name: 'Стойка 2000 мм', quantity: 4, unitPrice: 5600, totalPrice: 22400, weightKg: 24.8 },
  { componentId: 'c-bmd', sku: 'BMD-0093', type: 'BEAM_DEPTH', name: 'Балка поперечная 400 мм', quantity: 8, unitPrice: 580, totalPrice: 4640, weightKg: 6.4 },
  { componentId: 'c-tie', sku: 'TIE-0131', type: 'TIE', name: 'Стяжка рамы', quantity: 8, unitPrice: 780, totalPrice: 6240, weightKg: 4.8 },
  { componentId: 'c-bml', sku: 'BML-0200', type: 'BEAM_LONGITUDINAL', name: 'Балка продольная 1000 мм', quantity: 10, unitPrice: 900, totalPrice: 9000, weightKg: 9 },
  { componentId: 'c-shf', sku: 'SHF-0310', type: 'SHELF', name: 'Полка Стандартная 1000×400', quantity: 5, unitPrice: 4100, totalPrice: 20500, weightKg: 20 },
  { componentId: 'c-fst', sku: 'FST-0001', type: 'FASTENER', name: 'Болт с гайкой М6', quantity: 36, unitPrice: 25, totalPrice: 900, weightKg: 0.7 },
];

export function configuration(widths: number[], overrides: Record<string, unknown> = {}) {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    metalFootPad: false,
    shelfCornerBrackets: false,
    sections: widths.map((width, i) => ({ id: `sec-${i}`, width, rearWall: false, leftWall: false, rightWall: false })),
    ...overrides,
  };
}

export function item(overrides: Partial<OrderDocumentSourceItem> & { unit?: number; total?: number } = {}): OrderDocumentSourceItem {
  const unit = overrides.unit ?? 191979;
  const quantity = overrides.quantity ?? 1;
  return {
    id: overrides.id ?? 'item-1',
    configuration: overrides.configuration ?? configuration([1000]),
    bomSnapshot: overrides.bomSnapshot ?? INTERNAL_BOM,
    quantity,
    unitNetPrice: overrides.unitNetPrice ?? decimal(unit),
    totalNetPrice: overrides.totalNetPrice ?? decimal(overrides.total ?? unit * quantity),
  };
}

/** A consistent order: netTotal = Σ line totals, grandTotal = net + VAT. */
export function orderSource(
  overrides: Partial<Omit<OrderDocumentSource, 'customer'>> & {
    customer?: Partial<OrderDocumentSource['customer']>;
    vat?: number;
    discount?: number;
  } = {},
): OrderDocumentSource {
  const items = overrides.items ?? [item()];
  const net = items.reduce((sum, i) => sum + asNumber(i.totalNetPrice), 0);
  const vat = overrides.vat ?? Math.round(net * 0.16);
  return {
    id: 'order-doc-1',
    orderNumber: 'MS-20260830-4HB57',
    createdAt: new Date('2026-08-30T08:15:00.000Z'),
    paymentPreference: 'BANK_TRANSFER',
    delivery: { methodId: null, address: null, city: null, floor: null, hasLift: null, date: null },
    netTotal: decimal(net),
    vatTotal: decimal(vat),
    discountTotal: decimal(overrides.discount ?? 0),
    grandTotal: decimal(net + vat),
    ...overrides,
    customer: {
      type: 'INDIVIDUAL',
      fullName: 'Айгуль Тестова',
      phone: '+77001234567',
      email: 'aigul@example.com',
      city: 'Алматы',
      companyName: null,
      binIin: null,
      ...overrides.customer,
    },
    items,
  };
}
