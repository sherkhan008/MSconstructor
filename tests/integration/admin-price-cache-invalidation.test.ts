import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Catalog } from '@/lib/data/repository';
import type { OrderRecord } from '@/lib/orders/types';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * The acceptance scenario for admin price management:
 *
 *   1. the catalog is warmed with the old price,
 *   2. an admin commits a new price through the real price service,
 *   3. the service invalidates the cache,
 *   4. the very next pricing read sees the new price — with no clock
 *      advance at all, so no part of this depends on the 60s TTL,
 *   5. an order saved before the change keeps its original total forever.
 *
 * Plus the race the TTL alone cannot solve: a catalog rebuild that was
 * already reading the database when the admin committed must never win and
 * repopulate the cache with the stale price afterwards.
 *
 * DATABASE_URL is stubbed and `@/lib/data/db-repository` is replaced with a
 * tiny fake "database" so the real caching code path (hasDatabase === true)
 * is the one under test, without touching the real PostgreSQL catalog.
 */

const SHELF_COMPONENT_ID = 'shelf-STANDARD-1000-400';
const OLD_PRICE = 12_000;
const NEW_PRICE = 18_500;

/** The fake database every rebuild below reads from. */
const db = {
  shelfSellingPrice: OLD_PRICE,
  shelfPurchasePrice: 7_000,
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
  /** Set to a deferred promise to hold a rebuild mid-flight. */
  gate: null as null | Promise<void>,
  /** Fired once a rebuild has read its rows — lets a test line up the race. */
  onStarted: null as null | (() => void),
  buildCount: 0,
};

interface PriceSnapshot {
  selling: number;
  purchase: number;
}

async function buildFakeCatalog(snapshot: PriceSnapshot): Promise<Catalog> {
  const seed = await import('@/lib/data/seed-data');
  // Clone exactly like the real repository does, so nothing below can mutate
  // the shared seed arrays.
  const catalog = structuredClone({
    models: seed.MODELS,
    heights: seed.HEIGHTS,
    widths: seed.WIDTHS,
    depths: seed.DEPTHS,
    loadCapacities: seed.LOAD_CAPACITIES,
    components: seed.COMPONENTS,
    rules: seed.CONFIGURATION_RULES,
    accessories: seed.ACCESSORIES,
    colors: seed.COLORS,
    assemblyServices: seed.ASSEMBLY_SERVICES,
    deliveryMethods: seed.DELIVERY_METHODS,
    pricingSettings: seed.PRICING_SETTINGS,
    promoCodes: seed.PROMO_CODES,
    products: seed.CATALOG_PRODUCTS,
    useCases: seed.USE_CASES,
  }) as Catalog;

  const shelf = catalog.components.find((component) => component.id === SHELF_COMPONENT_ID);
  if (!shelf) throw new Error(`Seed data no longer contains ${SHELF_COMPONENT_ID}`);
  shelf.sellingPrice = snapshot.selling;
  shelf.purchasePrice = snapshot.purchase;
  return catalog;
}

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

/** Prisma stand-in whose component.updateMany writes to the same fake database
 * the catalog rebuild reads from. */
