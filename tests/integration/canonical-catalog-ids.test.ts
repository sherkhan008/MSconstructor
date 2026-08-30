import { beforeAll, describe, expect, it } from 'vitest';
import { ACCESSORIES, COLORS, ASSEMBLY_SERVICES, DELIVERY_METHODS } from '@/lib/data/seed-data';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { toAccessory, toAssembly, toColor, toDelivery } from '@/lib/data/db-repository';
import { calculatePrice } from '@/lib/pricing';
import { DEFAULT_CONFIGURATION } from '@/store/configurator-store';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Regression coverage for the canonical-public-ID bug: prisma/seed.ts once
 * let Prisma auto-generate cuids for ColorOption/AssemblyService/
 * DeliveryMethod/Accessory rows instead of preserving seed-data.ts's own
 * ids ("color-grey", "assembly-self", "delivery-pickup", "acc-cross-brace",
 * ...) — the browser persists exactly those literal strings, so checkout
 * failed with "недоступен" for everyone once PostgreSQL was enabled.
 *
 * A cuid never looks like "color-grey" (lowercase-and-hyphens); it looks
 * like "cmtedr4on0051o0m4p8cdmxay". A regex distinguishing the two is a
 * cheap, high-signal guard on seed-data.ts itself.
 */
const CUID_LIKE = /^c[a-z0-9]{20,}$/;

describe('A/B — seed-data.ts defines stable, non-cuid canonical public ids', () => {
  it('has the three configurator defaults', () => {
    expect(COLORS.some((c) => c.id === 'color-grey')).toBe(true);
    expect(ASSEMBLY_SERVICES.some((a) => a.id === 'assembly-self')).toBe(true);
    expect(DELIVERY_METHODS.some((d) => d.id === 'delivery-pickup')).toBe(true);
  });

  it('gives every accessory a stable, human-readable id — never cuid-shaped', () => {
    expect(ACCESSORIES.length).toBeGreaterThan(0);
    for (const a of ACCESSORIES) {
      expect(a.id, `${a.sku} (${a.name.ru})`).toMatch(/^acc-[a-z0-9-]+$/);
      expect(a.id, `${a.sku} looks like an auto-generated cuid, not a canonical id`).not.toMatch(CUID_LIKE);
    }
  });

  it('gives every color/assembly/delivery entry a non-cuid id', () => {
    for (const c of COLORS) expect(c.id).not.toMatch(CUID_LIKE);
    for (const a of ASSEMBLY_SERVICES) expect(a.id).not.toMatch(CUID_LIKE);
    for (const d of DELIVERY_METHODS) expect(d.id).not.toMatch(CUID_LIKE);
  });
});

