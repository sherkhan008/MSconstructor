import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { buildOrderDocument, buildOrderDocumentContent } from '@/lib/documents/build';
import { toTiyn } from '@/lib/documents/money';
import type { OrderDocumentSource } from '@/lib/documents/order-source';
import {
  createOrderBuyerSnapshot,
  createOrderItemDocumentSnapshot,
  parseOrderBuyerSnapshot,
  parseOrderItemDocumentSnapshot,
} from '@/lib/documents/snapshots';
import { calculatePrice } from '@/lib/pricing';
import { toPublicBom } from '@/lib/pricing/bom';
import { clearMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { decimal, issuance } from './helpers/order-document-fixtures';

/**
 * Order-time snapshots, produced by the real pricing engine and the real
 * checkout route — the data every commercial document is printed from.
 */

function shelving(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
    sections: [
      { id: 's-1', width: 1000, rearWall: true, leftWall: false, rightWall: false },
      { id: 's-2', width: 700, rearWall: false, leftWall: false, rightWall: false },
    ],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [{ accessoryId: 'acc-extra-shelf', quantity: 2 }],
    assemblyId: 'assembly-professional',
    deliveryId: 'delivery-pickup',
    quantity: 3,
    metalFootPad: true,
    ...overrides,
  };
}

async function freshCatalog(): Promise<Catalog> {
  resetCatalogCache();
  return structuredClone(await getCatalog());
}

/** Prices each configuration against `catalog` and persists it the way
 * POST /api/orders + saveOrderToDb do (JSON round trip included). */
function placeOrder(catalog: Catalog, configurations: ShelvingConfiguration[]): OrderDocumentSource {
  const items = configurations.map((configuration, i) => {
    const priced = calculatePrice(configuration, catalog);
    if (!priced.ok) throw new Error(`must price: ${priced.message}`);
    const snapshot = createOrderItemDocumentSnapshot(
      { configuration: priced.configuration, bom: priced.bom, breakdown: priced.breakdown, pricesIncludeVat: catalog.pricingSettings.pricesIncludeVat },
      catalog,
    );
    return { priced, item: {
      id: `item-${i}`,
      configuration: priced.configuration,
      documentSnapshot: JSON.parse(JSON.stringify(snapshot)),
      quantity: priced.configuration.quantity,
      unitNetPrice: decimal(priced.breakdown.unitNet),
      totalNetPrice: decimal(priced.breakdown.net),
    } };
  });
  const total = (pick: (b: (typeof items)[number]['priced']['breakdown']) => number) =>
    items.reduce((sum, { priced }) => sum + pick(priced.breakdown), 0);
  return {
    id: 'order-1',
    orderNumber: 'MS-20260913-TEST1',
    createdAt: new Date('2026-09-13T05:00:00.000Z'),
    paymentPreference: 'BANK_TRANSFER',
    delivery: { methodId: null, address: 'ул. Абая, 1', city: null, floor: null, hasLift: null, date: null },
    netTotal: decimal(total((b) => b.net)),
    vatTotal: decimal(total((b) => b.vat)),
    discountTotal: decimal(total((b) => b.discount)),
    grandTotal: decimal(total((b) => b.total)),
    buyerSnapshot: JSON.parse(JSON.stringify(createOrderBuyerSnapshot({ type: 'INDIVIDUAL', fullName: 'Тест Тестов', phone: '+77001234567', city: 'Алматы' }))),
    items: items.map(({ item }) => item),
  };
}