function prismaFake() {
  const component = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === SHELF_COMPONENT_ID
        ? {
            id: SHELF_COMPONENT_ID,
            sku: 'SHF-0001',
            nameRu: 'Полка Стандартная 1000×400',
            sellingPrice: new Prisma.Decimal(db.shelfSellingPrice.toFixed(2)),
            purchasePrice: new Prisma.Decimal(db.shelfPurchasePrice.toFixed(2)),
            updatedAt: db.updatedAt,
          }
        : null,
    ),
    updateMany: vi.fn(async ({ data }: { data: Record<string, Prisma.Decimal> }) => {
      if (data.sellingPrice) db.shelfSellingPrice = Number(data.sellingPrice);
      if (data.purchasePrice) db.shelfPurchasePrice = Number(data.purchasePrice);
      db.updatedAt = new Date(db.updatedAt.getTime() + 1_000);
      return { count: 1 };
    }),
  };
  const tx = {
    component,
    accessory: { findUnique: vi.fn(), updateMany: vi.fn() },
    priceHistory: { createMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return {
    prisma: { $transaction: vi.fn(async (cb: (c: typeof tx) => unknown) => cb(tx)), $queryRaw: vi.fn() },
    tx,
  };
}

async function loadModules() {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  delete process.env.NEXT_PHASE;

  vi.doMock('@/lib/data/db-repository', () => ({
    buildDbCatalog: vi.fn(async () => {
      db.buildCount += 1;
      // Read the rows *now*, exactly like a real SELECT: a rebuild held open
      // by `gate` must carry the values that existed when it started, not
      // whatever the admin wrote while it was waiting.
      const snapshot = { selling: db.shelfSellingPrice, purchase: db.shelfPurchasePrice };
      db.onStarted?.();
      if (db.gate) await db.gate;
      return buildFakeCatalog(snapshot);
    }),
  }));

  const fake = prismaFake();
  vi.doMock('@/lib/db/client', () => ({ prisma: fake.prisma }));

  // DATABASE_URL is stubbed above so the *catalog* takes its real cached
  // database path, which also routes order persistence through Prisma. The
  // order mapping itself is covered by tests/integration/orders-api.test.ts;
  // here it is replaced by a store that keeps a deep clone verbatim, which is
  // precisely the property under test: a saved order's numbers are read back
  // as stored and never recomputed from the current catalog.
  const savedOrders = new Map<string, OrderRecord>();
  vi.doMock('@/lib/orders/db-store', () => ({
    saveOrderToDb: vi.fn(async (order: OrderRecord) => {
      savedOrders.set(order.orderNumber, structuredClone(order));
      return order;
    }),
    getOrderByNumberFromDb: vi.fn(async (orderNumber: string) => {
      const found = savedOrders.get(orderNumber);
      return found ? structuredClone(found) : undefined;
    }),
  }));

  const repository = await import('@/lib/data/repository');
  const pricing = await import('@/lib/pricing');
  const prices = await import('@/lib/admin/prices');
  const orders = await import('@/lib/orders/store');
  return { repository, pricing, prices, orders, ...fake };
}

beforeEach(() => {
  db.shelfSellingPrice = OLD_PRICE;
  db.shelfPurchasePrice = 7_000;
  db.updatedAt = new Date('2026-09-01T10:00:00.000Z');
  db.gate = null;
  db.onStarted = null;
  db.buildCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('@/lib/data/db-repository');
  vi.doUnmock('@/lib/db/client');
  vi.doUnmock('@/lib/orders/db-store');
});

describe('an admin price change is visible to the very next pricing read', () => {
  it('needs no TTL wait: the clock never advances, yet the new price is used', async () => {
    // Freeze time for the whole test. If anything here depended on the 60s
    // TTL expiring, the assertions below could not pass.
    vi.useFakeTimers();
    const { repository, pricing, prices } = await loadModules();
    repository.resetCatalogCache();

    const warm = await repository.getCatalog();
    const before = pricing.calculatePrice(testConfig(), warm);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    // The cache really is warm: a second read is the same snapshot.
    expect(await repository.getCatalog()).toBe(warm);
    const buildsBeforeUpdate = db.buildCount;

    const result = await prices.updateEntityPrices({
      entityType: 'COMPONENT',
      id: SHELF_COMPONENT_ID,
      sellingPrice: new Prisma.Decimal(NEW_PRICE.toFixed(2)),
      actor: { id: 'admin-1', name: 'Иван Админов' },
    });
    expect(result.changed).toBe(true);

    // No timer advance anywhere between the commit and this read.
    const after = await repository.getCatalog();
    expect(db.buildCount).toBe(buildsBeforeUpdate + 1);
    expect(after).not.toBe(warm);
    expect(after.components.find((c) => c.id === SHELF_COMPONENT_ID)?.sellingPrice).toBe(NEW_PRICE);

    const repriced = pricing.calculatePrice(testConfig(), after);
    expect(repriced.ok).toBe(true);
    if (!repriced.ok) return;
    expect(repriced.breakdown.total).toBeGreaterThan(before.breakdown.total);
  });

  it('does not rebuild when the update changed nothing', async () => {
    const { repository, prices } = await loadModules();
    repository.resetCatalogCache();

    const warm = await repository.getCatalog();
    const result = await prices.updateEntityPrices({
      entityType: 'COMPONENT',
      id: SHELF_COMPONENT_ID,
      sellingPrice: new Prisma.Decimal(OLD_PRICE.toFixed(2)),
      actor: { id: 'admin-1', name: 'Иван Админов' },
    });

    expect(result.changed).toBe(false);
    expect(await repository.getCatalog()).toBe(warm);
  });
});

describe('stale in-flight rebuild race', () => {
  it('a rebuild that started before the invalidation never becomes the cache', async () => {
    const { repository } = await loadModules();
    repository.resetCatalogCache();

    // Hold rebuild #1 open while it is "reading the old rows".
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      db.onStarted = resolve;
    });

    const staleRead = repository.getCatalog();
    // Wait until the rebuild has genuinely read the old rows — getCatalog()
    // reaches the loader through a dynamic import, so it has not started yet
    // at the moment it returns its promise.
    await started;

    // The admin commits a new price and invalidates while #1 is still in flight.
    db.shelfSellingPrice = NEW_PRICE;
    repository.invalidateCatalogCache();

    // Only now does #1 finish — carrying the price it read before the change.
    db.onStarted = null;
    release();
    const staleCatalog = await staleRead;
    expect(staleCatalog.components.find((c) => c.id === SHELF_COMPONENT_ID)?.sellingPrice).toBe(OLD_PRICE);

    // The next read must NOT be served that stale snapshot.
    const fresh = await repository.getCatalog();
    expect(fresh).not.toBe(staleCatalog);
    expect(fresh.components.find((c) => c.id === SHELF_COMPONENT_ID)?.sellingPrice).toBe(NEW_PRICE);
  });

  it('still collapses concurrent misses into a single rebuild', async () => {
    const { repository } = await loadModules();
    repository.resetCatalogCache();

    const buildsBefore = db.buildCount;
    const [a, b, c] = await Promise.all([
      repository.getCatalog(),
      repository.getCatalog(),
      repository.getCatalog(),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(db.buildCount).toBe(buildsBefore + 1);
  });

  it('still expires on its own once the TTL elapses', async () => {
    vi.useFakeTimers();
    const { repository } = await loadModules();
    repository.resetCatalogCache();

    const first = await repository.getCatalog();
    expect(await repository.getCatalog()).toBe(first);

    vi.advanceTimersByTime(repository.CATALOG_CACHE_TTL_MS + 1);
    expect(await repository.getCatalog()).not.toBe(first);
  });
});

describe('historical orders are never repriced by a catalog price change', () => {
  it('a saved order keeps its exact financials after the component price moves', async () => {
    const { repository, pricing, prices, orders } = await loadModules();
    repository.resetCatalogCache();
    orders.clearMemoryOrders();

    const warm = await repository.getCatalog();
    const priced = pricing.calculatePrice(testConfig(), warm);
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;

    const order: OrderRecord = {
      id: crypto.randomUUID(),
      orderNumber: orders.generateOrderNumber(),
      status: 'NEW',
      customer: { fullName: 'Тест Тестов', phone: '+77001234567', city: 'Алматы', type: 'INDIVIDUAL' },
      paymentPreference: 'BANK_TRANSFER',
      items: [
        {
          configuration: priced.configuration,
          bom: priced.bom,
          breakdown: priced.breakdown,
          modelName: 'MS Стандарт',
        },
      ],
      netTotal: priced.breakdown.net,
      vatTotal: priced.breakdown.vat,
      discountTotal: priced.breakdown.discount,
      grandTotal: priced.breakdown.total,
      createdAt: new Date().toISOString(),
    };
    const snapshot = JSON.parse(JSON.stringify(order));
    await orders.saveOrder(order);

    await prices.updateEntityPrices({
      entityType: 'COMPONENT',
      id: SHELF_COMPONENT_ID,
      sellingPrice: new Prisma.Decimal(NEW_PRICE.toFixed(2)),
      purchasePrice: new Prisma.Decimal('9000.00'),
      actor: { id: 'admin-1', name: 'Иван Админов' },
    });

    // New calculations do pick up the new price…
    const afterCatalog = await repository.getCatalog();
    const newPricing = pricing.calculatePrice(testConfig(), afterCatalog);
    expect(newPricing.ok).toBe(true);
    if (newPricing.ok) expect(newPricing.breakdown.total).toBeGreaterThan(priced.breakdown.total);

    // …while the stored order is byte-for-byte identical.
    const saved = await orders.getOrderByNumber(order.orderNumber);
    expect(saved).toBeDefined();
    expect(JSON.parse(JSON.stringify(saved))).toEqual(snapshot);
    expect(saved!.grandTotal).toBe(priced.breakdown.total);
    expect(saved!.items[0].breakdown.total).toBe(priced.breakdown.total);

    orders.clearMemoryOrders();
  });
});
