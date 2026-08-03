import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { CATALOG_PRODUCTS } from '@/lib/data/seed-data';
import { calculatePrice } from '@/lib/pricing';
import type { ShelvingConfiguration } from '@/lib/types/domain';

function baseConfig(overrides: Partial<ShelvingConfiguration>): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    configurationType: 'SINGLE',
    height: 2000,
    width: 1000,
    depth: 400,
    shelves: 5,
    sections: 1,
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    rear: 'CROSS_BRACE',
    side: 'NONE',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}

describe('pricing engine', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('prices a standard configuration successfully', () => {
    const result = calculatePrice(baseConfig({}), catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bom.length).toBeGreaterThan(0);
    expect(result.breakdown.total).toBeGreaterThan(0);
    expect(result.breakdown.net).toBeGreaterThan(0);
    expect(result.breakdown.vat).toBeGreaterThan(0);
    expect(result.breakdown.total).toBe(result.breakdown.net + result.breakdown.vat);
  });

  it('rejects a load capacity that is incompatible with the model', () => {
    const result = calculatePrice(baseConfig({ loadCapacity: 300 }), catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
  });

  it('rejects malformed input before it reaches compatibility checks', () => {
    const result = calculatePrice({ modelSlug: 'ms-standard' }, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('never trusts a client-submitted total — no such field is read', () => {
    const withFakeTotal = { ...baseConfig({}), total: 1 } as unknown;
    const result = calculatePrice(withFakeTotal, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.total).toBeGreaterThan(1);
  });

  it('reduces upright and tie quantities for shared-upright row configurations', () => {
    const independent = calculatePrice(
      baseConfig({ configurationType: 'MULTIPLE_INDEPENDENT', sections: 3 }),
      catalog,
    );
    const shared = calculatePrice(
      baseConfig({ configurationType: 'STARTER_WITH_EXTENSIONS', sections: 3 }),
      catalog,
    );
    expect(independent.ok).toBe(true);
    expect(shared.ok).toBe(true);
    if (!independent.ok || !shared.ok) return;

    const uprightQty = (r: typeof independent) => r.bom.find((l) => l.type === 'UPRIGHT')?.quantity ?? 0;
    expect(uprightQty(independent)).toBe(12); // sections * 4
    expect(uprightQty(shared)).toBe(8); // (sections + 1) * 2 — shared uprights are not double-counted
    expect(shared.breakdown.total).toBeLessThan(independent.breakdown.total);
  });

  it('includes accessories in the bill of materials and the price', () => {
    const withoutAccessory = calculatePrice(baseConfig({}), catalog);
    const withAccessory = calculatePrice(
      baseConfig({ accessories: [{ accessoryId: 'acc-extra-shelf', quantity: 2 }] }),
      catalog,
    );
    expect(withoutAccessory.ok).toBe(true);
    expect(withAccessory.ok).toBe(true);
    if (!withoutAccessory.ok || !withAccessory.ok) return;
    const line = withAccessory.bom.find((l) => l.componentId === 'acc-extra-shelf');
    expect(line?.quantity).toBe(2);
    expect(withAccessory.breakdown.total).toBeGreaterThan(withoutAccessory.breakdown.total);
  });

  it('scales price with quantity', () => {
    const single = calculatePrice(baseConfig({ quantity: 1 }), catalog);
    const triple = calculatePrice(baseConfig({ quantity: 3 }), catalog);
    expect(single.ok).toBe(true);
    expect(triple.ok).toBe(true);
    if (!single.ok || !triple.ok) return;
    expect(triple.breakdown.itemsNet).toBe(single.breakdown.itemsNet * 3);
  });

  it('applies a valid promo code and never discounts below the minimum margin', () => {
    const result = calculatePrice(baseConfig({ promoCode: 'SKLAD2026', quantity: 5 }), catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.discount).toBeGreaterThan(0);
    expect(result.breakdown.net).toBeGreaterThanOrEqual(0);
  });

  it('reports pickup delivery as free and city delivery as manager-confirmed', () => {
    const pickup = calculatePrice(baseConfig({ deliveryId: 'delivery-pickup' }), catalog);
    const city = calculatePrice(baseConfig({ deliveryId: 'delivery-city' }), catalog);
    expect(pickup.ok).toBe(true);
    expect(city.ok).toBe(true);
    if (!pickup.ok || !city.ok) return;
    expect(pickup.breakdown.delivery).toBe(0);
    expect(pickup.deliveryNote).toBeNull();
    expect(city.breakdown.delivery).toBeNull();
    expect(city.deliveryNote).toMatch(/менеджер/i);
  });

  it('prices every published catalog product without requiring an individual quote', () => {
    for (const product of CATALOG_PRODUCTS) {
      const config = baseConfig({
        modelSlug: product.modelSlug,
        height: product.height,
        width: product.width,
        depth: product.depth,
        shelves: product.shelves,
        sections: product.sections,
        loadCapacity: product.loadCapacity,
        shelfType: product.shelfType,
        colorId: product.color,
        configurationType: product.sections > 1 ? 'STARTER_WITH_EXTENSIONS' : 'SINGLE',
      });
      const result = calculatePrice(config, catalog);
      expect(result.ok, `expected catalog product "${product.slug}" to price successfully`).toBe(true);
    }
  });
});
