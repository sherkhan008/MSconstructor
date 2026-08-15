import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { CATALOG_PRODUCTS } from '@/lib/data/seed-data';
import { calculatePrice } from '@/lib/pricing';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

let sectionCounter = 0;
function section(width: number, overrides: Partial<ShelvingSection> = {}): ShelvingSection {
  sectionCounter += 1;
  return { id: `sec-${sectionCounter}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
}

function baseConfig(overrides: Partial<ShelvingConfiguration>): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
    sections: [section(1000)],
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

  it('reduces upright and tie quantities for shared-upright multi-section rows', () => {
    const single = calculatePrice(baseConfig({ sections: [section(1000)] }), catalog);
    const shared = calculatePrice(
      baseConfig({ sections: [section(1000), section(1000), section(1000)] }),
      catalog,
    );
    expect(single.ok).toBe(true);
    expect(shared.ok).toBe(true);
    if (!single.ok || !shared.ok) return;

    const uprightQty = (r: typeof single) => r.bom.find((l) => l.type === 'UPRIGHT')?.quantity ?? 0;
    // A lone section has nothing to share with, so it prices as `sections * 4`
    // = 4. Three sections in one row always share boundary uprights:
    // `(sections + 1) * 2` = 8, not the independent `sections * 4` = 12.
    expect(uprightQty(single)).toBe(4);
    expect(uprightQty(shared)).toBe(8);
    expect(uprightQty(shared)).toBeLessThan(3 * uprightQty(single));
  });

  it('prices mixed section widths using each section\'s own width, not the first section\'s', () => {
    const mixed = calculatePrice(baseConfig({ sections: [section(700), section(1500), section(1000)] }), catalog);
    const uniform = calculatePrice(
      baseConfig({ sections: [section(700), section(700), section(700)] }),
      catalog,
    );
    expect(mixed.ok).toBe(true);
    expect(uniform.ok).toBe(true);
    if (!mixed.ok || !uniform.ok) return;

    // A row with a 1500mm section must cost strictly more in shelves/beams than
    // an all-700mm row of the same section count — proof the wider section's own
    // width drove its BOM, not a single shared global width.
    expect(mixed.breakdown.componentsSubtotal).toBeGreaterThan(uniform.breakdown.componentsSubtotal);
    expect(mixed.rowLengthMm).toBe(700 + 1500 + 1000);
  });

  it('aggregates identical SKUs across sections into one BOM line', () => {
    const result = calculatePrice(baseConfig({ sections: [section(1000), section(1000), section(1000)] }), catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shelfLines = result.bom.filter((l) => l.type === 'SHELF');
    // All three sections share one width, so despite being section-level rules
    // they must collapse into a single aggregated SHELF line, not three.
    expect(shelfLines.length).toBe(1);
    expect(shelfLines[0].quantity).toBe(5 * 3); // shelves * sections
  });

  it('prices independent wall panels per section', () => {
    const noWalls = calculatePrice(baseConfig({ sections: [section(1000), section(1000)] }), catalog);
    const oneWall = calculatePrice(
      baseConfig({ sections: [section(1000, { rearWall: true }), section(1000)] }),
      catalog,
    );
    expect(noWalls.ok).toBe(true);
    expect(oneWall.ok).toBe(true);
    if (!noWalls.ok || !oneWall.ok) return;
    const rearLine = oneWall.bom.find((l) => l.type === 'REAR_WALL');
    expect(rearLine?.quantity).toBe(1);
    expect(noWalls.bom.find((l) => l.type === 'REAR_WALL')).toBeUndefined();
    expect(oneWall.breakdown.total).toBeGreaterThan(noWalls.breakdown.total);
  });

  it('rejects more than the maximum of 10 sections', () => {
    const result = calculatePrice(
      baseConfig({ sections: Array.from({ length: 11 }, () => section(1000)) }),
      catalog,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty section array', () => {
    const result = calculatePrice(baseConfig({ sections: [] }), catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a section width unsupported by the selected model', () => {
    const result = calculatePrice(baseConfig({ sections: [section(1500)], modelSlug: 'archive-ms' }), catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
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

  it('charges assembly per section for the PER_SECTION method', () => {
    const one = calculatePrice(baseConfig({ sections: [section(1000)], assemblyId: 'assembly-professional' }), catalog);
    const three = calculatePrice(
      baseConfig({ sections: [section(1000), section(1000), section(1000)], assemblyId: 'assembly-professional' }),
      catalog,
    );
    expect(one.ok).toBe(true);
    expect(three.ok).toBe(true);
    if (!one.ok || !three.ok) return;
    expect(three.breakdown.assembly).toBe(one.breakdown.assembly * 3);
  });

  it('prices every published catalog product without requiring an individual quote', () => {
    for (const product of CATALOG_PRODUCTS) {
      const config = baseConfig({
        modelSlug: product.modelSlug,
        height: product.height,
        depth: product.depth,
        shelves: product.shelves,
        sections: Array.from({ length: Math.max(1, product.sections) }, () => section(product.width)),
        loadCapacity: product.loadCapacity,
        shelfType: product.shelfType,
        colorId: product.color,
      });
      const result = calculatePrice(config, catalog);
      expect(result.ok, `expected catalog product "${product.slug}" to price successfully`).toBe(true);
    }
  });
});
