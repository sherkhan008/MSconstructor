import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as ordersPost } from '@/app/api/orders/route';
import { clearMemoryOrders, countMemoryOrders } from '@/lib/orders/store';
import { parseConfiguration } from '@/lib/pricing/schema';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { CATALOG_PRODUCTS } from '@/lib/data/seed-data';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Configurator V2.2A moved height/shelves from the configuration onto every
 * section WITHOUT any commercial change. These tests pin that down:
 *
 *  1. Golden regression — tests/fixtures/pricing-golden-v2.1.json was
 *     captured from the V2.1 engine (commit 05968fe) BEFORE the migration:
 *     73 representative configurations (every height × min/max shelves,
 *     every width × depth, multi-section rows, walls, accessories, quantity,
 *     assembly, delivery, colours, promo, price level, other models, every
 *     catalog product, and the expected failures). Each V2.1 input is
 *     converted to the V2 shape by copying its row-level height/shelves into
 *     every section; the V2.2A outcome must equal the V2.1 outcome exactly —
 *     every breakdown amount, every BOM line, weight, lead time, warnings.
 *     Every amount in the fixture is reproducible from the committed
 *     src/lib/data/seed-data.ts (no purchase cost, no private supplier
 *     data); like the other pricing tests, it expects the test database to
 *     hold that seeded catalog.
 *
 *  2. (Removed in V2.2B.) V2.2A refused a configuration whose sections
 *     differ in height or shelf count, because the BOM still shared uprights
 *     between neighbours. V2.2B prices every section from its own BOM with
 *     its own four uprights, so that guard is gone and mixed rows are priced
 *     — see tests/integration/pricing-v22b-per-section.test.ts.
 *
 * V2.2B deliberately changes the price of every MULTI-section row (each
 * section now carries its own uprights instead of sharing them). The fixture
 * is kept exactly as captured, as historical evidence: the golden cases V2.2B
 * does not touch — every single-section configuration and every expected
 * failure — must still equal it here, and every multi-section case is
 * compared with it line by line in pricing-v22b-per-section.test.ts, which
 * proves each difference is exactly the independent-upright change.
 */

interface GoldenCase {
  name: string;
  config: Record<string, unknown> & { height: number; shelves: number; sections: Record<string, unknown>[] };
  outcome: Record<string, unknown> & { ok: boolean };
}

const GOLDEN: GoldenCase[] = JSON.parse(readFileSync('tests/fixtures/pricing-golden-v2.1.json', 'utf8'));

/** The V2.1 → V2 shape conversion under test: row-level height/shelves copied into every section. */
function toV2(config: GoldenCase['config']): ShelvingConfiguration {
  const { height, shelves, sections, ...rest } = config;
  return { ...rest, sections: sections.map((s) => ({ ...s, height, shelves })) } as unknown as ShelvingConfiguration;
}

function outcomeOf(result: ReturnType<typeof calculatePrice>) {
  return result.ok
    ? {
        ok: true,
        breakdown: result.breakdown,
        bom: result.bom.map(({ unitCost: _unitCost, ...line }) => line),
        totalWeightKg: result.totalWeightKg,
        rowLengthMm: result.rowLengthMm,
        leadTimeDays: result.leadTimeDays,
        warnings: result.warnings,
        deliveryNote: result.deliveryNote,
      }
    : { ok: false, code: result.code, message: result.message, details: result.details ?? null };
}

/** A golden case V2.2B leaves commercially unchanged: one section, or an expected failure. */
function unchangedByV22b(golden: GoldenCase): boolean {
  return golden.config.sections.length === 1 || !golden.outcome.ok;
}

