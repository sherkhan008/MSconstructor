import { beforeAll, describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { NextRequest } from 'next/server';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { POST as ordersPost } from '@/app/api/orders/route';
import ConfiguratorPage from '@/app/configurator/page';
import CartPage from '@/app/cart/page';
import OrderPage from '@/app/order/page';
import HomePage from '@/app/page';
import CatalogPage from '@/app/catalog/page';
import ModelPage from '@/app/catalog/[model]/page';
import DeliveryPage from '@/app/delivery/page';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { calculatePrice } from '@/lib/pricing';
import { clearMemoryOrders } from '@/lib/orders/store';
import type { PriceResult, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * The commercial-data boundary for every public surface that carries prices
 * or catalog data: /api/pricing/calculate, /api/orders, the public catalog,
 * and the props public pages pass into Client Components.
 *
 * Three independent kinds of proof:
 *   1. exact key allow-lists — any new field must be added here on purpose;
 *   2. a forbidden-key scan at every depth;
 *   3. value scans — the engine's internal markup and pre-markup subtotals
 *      never appear as a number anywhere, whatever the field is called.
 * Plus: the customer amounts are exactly the engine's (no pricing change),
 * and checkout reprices on the server regardless of what the client sends.
 */

const FORBIDDEN_KEYS = [
  // model markup and how it is derived
  'markup',
  'markupPercent',
  'markupFixed',
  'defaultMarkupPercent',
  // pre-markup amounts from which the markup can be recomputed
  'componentsSubtotal',
  'colorSurcharge',
  'sellingPrice',
  'unitPrice',
  'totalPrice',
  // cost, margin, supplier
  'purchasePrice',
  'unitCost',
  'costSubtotal',
  'totalCost',
  'margin',
  'marginPercent',
  'minMarginPercent',
  'supplierRef',
  'supplier',
];

const PUBLIC_RESULT_KEYS = ['bom', 'breakdown', 'configuration', 'deliveryNote', 'leadTimeDays', 'ok', 'rowLengthMm', 'totalWeightKg', 'warnings'];
const PUBLIC_BREAKDOWN_KEYS = ['assembly', 'delivery', 'discount', 'discountReasons', 'itemsNet', 'net', 'quantity', 'total', 'unitNet', 'unitTotal', 'vat', 'vatPercent'];
const PUBLIC_KIT_LINE_KEYS = ['componentId', 'name', 'quantity', 'sku', 'type', 'weightKg'];

function collectKeys(value: unknown, found = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found, seen);
  } else {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found, seen);
    }
  }
  return found;
}

function collectNumbers(value: unknown, found = new Set<number>()): Set<number> {
  if (typeof value === 'number') found.add(value);
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, found);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) collectNumbers(child, found);
  return found;
}

function expectNoForbiddenKeys(payload: unknown, label: string) {
  const keys = collectKeys(payload);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.has(forbidden), `${label} leaks "${forbidden}"`).toBe(false);
  }
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

async function postPricing(body: unknown) {
  const response = await pricingPost(
    new NextRequest('http://localhost/api/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, json: await response.json() };
}

function config(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 500,
    shelves: 5,
    sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}

/** Representative configurations: each exercises a different price component. */
const SCENARIOS: [string, ShelvingConfiguration][] = [
  ['basic single section', config()],
  ['coloured (non-zero colour surcharge)', config({ colorId: 'color-blue' })],
  [
    'several sections, walls, accessories',
    config({
      sections: [
        { id: 'sec-1', width: 1000, rearWall: true, leftWall: true, rightWall: false },
        { id: 'sec-2', width: 1000, rearWall: true, leftWall: false, rightWall: true },
      ],
      accessories: [
        { accessoryId: 'acc-adjustable-feet', quantity: 1 },
        { accessoryId: 'acc-shelf-reinforcement', quantity: 2 },
      ],
    }),
  ],
  ['quantity > 1 with per-section assembly', config({ quantity: 3, assemblyId: 'assembly-professional' })],
  ['percent assembly and city delivery', config({ assemblyId: 'assembly-full-install', deliveryId: 'delivery-city', colorId: 'color-ral' })],
];

let catalog: Catalog;

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
});

