import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves the production-database-required boundary from src/lib/env.ts:
 * development/test may fall back to the in-memory sample catalog/orders,
 * production runtime never may. Each test mutates process.env then forces a
 * fresh module graph via vi.resetModules() + dynamic import, since env.ts
 * reads process.env once at import time.
 */

const ORIGINAL_ENV = { ...process.env };

function resetProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  resetProcessEnv();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('@/lib/data/db-repository');
  vi.doUnmock('@/lib/orders/db-store');
});

describe('development/test fall back to in-memory data with no error', () => {
  it('development with no DATABASE_URL serves the mock catalog', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { getCatalog } = await import('@/lib/data/repository');
    const catalog = await getCatalog();
    expect(catalog.models.length).toBeGreaterThan(0);
  });

  it('test env with no DATABASE_URL serves the mock catalog', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { getCatalog } = await import('@/lib/data/repository');
    await expect(getCatalog()).resolves.toBeDefined();
  });

  it('development with no DATABASE_URL still saves/reads orders in memory', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { saveOrder, getOrderByNumber } = await import('@/lib/orders/store');
    const order = { orderNumber: 'MS-TEST-DEV-1', grandTotal: 1 } as never;
    await saveOrder(order);
    await expect(getOrderByNumber('MS-TEST-DEV-1')).resolves.toBeDefined();
  });
});

describe('production runtime requires a real PostgreSQL DATABASE_URL', () => {
  it('production with no DATABASE_URL fails clearly instead of using the mock catalog', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { getCatalog } = await import('@/lib/data/repository');
    await expect(getCatalog()).rejects.toThrow(/DATABASE_URL is required in production/);
  });

  it('production with no DATABASE_URL fails clearly instead of saving orders in memory', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { saveOrder, getOrderByNumber } = await import('@/lib/orders/store');
    await expect(saveOrder({} as never)).rejects.toThrow(/DATABASE_URL is required in production/);
    await expect(getOrderByNumber('MS-ANY')).rejects.toThrow(/DATABASE_URL is required in production/);
  });

  it('production with a non-PostgreSQL DATABASE_URL fails clearly', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'mysql://user:pass@host:3306/db';
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { getCatalog } = await import('@/lib/data/repository');
    await expect(getCatalog()).rejects.toThrow(/PostgreSQL connection string/);
  });

  it('error messages never include the connection string value', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'mysql://super-secret-user:super-secret-password@host:3306/db';
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { getCatalog } = await import('@/lib/data/repository');
    try {
      await getCatalog();
      throw new Error('expected getCatalog() to reject');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret-user');
      expect(message).not.toContain('super-secret-password');
    }
  });

  // The production image is built with no database (Dockerfile). A catalog
  // read during `next build` must fail loudly — never query PostgreSQL and
  // never quietly substitute the sample catalog for prerendered HTML.
  it('a next build (NEXT_PHASE=phase-production-build) never reads the catalog, even with a PostgreSQL DATABASE_URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_PHASE = 'phase-production-build';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    vi.resetModules();

    const buildDbCatalog = vi.fn();
    vi.doMock('@/lib/data/db-repository', () => ({ buildDbCatalog }));

    const { getCatalog } = await import('@/lib/data/repository');
    await expect(getCatalog()).rejects.toThrow(/must not be read during `next build`/);
    expect(buildDbCatalog).not.toHaveBeenCalled();
  });

  it('a next build with no DATABASE_URL does not fall back to the sample catalog', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_PHASE = 'phase-production-build';
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getCatalog } = await import('@/lib/data/repository');
    await expect(getCatalog()).rejects.toThrow(/must not be read during `next build`/);
  });

  it('production with a valid PostgreSQL DATABASE_URL routes catalog reads through the database-backed repository, not the mock catalog', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    delete process.env.NEXT_PHASE;
    vi.resetModules();

    const marker = { models: [{ id: 'from-db' }] };
    vi.doMock('@/lib/data/db-repository', () => ({ buildDbCatalog: vi.fn(async () => marker) }));

    const { getCatalog } = await import('@/lib/data/repository');
    const catalog = await getCatalog();
    expect(catalog).toBe(marker);
  });

  it('production with a valid PostgreSQL DATABASE_URL routes order persistence through Prisma, not the in-memory store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    delete process.env.NEXT_PHASE;
    vi.resetModules();

    const saveOrderToDb = vi.fn(async (order: unknown) => order);
    const getOrderByNumberFromDb = vi.fn(async () => undefined);
    vi.doMock('@/lib/orders/db-store', () => ({ saveOrderToDb, getOrderByNumberFromDb }));

    const { saveOrder, getOrderByNumber } = await import('@/lib/orders/store');
    const fakeOrder = { orderNumber: 'MS-TEST-DB-1' } as never;
    await saveOrder(fakeOrder);
    await getOrderByNumber('MS-TEST-DB-1');

    expect(saveOrderToDb).toHaveBeenCalledWith(fakeOrder);
    expect(getOrderByNumberFromDb).toHaveBeenCalledWith('MS-TEST-DB-1');
  });
});
