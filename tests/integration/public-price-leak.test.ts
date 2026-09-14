import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { POST as ordersPost } from '@/app/api/orders/route';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { buildBom, calculatePrice, stripBomCosts, toPublicBom } from '@/lib/pricing';
import { clearMemoryOrders } from '@/lib/orders/store';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Adding an admin endpoint that deliberately returns purchasePrice makes the
 * customer-facing boundary worth re-proving end-to-end: these tests read the
 * **serialized responses** customers actually receive, not just the projection
 * helpers (that layer is covered by tests/unit/public-catalog.test.ts).
 *
 * Two independent checks run over every response:
 *   1. no forbidden key appears anywhere in the JSON, at any depth;
 *   2. no forbidden *value* appears either — so renaming `purchasePrice` to
 *      something innocuous would still fail.
 */

const FORBIDDEN_KEYS = [
  'purchasePrice',
  'unitCost',
  'supplierRef',
  'costSubtotal',
  'margin',
  'marginPercent',
  'minMarginPercent',
  'markupPercent',
  'markupFixed',
  // Model markup amount and the pre-markup amounts it can be derived from
  // (tests/integration/public-commercial-boundary.test.ts has the full matrix).
  'markup',
  'componentsSubtotal',
  'colorSurcharge',
];

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found);
    }
  }
  return found;
}

function expectNoForbiddenKeys(payload: unknown, label: string) {
  const keys = collectKeys(payload);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.has(forbidden), `${label} leaks "${forbidden}"`).toBe(false);
  }
}

function testConfig(): ShelvingConfiguration {
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
  };
}

let catalog: Catalog;

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
});

describe('POST /api/pricing/calculate — the configurator/cart price endpoint', () => {
  it('returns no purchase cost, supplier reference or margin field', async () => {
    const request = new NextRequest('http://localhost/api/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.11' },
      body: JSON.stringify(testConfig()),
    });
    const response = await pricingPost(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.bom.length).toBeGreaterThan(0);
    expectNoForbiddenKeys(json, '/api/pricing/calculate');
  });

  it('leaks no purchase price even as a bare number under another name', async () => {
    const request = new NextRequest('http://localhost/api/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.12' },
      body: JSON.stringify(testConfig()),
    });
    const response = await pricingPost(request);
    const json = await response.json();

    // The internal BOM for this exact configuration knows the real costs;
    // none of those numbers may appear anywhere in the public payload.
    const internal = buildBom(testConfig(), catalog);
    const costs = internal.lines
      .map((line) => line.unitCost)
      .filter((cost): cost is number => typeof cost === 'number' && cost > 0);
    expect(costs.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(json);
    for (const cost of new Set(costs)) {
      expect(serialized.includes(`:${cost}`), `response contains the cost ${cost}`).toBe(false);
    }
  });
});

describe('public catalog shipped to the browser', () => {
  it('contains no forbidden key at any depth', () => {
    const publicCatalog = toPublicCatalog(catalog);
    expect(publicCatalog.accessories.length).toBeGreaterThan(0);
    expectNoForbiddenKeys(publicCatalog, 'public catalog');
  });

  it('carries no accessory purchase price value', () => {
    const publicCatalog = toPublicCatalog(catalog);
    const serialized = JSON.stringify(publicCatalog);
    const purchasePrices = catalog.accessories
      .map((accessory) => accessory.purchasePrice)
      .filter((price) => price > 0);
    expect(purchasePrices.length).toBeGreaterThan(0);
    for (const price of new Set(purchasePrices)) {
      expect(serialized.includes(`"purchasePrice":${price}`)).toBe(false);
    }
  });
});

describe('public BOM projections', () => {
  it('toPublicBom strips unitCost from every customer-visible line', () => {
    const internal = buildBom(testConfig(), catalog);
    expect(internal.lines.some((line) => typeof line.unitCost === 'number')).toBe(true);

    const publicLines = toPublicBom(internal.lines, 'ms-standard');
    expect(publicLines.length).toBeGreaterThan(0);
    expectNoForbiddenKeys(publicLines, 'toPublicBom');
  });

  it('stripBomCosts strips unitCost from every line', () => {
    const internal = buildBom(testConfig(), catalog);
    expectNoForbiddenKeys(stripBomCosts(internal.lines), 'stripBomCosts');
  });

  it('the priced result the order flow persists as a customer BOM carries no cost', () => {
    const priced = calculatePrice(testConfig(), catalog);
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    expectNoForbiddenKeys(toPublicBom(priced.bom, 'ms-standard'), 'order BOM projection');
  });
});

describe('POST /api/orders — customer-facing order response', () => {
  it('returns only the order number and total, with no internal cost data', async () => {
    clearMemoryOrders();
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.21' },
      body: JSON.stringify({
        fullName: 'Тест Тестов',
        phone: '+77001234567',
        email: 'test@example.com',
        city: 'Алматы',
        customerType: 'INDIVIDUAL',
        paymentPreference: 'BANK_TRANSFER',
        items: [{ configuration: testConfig() }],
      }),
    });

    const response = await ordersPost(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(Object.keys(json).sort()).toEqual(['grandTotal', 'ok', 'orderNumber']);
    expectNoForbiddenKeys(json, '/api/orders');
    clearMemoryOrders();
  });
});