describe('db-repository.ts mapping never regenerates an id — pure pass-through', () => {
  it('toColor/toAssembly/toDelivery/toAccessory return row.id verbatim', () => {
    const color = toColor({
      id: 'color-grey',
      nameRu: 'x',
      nameKk: 'x',
      hex: '#000',
      pricePercent: 0 as never,
      leadTimeDays: 0,
      available: true,
      sortOrder: 0,
    });
    expect(color.id).toBe('color-grey');

    const assembly = toAssembly({
      id: 'assembly-self',
      nameRu: 'x',
      nameKk: 'x',
      descriptionRu: 'x',
      descriptionKk: 'x',
      method: 'FIXED',
      value: 0 as never,
      sortOrder: 0,
      active: true,
    });
    expect(assembly.id).toBe('assembly-self');

    const delivery = toDelivery({
      id: 'delivery-pickup',
      kind: 'PICKUP',
      nameRu: 'x',
      nameKk: 'x',
      descriptionRu: 'x',
      descriptionKk: 'x',
      basePrice: 0 as never,
      requiresAddress: false,
      sortOrder: 0,
      active: true,
    });
    expect(delivery.id).toBe('delivery-pickup');

    const accessory = toAccessory({
      id: 'acc-cross-brace',
      sku: 'ACC-0005',
      slug: 'cross-brace',
      nameRu: 'x',
      nameKk: 'x',
      descriptionRu: 'x',
      descriptionKk: 'x',
      image: 'x',
      unitPrice: 0 as never,
      purchasePrice: 0 as never,
      weightKg: 0 as never,
      models: [],
      maxQuantityPerSection: null,
      inStock: true,
      sortOrder: 0,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(accessory.id).toBe('acc-cross-brace');
  });
});

describe('C/D/E — the in-memory catalog accepts canonical ids and rejects unknown ones', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('C: the default configuration (color-grey/assembly-self/delivery-pickup) prices successfully', () => {
    const result = calculatePrice(DEFAULT_CONFIGURATION, catalog);
    expect(result.ok, !result.ok ? result.message : undefined).toBe(true);
  });

  it('D: a configuration with a real accessory (acc-cross-brace) prices successfully', () => {
    const target = DEFAULT_CONFIGURATION.sections[0]; // 1000mm by default
    const config: ShelvingConfiguration = {
      ...DEFAULT_CONFIGURATION,
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }],
    };
    const result = calculatePrice(config, catalog);
    expect(result.ok, !result.ok ? result.message : undefined).toBe(true);
  });

  it('E: an unknown colorId is still rejected — this is an identity fix, not a validation weakening', () => {
    const result = calculatePrice({ ...DEFAULT_CONFIGURATION, colorId: 'nonexistent-color' }, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    expect(result.message).toMatch(/цвет/i);
  });

  it('E: an unknown accessoryId is still rejected', () => {
    const result = calculatePrice(
      { ...DEFAULT_CONFIGURATION, accessories: [{ accessoryId: 'nonexistent-accessory', quantity: 1 }] },
      catalog,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    expect(result.message).toMatch(/аксессуар/i);
  });

  it('E: an unknown assemblyId/deliveryId is still rejected', () => {
    const badAssembly = calculatePrice({ ...DEFAULT_CONFIGURATION, assemblyId: 'nonexistent-assembly' }, catalog);
    expect(badAssembly.ok).toBe(false);
    const badDelivery = calculatePrice({ ...DEFAULT_CONFIGURATION, deliveryId: 'nonexistent-delivery' }, catalog);
    expect(badDelivery.ok).toBe(false);
  });
});

/**
 * The tests above use the in-memory mock catalog (no DATABASE_URL needed,
 * so they always run). The block below additionally exercises the REAL
 * PostgreSQL path end to end — buildDbCatalog() against the actual
 * database — whenever one is configured, which is the most direct possible
 * proof that the originally-reported bug ("Выбранный цвет недоступен" etc
 * on a real Postgres-backed deployment) is fixed. It skips cleanly
 * everywhere else, per this project's convention for tests that need real
 * infrastructure (see tests/e2e/admin.spec.ts).
 */
describe.skipIf(!process.env.DATABASE_URL)('C/D/E against the REAL PostgreSQL database', () => {
  let dbCatalog: Catalog;

  beforeAll(async () => {
    const { buildDbCatalog } = await import('@/lib/data/db-repository');
    dbCatalog = await buildDbCatalog();
  });

  it('C: the default configuration prices successfully against the real database', () => {
    const result = calculatePrice(DEFAULT_CONFIGURATION, dbCatalog);
    expect(result.ok, !result.ok ? result.message : undefined).toBe(true);
  });

  it('D: acc-cross-brace prices successfully against the real database', () => {
    const target = DEFAULT_CONFIGURATION.sections[0];
    const config: ShelvingConfiguration = {
      ...DEFAULT_CONFIGURATION,
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }],
    };
    const result = calculatePrice(config, dbCatalog);
    expect(result.ok, !result.ok ? result.message : undefined).toBe(true);
  });

  it('E: a genuinely unknown id is still rejected against the real database', () => {
    const result = calculatePrice({ ...DEFAULT_CONFIGURATION, colorId: 'nonexistent-color' }, dbCatalog);
    expect(result.ok).toBe(false);
  });

  it('every canonical seed-data id round-trips through the real database unchanged', () => {
    for (const c of COLORS) expect(dbCatalog.colors.some((row) => row.id === c.id), c.id).toBe(true);
    for (const a of ASSEMBLY_SERVICES) expect(dbCatalog.assemblyServices.some((row) => row.id === a.id), a.id).toBe(true);
    for (const d of DELIVERY_METHODS) expect(dbCatalog.deliveryMethods.some((row) => row.id === d.id), d.id).toBe(true);
    for (const a of ACCESSORIES) expect(dbCatalog.accessories.some((row) => row.id === a.id), a.id).toBe(true);
  });
});