describe('POST /api/pricing/calculate — public response boundary', () => {
  it.each(SCENARIOS)('%s: exposes only the allow-listed customer fields', async (_label, configuration) => {
    const { status, json } = await postPricing(configuration);
    expect(status, JSON.stringify(json)).toBe(200);

    expect(Object.keys(json).sort()).toEqual(PUBLIC_RESULT_KEYS);
    expect(Object.keys(json.breakdown).sort()).toEqual(PUBLIC_BREAKDOWN_KEYS);
    expect(json.bom.length).toBeGreaterThan(0);
    for (const line of json.bom) expect(Object.keys(line).sort()).toEqual(PUBLIC_KIT_LINE_KEYS);
    expectNoForbiddenKeys(json, '/api/pricing/calculate');
  });

  it.each(SCENARIOS)('%s: no internal markup, subtotal or component price appears as a value', async (_label, configuration) => {
    const internal = calculatePrice(configuration, catalog) as PriceResult;
    expect(internal.ok).toBe(true);
    // Sanity: the engine really has a markup to hide for this configuration.
    expect(internal.breakdown.markup).toBeGreaterThan(0);

    const { json } = await postPricing(configuration);
    const numbers = collectNumbers(json);

    const b = internal.breakdown;
    for (const [name, value] of [
      ['markup', b.markup],
      ['componentsSubtotal', b.componentsSubtotal],
      ['componentsSubtotal + colorSurcharge', b.componentsSubtotal + b.colorSurcharge],
      ['markup × quantity', b.markup * b.quantity],
      ['componentsSubtotal × quantity', b.componentsSubtotal * b.quantity],
    ] as const) {
      expect(numbers.has(value), `response contains ${name} (${value})`).toBe(false);
    }
    if (b.colorSurcharge > 0) expect(numbers.has(b.colorSurcharge), 'response contains colorSurcharge').toBe(false);

    // No per-line component price (their sum is the pre-markup subtotal)
    // or cost. Small values are skipped only where they coincide with a
    // legitimate public number (dimensions, quantities, weights).
    for (const line of internal.bom) {
      for (const value of [line.totalPrice, line.unitPrice, line.unitCost]) {
        if (typeof value !== 'number' || value < 1000) continue;
        expect(numbers.has(value), `response contains internal line amount ${value} (${line.sku})`).toBe(false);
      }
    }
  });

  it.each(SCENARIOS)('%s: customer amounts are exactly the engine’s (no pricing change)', async (_label, configuration) => {
    const internal = calculatePrice(configuration, catalog) as PriceResult;
    const { json } = await postPricing(configuration);
    const b = internal.breakdown;
    expect(json.breakdown).toEqual({
      unitNet: b.unitNet,
      quantity: b.quantity,
      itemsNet: b.itemsNet,
      assembly: b.assembly,
      delivery: b.delivery,
      discount: b.discount,
      discountReasons: b.discountReasons,
      net: b.net,
      vatPercent: b.vatPercent,
      vat: b.vat,
      total: b.total,
      unitTotal: b.unitTotal,
    });
    expect(json.configuration).toEqual(internal.configuration);
    expect(json.totalWeightKg).toBe(internal.totalWeightKg);
    // The kit still lists every customer position with its quantity.
    expect(json.bom.reduce((sum: number, line: { quantity: number }) => sum + line.quantity, 0)).toBeGreaterThan(0);
  });

  it('error responses carry no pricing data at all', async () => {
    const invalid = await postPricing({ modelSlug: 'ms-standard', height: -1 });
    expect(invalid.status).toBe(400);
    const incompatible = await postPricing(config({ loadCapacity: 999_999 }));
    expect(incompatible.status).toBeGreaterThanOrEqual(400);
    for (const { json } of [invalid, incompatible]) {
      expect(json.ok).toBe(false);
      for (const key of Object.keys(json)) expect(['code', 'details', 'message', 'ok']).toContain(key);
      expectNoForbiddenKeys(json, 'pricing error response');
    }
  });
});

describe('POST /api/orders — checkout reprices on the server', () => {
  it('ignores client-supplied totals, breakdowns and markup, and answers without internal data', async () => {
    clearMemoryOrders();
    const configuration = config({ colorId: 'color-blue', quantity: 2 });
    const internal = calculatePrice(configuration, catalog) as PriceResult;
    const { json: priced } = await postPricing(configuration);

    const response = await ordersPost(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({
          fullName: 'Тест Тестов',
          phone: '+77001234567',
          email: 'test@example.com',
          city: 'Алматы',
          customerType: 'INDIVIDUAL',
          paymentPreference: 'BANK_TRANSFER',
          grandTotal: 1,
          items: [
            {
              configuration,
              breakdown: { total: 1, markup: 0, componentsSubtotal: 1 },
              priceSnapshot: { breakdown: { total: 1 } },
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(Object.keys(json).sort()).toEqual(['grandTotal', 'ok', 'orderNumber']);
    expect(json.grandTotal).toBe(internal.breakdown.total);
    // What checkout charges is exactly what the configurator displayed.
    expect(json.grandTotal).toBe(priced.breakdown.total);
    expectNoForbiddenKeys(json, '/api/orders');
    clearMemoryOrders();
  });
});

describe('public catalog', () => {
  it('ships no forbidden key, and accessories carry no pre-markup unit price', () => {
    const publicCatalog = toPublicCatalog(catalog);
    expect(publicCatalog.accessories.length).toBeGreaterThan(0);
    expectNoForbiddenKeys(publicCatalog, 'public catalog');

    const serialized = JSON.stringify(publicCatalog);
    const accessoryPrices = catalog.accessories.filter((a) => a.active).map((a) => a.unitPrice).filter((p) => p >= 1000);
    expect(accessoryPrices.length).toBeGreaterThan(0);
    for (const price of new Set(accessoryPrices)) {
      expect(serialized.includes(`"unitPrice":${price}`)).toBe(false);
    }
  });
});

/** Props of every element in a Server Component's returned tree — what crosses into Client Components. */
function collectElementProps(node: unknown, out: Record<string, unknown>[] = [], seen = new Set<unknown>()): Record<string, unknown>[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) collectElementProps(child, out, seen);
    return out;
  }
  if (isValidElement(node)) {
    const props = (node as ReactElement<Record<string, unknown>>).props;
    const { children, ...rest } = props;
    out.push(rest);
    for (const value of Object.values(rest)) collectElementProps(value, out, seen);
    collectElementProps(children, out, seen);
  }
  return out;
}

describe('public pages: props passed into components', () => {
  const pages: [string, () => Promise<unknown>][] = [
    ['/', () => HomePage()],
    ['/catalog', () => CatalogPage({ searchParams: Promise.resolve({}) })],
    ['/catalog/ms-standard', () => ModelPage({ params: Promise.resolve({ model: 'ms-standard' }) })],
    ['/configurator', () => ConfiguratorPage({ searchParams: Promise.resolve({}) })],
    ['/cart', () => CartPage()],
    ['/order', () => OrderPage()],
    ['/delivery', () => DeliveryPage()],
  ];

  it.each(pages)('%s passes no internal commercial field to any component', async (_path, render) => {
    const tree = await render();
    const props = collectElementProps(tree);
    expect(props.length).toBeGreaterThan(0);
    expectNoForbiddenKeys(props, 'page props');
  });
});
