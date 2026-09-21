import { afterEach, expect, it, vi } from 'vitest';
import { ASSEMBLY_SERVICES, DELIVERY_METHODS, MODELS } from '@/lib/data/seed-data';

/**
 * scripts/sync-public-copy.ts — regional TRANSPORT_COMPANY delivery is
 * individually calculated, so a stored basePrice of exactly 0 becomes NULL.
 * Nothing else about delivery prices may change, and a repeat run is a no-op.
 */

afterEach(() => { vi.doUnmock('@prisma/client'); vi.restoreAllMocks(); });

type DeliveryRow = { id: string; kind: string; descriptionRu: string; descriptionKk: string; basePrice: number | null };

it('seed data stores the TRANSPORT_COMPANY price as NULL (calculated individually)', () => {
  const transport = DELIVERY_METHODS.filter((m) => m.kind === 'TRANSPORT_COMPANY');
  expect(transport).toHaveLength(1);
  expect(transport[0].basePrice).toBeNull();
});

it('turns only an exact TRANSPORT_COMPANY 0 into NULL, leaves manual and other prices alone, and a second run changes nothing', async () => {
  const current = (kind: string) => DELIVERY_METHODS.find((m) => m.kind === kind)!.description;
  const delivery: DeliveryRow[] = [
    { id: 'delivery-pickup', kind: 'PICKUP', basePrice: 0 },
    { id: 'delivery-city', kind: 'CITY', basePrice: 0 },
    { id: 'delivery-country', kind: 'COUNTRY', basePrice: 0 }, // zero, but not TRANSPORT_COMPANY
    { id: 'delivery-transport-company', kind: 'TRANSPORT_COMPANY', basePrice: 0 }, // the one to fix
    { id: 'delivery-transport-manual', kind: 'TRANSPORT_COMPANY', basePrice: 15000 }, // set by a person
    { id: 'delivery-transport-null', kind: 'TRANSPORT_COMPANY', basePrice: null },
    { id: 'delivery-individual', kind: 'INDIVIDUAL', basePrice: null },
  ].map((r) => ({ ...r, descriptionRu: current(r.kind).ru, descriptionKk: current(r.kind).kk }));

  const update = vi.fn();
  const updateMany = vi.fn(async ({ where, data }: { where: { kind: string; basePrice: number }; data: { basePrice: null } }) => {
    const matched = delivery.filter((r) => r.kind === where.kind && r.basePrice === where.basePrice);
    for (const r of matched) Object.assign(r, data);
    return { count: matched.length };
  });
  const disconnect = vi.fn(async () => {});
  // Only these delegates exist: any product, component, supplier, order or delete access fails the test.
  vi.doMock('@prisma/client', () => ({ PrismaClient: class {
    deliveryMethod = { findMany: async ({ where }: { where: { kind: string } }) => delivery.filter((r) => r.kind === where.kind).map((r) => ({ ...r })), update, updateMany };
    assemblyService = {
      findMany: async ({ where }: { where: { method: string } }) =>
        ASSEMBLY_SERVICES.filter((s) => s.method === where.method).map((s) => ({ id: s.id, descriptionRu: s.description.ru, descriptionKk: s.description.kk })),
      update,
    };
    productModel = { findUnique: async ({ where }: { where: { slug: string } }) => { const m = MODELS.find((x) => x.slug === where.slug); return m && { id: m.id, seoDescription: m.seo.description }; }, update };
    $disconnect = disconnect;
  } }));
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  async function run() {
    const count = disconnect.mock.calls.length;
    info.mockClear();
    vi.resetModules();
    await import('../../scripts/sync-public-copy');
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(count + 1));
    expect(errors).not.toHaveBeenCalled();
    return info.mock.calls.map((c) => String(c[0]));
  }

  const first = await run();
  expect(updateMany).toHaveBeenCalledTimes(1);
  expect(updateMany).toHaveBeenCalledWith({ where: { kind: 'TRANSPORT_COMPANY', basePrice: 0 }, data: { basePrice: null } });
  await expect(updateMany.mock.results[0].value).resolves.toEqual({ count: 1 });
  expect(first).toContain('[update] deliveryMethod TRANSPORT_COMPANY: basePrice 0 → NULL on 1 row(s)');
  expect(first.at(-1)).toContain('updated 1 row(s)');
  expect(update).not.toHaveBeenCalled();
  expect(Object.fromEntries(delivery.map((r) => [r.id, r.basePrice]))).toEqual({
    'delivery-pickup': 0,
    'delivery-city': 0,
    'delivery-country': 0,
    'delivery-transport-company': null,
    'delivery-transport-manual': 15000,
    'delivery-transport-null': null,
    'delivery-individual': null,
  });

  const second = await run();
  await expect(updateMany.mock.results[1].value).resolves.toEqual({ count: 0 });
  expect(second).toHaveLength(1);
  expect(second[0]).toContain('updated 0 row(s)');
  expect(update).not.toHaveBeenCalled();
  expect(delivery.find((r) => r.id === 'delivery-transport-manual')!.basePrice).toBe(15000);
});