function mixed(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections: [
      { id: 'a', width: 1000, height: 1500, shelves: 4, rearWall: false, leftWall: false, rightWall: false },
      { id: 'b', width: 1000, height: 2500, shelves: 4, rearWall: false, leftWall: false, rightWall: false },
      { id: 'c', width: 1000, height: 1000, shelves: 4, rearWall: false, leftWall: false, rightWall: false },
    ],
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

describe('V2.2A — uniform configurations V2.2B does not touch price exactly as V2.1 (golden regression)', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('the golden fixture covers a representative spread and holds no purchase cost', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(70);
    expect(GOLDEN.filter((g) => g.outcome.ok).length).toBeGreaterThanOrEqual(60);
    expect(readFileSync('tests/fixtures/pricing-golden-v2.1.json', 'utf8')).not.toMatch(/unitCost|purchasePrice/);
    // Every single-section case (every height × min/max shelves, every
    // width × depth, walls, accessories, delivery, colours, products…) stays
    // pinned here; only the multi-section cases move to the V2.2B comparison.
    expect(GOLDEN.filter((g) => unchangedByV22b(g) && g.outcome.ok).length).toBeGreaterThanOrEqual(45);
  });

  it.each(GOLDEN.filter(unchangedByV22b).map((g) => [g.name, g] as const))('%s', (_name, golden) => {
    expect(outcomeOf(calculatePrice(toV2(golden.config), catalog))).toEqual(golden.outcome);
  });
});

let ipCounter = 0;
function post(handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown): Promise<Response> {
  ipCounter += 1;
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.22.0.${ipCounter}` },
      body: JSON.stringify(body),
    }),
  );
}

function orderBody(configurations: ShelvingConfiguration[]) {
  return {
    fullName: 'Тест Тестов',
    phone: '+77001234567',
    email: 'test@example.com',
    city: 'Алматы',
    customerType: 'INDIVIDUAL',
    paymentPreference: 'BANK_TRANSFER',
    items: configurations.map((configuration) => ({ configuration })),
  };
}

function uniform(): ShelvingConfiguration {
  const config = mixed();
  config.sections = config.sections.map((s) => ({ ...s, height: 2000, shelves: 5 }));
  return config;
}

describe('V2.2A — API boundaries for V2 configurations', () => {
  beforeEach(() => clearMemoryOrders());

  it('a uniform V2 order is accepted (repriced on the server)', async () => {
    const response = await post(ordersPost, '/api/orders', orderBody([uniform()]));
    expect(response.status).toBe(201);
    expect(countMemoryOrders()).toBe(1);
  });

  it('still enforces Σ quantity ≤ 5 for V2 configurations', async () => {
    const response = await post(ordersPost, '/api/orders', orderBody([{ ...uniform(), quantity: 3 }, { ...uniform(), quantity: 3 }]));
    expect(response.ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });

  it('still enforces the 5-section limit for V2 configurations', () => {
    const six = uniform();
    six.sections = Array.from({ length: 6 }, (_, i) => ({ ...six.sections[0], id: `six-${i}` }));
    expect(parseConfiguration(six).success).toBe(false);
  });
});

describe('V2.2A — order/pricing schema is the V2 shape', () => {
  it('requires height and shelves on every section', () => {
    const config = uniform();
    const { height: _h, ...noHeight } = config.sections[0];
    const { shelves: _s, ...noShelves } = config.sections[0];
    expect(parseConfiguration({ ...config, sections: [noHeight] }).success).toBe(false);
    expect(parseConfiguration({ ...config, sections: [noShelves] }).success).toBe(false);
  });

  it('an old V2.1-shaped request (row-level height/shelves only) is rejected, not reinterpreted', () => {
    const { sections, ...rest } = uniform();
    const v21 = { ...rest, height: 2000, shelves: 5, sections: sections.map(({ height: _h, shelves: _s, ...s }) => s) };
    expect(parseConfiguration(v21).success).toBe(false);
  });

  it('a parsed configuration carries no row-level height/shelves', () => {
    const parsed = parseConfiguration({ ...uniform(), height: 3000, shelves: 8 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty('height');
    expect(parsed.data).not.toHaveProperty('shelves');
  });
});

describe('V2.2A — catalog products build per-section height/shelves', () => {
  it.each(CATALOG_PRODUCTS.map((p) => [p.slug, p] as const))('%s', (_slug, product) => {
    const config = catalogProductToConfiguration(product);
    expect(config).not.toHaveProperty('height');
    expect(config).not.toHaveProperty('shelves');
    expect(config.sections).toHaveLength(Math.max(1, product.sections));
    for (const section of config.sections) {
      expect(section).toMatchObject({ width: product.width, height: product.height, shelves: product.shelves });
    }
  });
});
