import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_CACHE_TTL_MS, findComponent, getCatalog, resetCatalogCache } from '@/lib/data/repository';
import { COMPONENTS } from '@/lib/data/seed-data';
import { calculatePrice } from '@/lib/pricing';
import { clearMemoryOrders, generateOrderNumber, getOrderByNumber, saveOrder } from '@/lib/orders/store';
import type { OrderRecord } from '@/lib/orders/types';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Proves the exact acceptance scenario from the production-database task:
 * a changed *current* component price must be picked up by new pricing
 * calculations after the catalog cache refreshes, while an order saved
 * before the change keeps its original persisted total forever. The
 * component price is mutated directly on the seed-data source (the
 * in-memory stand-in for "someone updated a row in Postgres") rather than
 * on a fetched catalog snapshot, because buildMockCatalog() now clones on
 * every rebuild specifically so this kind of test is meaningful.
 */

function testConfig(): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
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

afterEach(() => {
  resetCatalogCache();
  clearMemoryOrders();
  vi.useRealTimers();
});

describe('catalog cache + historical order immutability', () => {
  it('a current-price change is invisible until the cache is invalidated, a new order picks it up, and the old order keeps its original price', async () => {
    resetCatalogCache();
    const catalogBefore = await getCatalog();
    const config = testConfig();

    const priceA = calculatePrice(config, catalogBefore);
    expect(priceA.ok).toBe(true);
    if (!priceA.ok) return;

    // Save an order exactly as /api/orders would, using price A.
    const order: OrderRecord = {
      id: crypto.randomUUID(),
      orderNumber: generateOrderNumber(),
      status: 'NEW',
      customer: { fullName: 'Тест Тестов', phone: '+77001234567', city: 'Алматы', type: 'INDIVIDUAL' },
      paymentPreference: 'BANK_TRANSFER',
      items: [{ configuration: priceA.configuration, bom: priceA.bom, breakdown: priceA.breakdown, modelName: 'MS Стандарт' }],
      netTotal: priceA.breakdown.net,
      vatTotal: priceA.breakdown.vat,
      discountTotal: priceA.breakdown.discount,
      grandTotal: priceA.breakdown.total,
      createdAt: new Date().toISOString(),
    };
    await saveOrder(order);

    // Locate the exact SHELF component this configuration's BOM resolves to,
    // then change its *current* selling price directly on the seed-data
    // source — the stand-in for "an admin edited this row in Postgres".
    const usedComponent = findComponent(catalogBefore, {
      type: 'SHELF',
      width: 1000,
      depth: 400,
      shelfType: 'STANDARD',
      modelSlug: 'ms-standard',
    });
    expect(usedComponent).toBeDefined();
    const sourceComponent = COMPONENTS.find((c) => c.sku === usedComponent!.sku);
    expect(sourceComponent).toBeDefined();
    const originalPrice = sourceComponent!.sellingPrice;

    try {
      sourceComponent!.sellingPrice = originalPrice + 5_000;

      // Cache not yet invalidated — a new pricing calculation still sees
      // price A, proving the TTL genuinely defers visibility.
      const stillCached = await getCatalog();
      const stillPriceA = calculatePrice(config, stillCached);
      expect(stillPriceA.ok).toBe(true);
      if (stillPriceA.ok) expect(stillPriceA.breakdown.total).toBe(priceA.breakdown.total);

      // Explicit, deterministic test-only invalidation — no sleep.
      resetCatalogCache();
      const catalogAfter = await getCatalog();
      const priceB = calculatePrice(config, catalogAfter);
      expect(priceB.ok).toBe(true);
      if (!priceB.ok) return;
      expect(priceB.breakdown.total).toBeGreaterThan(priceA.breakdown.total);

      // The already-saved order is completely unaffected by the price change.
      const savedOrder = await getOrderByNumber(order.orderNumber);
      expect(savedOrder).toBeDefined();
      expect(savedOrder!.grandTotal).toBe(priceA.breakdown.total);
      expect(savedOrder!.items[0].breakdown.total).toBe(priceA.breakdown.total);
    } finally {
      sourceComponent!.sellingPrice = originalPrice;
    }
  });

  it('the catalog cache also refreshes on its own once the TTL elapses, with no explicit invalidation call', async () => {
    vi.useFakeTimers();
    try {
      resetCatalogCache();
      const catalog1 = await getCatalog();
      const catalog2 = await getCatalog();
      // Same TTL window: the cache returns the identical snapshot, not a
      // fresh rebuild, for calls made before it expires.
      expect(catalog2).toBe(catalog1);

      vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS + 1);

      const catalog3 = await getCatalog();
      expect(catalog3).not.toBe(catalog1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('concurrent getCatalog() calls during a cache miss share a single rebuild', async () => {
    resetCatalogCache();
    const [a, b, c] = await Promise.all([getCatalog(), getCatalog(), getCatalog()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