describe('item snapshot from the real pricing engine', () => {
  it('stores the engine breakdown verbatim and the order-time labels', async () => {
    const catalog = await freshCatalog();
    const priced = calculatePrice(shelving(), catalog);
    if (!priced.ok) throw new Error(priced.message);
    const b = priced.breakdown;
    const snapshot = createOrderItemDocumentSnapshot(
      { configuration: priced.configuration, bom: priced.bom, breakdown: b, pricesIncludeVat: false },
      catalog,
    );

    expect(snapshot).toMatchObject({
      version: 1,
      modelName: 'MS Стандарт',
      colorName: 'Стандартный серый',
      assemblyName: 'Профессиональная сборка',
      deliveryName: 'Самовывоз со склада',
      options: ['Металлический подпятник'],
      pricing: {
        pricesIncludeVat: false,
        vatPercent: 16,
        quantity: 3,
        unitPrice: b.unitNet.toFixed(2),
        goodsAmount: b.itemsNet.toFixed(2),
        assembly: b.assembly.toFixed(2),
        delivery: '0.00',
        discount: b.discount.toFixed(2),
        net: b.net.toFixed(2),
        vat: b.vat.toFixed(2),
        total: b.total.toFixed(2),
      },
    });
    expect(parseOrderItemDocumentSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('keeps the MS Standard public BOM boundary: beams, frame ties and connectors are never in the kit', async () => {
    const catalog = await freshCatalog();
    const priced = calculatePrice(shelving(), catalog);
    if (!priced.ok) throw new Error(priced.message);
    const snapshot = createOrderItemDocumentSnapshot(
      { configuration: priced.configuration, bom: priced.bom, breakdown: priced.breakdown, pricesIncludeVat: false },
      catalog,
    );
    const publicLines = toPublicBom(priced.bom, 'ms-standard');
    expect(snapshot.kit).toEqual(publicLines.map((l) => ({ name: l.name, quantity: l.quantity })));

    const hiddenTypes = new Set(['BEAM_DEPTH', 'BEAM_LONGITUDINAL', 'TIE', 'CONNECTOR']);
    const hiddenNames = priced.bom.filter((l) => hiddenTypes.has(l.type)).map((l) => l.name);
    expect(hiddenNames.length).toBeGreaterThan(0);
    for (const name of hiddenNames) {
      expect(snapshot.kit.some((line) => line.name === name), `hidden part "${name}" in kit`).toBe(false);
    }
  });

  it('contains no cost, SKU, component price, supplier or markup data', async () => {
    const catalog = await freshCatalog();
    const priced = calculatePrice(shelving(), catalog);
    if (!priced.ok) throw new Error(priced.message);
    const json = JSON.stringify(
      createOrderItemDocumentSnapshot(
        { configuration: priced.configuration, bom: priced.bom, breakdown: priced.breakdown, pricesIncludeVat: false },
        catalog,
      ),
    );
    for (const forbidden of ['sku', 'unitCost', 'purchasePrice', 'supplier', 'markup', 'componentsSubtotal', 'colorSurcharge', 'componentId', 'weightKg', 'totalPrice']) {
      expect(json, `snapshot contains "${forbidden}"`).not.toContain(forbidden);
    }
    for (const line of priced.bom) {
      expect(json).not.toContain(`"${line.sku}"`);
    }
    expect(json).not.toContain(String(priced.breakdown.markup));
  });
});

describe('documents from real orders reconcile under both VAT rules', () => {
  const configurations = () => [
    shelving(),
    shelving({ sections: [{ id: 'x', width: 1000, rearWall: false, leftWall: false, rightWall: false }], quantity: 1, assemblyId: 'assembly-full-install', accessories: [], metalFootPad: false }),
  ];

  for (const pricesIncludeVat of [false, true]) {
    it(`${pricesIncludeVat ? 'VAT-inclusive' : 'VAT-exclusive'} catalog: every row is quantity × price, rows − discount = total, totals match the order`, async () => {
      const catalog = await freshCatalog();
      catalog.pricingSettings.pricesIncludeVat = pricesIncludeVat;
      const source = placeOrder(catalog, configurations());

      const content = buildOrderDocumentContent(source);
      expect(content.totals.pricesIncludeVat).toBe(pricesIncludeVat);
      expect(content.lines.map((l) => l.kind)).toEqual(['goods', 'assembly', 'goods', 'assembly']);
      for (const line of content.lines) expect(line.unitPrice * BigInt(line.quantity)).toBe(line.amount);

      const t = content.totals;
      expect(t.lines - t.discount).toBe(pricesIncludeVat ? t.grand : t.net);
      expect(t.net + t.vat).toBe(t.grand);
      expect(t.grand).toBe(toTiyn(source.grandTotal));
      expect(t.net).toBe(toTiyn(source.netTotal));
      expect(t.vat).toBe(toTiyn(source.vatTotal));
      expect(t.discount).toBe(toTiyn(source.discountTotal));
      expect(t.vat).toBeGreaterThan(0n);

      // Rows never mix bases: with VAT-inclusive prices, the first item's rows
      // add up to its VAT-inclusive total, not to its VAT-exclusive net.
      const firstItemRows = content.lines.slice(0, 2).reduce((sum, l) => sum + l.amount, 0n);
      const firstPricing = (source.items[0].documentSnapshot as { pricing: { discount: string; net: string; total: string } }).pricing;
      expect(firstItemRows - toTiyn(firstPricing.discount)).toBe(toTiyn(pricesIncludeVat ? firstPricing.total : firstPricing.net));

      // And the rendered documents build without integrity errors.
      for (const kind of ['commercial-proposal', 'invoice'] as const) {
        expect(() => buildOrderDocument(kind, content, issuance())).not.toThrow();
      }
    });
  }
});

describe('buyer snapshot', () => {
  it('is trimmed, versioned, and drops a company name for an individual', () => {
    expect(createOrderBuyerSnapshot({ type: 'INDIVIDUAL', fullName: '  Тест  ', phone: '+77001234567', companyName: 'ТОО «Лишнее»', email: ' ', city: 'Алматы' })).toEqual({
      version: 1,
      type: 'INDIVIDUAL',
      fullName: 'Тест',
      phone: '+77001234567',
      whatsapp: undefined,
      email: undefined,
      city: 'Алматы',
      companyName: undefined,
      binIin: undefined,
    });
  });

  it('parses only snapshots this application wrote; unknown keys are dropped', () => {
    const stored = JSON.parse(JSON.stringify(createOrderBuyerSnapshot({ type: 'LEGAL_ENTITY', fullName: 'Иван', phone: '+77001234567', companyName: 'ТОО «А»', binIin: '123456789012' })));
    expect(parseOrderBuyerSnapshot(stored)).toEqual(stored);
    expect(parseOrderBuyerSnapshot({ ...stored, internalNotes: 'x' })).not.toHaveProperty('internalNotes');
    expect(parseOrderBuyerSnapshot({ ...stored, version: undefined })).toBeNull();
    expect(parseOrderBuyerSnapshot({ ...stored, type: 'ADMIN' })).toBeNull();
    expect(parseOrderBuyerSnapshot({ ...stored, fullName: '' })).toBeNull();
    expect(parseOrderBuyerSnapshot(null)).toBeNull();
    expect(parseOrderBuyerSnapshot('Иван')).toBeNull();
  });
});

describe('POST /api/orders writes both snapshots', () => {
  beforeEach(() => clearMemoryOrders());

  let ip = 0;
  const post = (body: Record<string, unknown>) =>
    POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.0.${(ip += 1)}` },
        body: JSON.stringify(body),
      }),
    );

  const body = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Иван Первый',
    phone: '+77001112233',
    email: 'first@example.com',
    city: 'Алматы',
    customerType: 'LEGAL_ENTITY',
    companyName: 'ТОО «Первое»',
    binIin: '123456789012',
    paymentPreference: 'BANK_INVOICE',
    items: [{ configuration: shelving() }],
    ...overrides,
  });

  it('the saved order carries its own buyer snapshot and an item snapshot that reconciles', async () => {
    const response = await post(body());
    expect(response.status).toBe(201);
    const { orderNumber } = await response.json();
    const saved = await getOrderByNumber(orderNumber);

    expect(saved?.buyerSnapshot).toEqual(
      expect.objectContaining({ version: 1, type: 'LEGAL_ENTITY', fullName: 'Иван Первый', companyName: 'ТОО «Первое»', binIin: '123456789012', email: 'first@example.com' }),
    );
    const snapshot = saved!.items[0].documentSnapshot!;
    expect(snapshot.pricing.net).toBe(saved!.items[0].breakdown.net.toFixed(2));
    expect(snapshot.pricing.total).toBe(saved!.grandTotal.toFixed(2));
  });

  it('a later order from the same customer with changed details does not alter the earlier order\'s snapshot', async () => {
    const first = await (await post(body())).json();
    const before = structuredClone((await getOrderByNumber(first.orderNumber))!.buyerSnapshot);

    const second = await post(body({ fullName: 'Иван Переименованный', companyName: 'ТОО «Второе»', email: 'second@example.com' }));
    expect(second.status).toBe(201);

    const after = (await getOrderByNumber(first.orderNumber))!.buyerSnapshot;
    expect(after).toEqual(before);
    expect(after?.fullName).toBe('Иван Первый');
  });
});
