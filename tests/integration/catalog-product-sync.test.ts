import { afterEach, expect, it, vi } from 'vitest';
import { CATALOG_PRODUCTS, MODELS } from '@/lib/data/seed-data';

afterEach(() => { vi.doUnmock('@prisma/client'); vi.restoreAllMocks(); });

it('creates missing listings, updates existing four-shelf listings, then performs no writes on a repeat run', async () => {
  const rows = new Map<string, Record<string, unknown>>();
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> & { slug: string } }) => { rows.set(data.slug, structuredClone(data)); });
  const update = vi.fn(async ({ where, data }: { where: { slug: string }; data: Record<string, unknown> }) => { rows.set(where.slug, { ...rows.get(where.slug), ...structuredClone(data) }); });
  const disconnect = vi.fn(async () => {});
  // Deliberately expose only these delegates: any component, supplier,
  // order, snapshot or delete access makes this test fail.
  vi.doMock('@prisma/client', () => ({ PrismaClient: class {
    productModel = { findMany: async () => MODELS.map(({ id, slug }) => ({ id, slug })) };
    product = { findUnique: async ({ where }: { where: { slug: string } }) => rows.get(where.slug) ?? null, create, update };
    $disconnect = disconnect;
  } }));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  async function run() {
    const count = disconnect.mock.calls.length;
    vi.resetModules();
    await import('../../scripts/sync-catalog-products');
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(count + 1));
    expect(errors).not.toHaveBeenCalled();
  }
  await run();
  expect(create).toHaveBeenCalledTimes(CATALOG_PRODUCTS.length);
  expect(update).not.toHaveBeenCalled();
  const popular = CATALOG_PRODUCTS.filter(p => p.modelSlug === 'ms-standard' && p.featured).sort((a, b) => b.popularity - a.popularity).slice(0, 3);
  for (const product of popular) rows.get(product.slug)!.shelves = 5;
  await run();
  expect(update).toHaveBeenCalledTimes(3);
  for (const product of popular) expect(rows.get(product.slug)!.shelves).toBe(4);
  await run();
  expect(create).toHaveBeenCalledTimes(CATALOG_PRODUCTS.length);
  expect(update).toHaveBeenCalledTimes(3);
});

