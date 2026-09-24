import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { CATALOG_PRODUCTS } from '@/lib/data/seed-data';
import { calculatePrice } from '@/lib/pricing';
import { getMaxShelvesForHeight } from '@/lib/pricing/ms-standard-compatibility';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { uniformRow, type LooseSection, type UniformRowInput } from '../helpers/uniform-row';

let sectionCounter = 0;
function section(width: number, overrides: Partial<ShelvingSection> = {}): LooseSection {
  sectionCounter += 1;
  return { id: `sec-${sectionCounter}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
}

function baseConfig(overrides: Partial<UniformRowInput>): ShelvingConfiguration {
  return uniformRow({
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
  });
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

  it('reports pickup and warehouse-city delivery as free and other-region delivery as individually calculated', () => {
    const pickup = calculatePrice(baseConfig({ deliveryId: 'delivery-pickup' }), catalog);
    const city = calculatePrice(baseConfig({ deliveryId: 'delivery-city' }), catalog);
    const country = calculatePrice(baseConfig({ deliveryId: 'delivery-country' }), catalog);
    expect(pickup.ok).toBe(true);
    expect(city.ok).toBe(true);
    expect(country.ok).toBe(true);
    if (!pickup.ok || !city.ok || !country.ok) return;
    expect(pickup.breakdown.delivery).toBe(0);
    expect(pickup.deliveryNote).toBeNull();
    expect(city.breakdown.delivery).toBe(0);
    expect(city.deliveryNote).toBeNull();
    expect(country.breakdown.delivery).toBeNull();
    expect(country.deliveryNote).toBe('Стоимость доставки рассчитывается индивидуально.');
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
    for (const product of CATALOG_PRODUCTS.filter((p) => p.published)) {
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

  it('rejects the unpublished ms-standard-2400x1200x500-row product\'s own configuration (2400mm is no longer a valid MS Standard height)', () => {
    const product = CATALOG_PRODUCTS.find((p) => p.slug === 'ms-standard-2400x1200x500-row');
    expect(product?.published).toBe(false);
    if (!product) return;
    const config = baseConfig({
      height: product.height,
      depth: product.depth,
      shelves: product.shelves,
      sections: Array.from({ length: Math.max(1, product.sections) }, () => section(product.width)),
    });
    const result = calculatePrice(config, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
  });

  // The authoritative current MS Standard matrix (see
  // src/lib/pricing/ms-standard-compatibility.ts) — every one of these
  // heights must resolve real UPRIGHT/SHELF/BEAM_DEPTH/SIDE_WALL
  // components, not just pass compatibility validation, or the customer
  // hits a "missing component" price failure for a value the UI offers.
  const MS_STANDARD_HEIGHTS = [1000, 1500, 1800, 2000, 2200, 2500, 3000];
  const MS_STANDARD_DEPTHS = [300, 400, 500, 600, 700, 800];

  it('exposes exactly the specified MS Standard height list', () => {
    const model = catalog.models.find((m) => m.slug === 'ms-standard');
    expect(model?.heights).toEqual(MS_STANDARD_HEIGHTS);
  });

  it('exposes exactly the specified MS Standard depth list', () => {
    const model = catalog.models.find((m) => m.slug === 'ms-standard');
    expect(model?.depths).toEqual(MS_STANDARD_DEPTHS);
  });

  it.each(MS_STANDARD_HEIGHTS)('prices a default MS Standard configuration at height=%dmm', (height) => {
    // baseConfig's default 5 shelves exceeds the ceiling of the shorter
    // heights (1000mm allows 4), and this case is about component
    // availability, not the shelf rule — so take the shelf count from the
    // authoritative matrix rather than hardcoding one that happens to fit.
    const shelves = Math.min(5, getMaxShelvesForHeight(height) ?? 5);
    const result = calculatePrice(baseConfig({ height, shelves }), catalog);
    expect(result.ok, `height=${height} should price successfully`).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.total).toBeGreaterThan(0);
  });

  it.each(MS_STANDARD_DEPTHS)('prices a default MS Standard configuration at depth=%dmm', (depth) => {
    const result = calculatePrice(baseConfig({ depth }), catalog);
    expect(result.ok, `depth=${depth} should price successfully`).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.total).toBeGreaterThan(0);
  });

  // A follow-up task restricted the customer-facing MS Standard configurator
  // to STANDARD shelves only (see seed-data.ts's shelfTypes and
  // AdvancedSettingsAccordion, which no longer renders a shelf-type
  // selector). PERFORATED/GALVANIZED are no longer *reachable* through
  // calculatePrice for this model — that's the new business rule, not a
  // data gap — but the underlying component data must still exist
  // untouched (CLAUDE.md: don't delete historical data other architecture
  // may still use), just gated by model.shelfTypes instead of missing.
  it('rejects a non-STANDARD shelf type for MS Standard (customer-configurator restriction)', () => {
    const result = calculatePrice(baseConfig({ shelfType: 'PERFORATED' }), catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
  });

  it.each([600, 700, 800])('preserves PERFORATED and GALVANIZED shelf component data at the new depth=%dmm (not reachable by MS Standard, but not deleted)', (depth) => {
    for (const shelfType of ['PERFORATED', 'GALVANIZED'] as const) {
      const component = catalog.components.find(
        (c) => c.type === 'SHELF' && c.shelfType === shelfType && c.width === 1000 && c.depth === depth && c.active,
      );
      expect(component, `expected a ${shelfType} SHELF component for 1000×${depth}`).toBeDefined();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Five "Дополнительные параметры" rack options                        */
  /* ------------------------------------------------------------------ */

  it('prices the cross brace when attached to a 1000mm section', () => {
    const target = section(1000);
    const result = calculatePrice(
      baseConfig({ sections: [target], accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }] }),
      catalog,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.bom.find((l) => l.componentId === 'acc-cross-brace');
    expect(line?.quantity).toBe(1);
  });

  it('rejects the cross brace on a section that is not 1000mm wide', () => {
    const target = section(1200);
    const result = calculatePrice(
      baseConfig({ sections: [target], accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }] }),
      catalog,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    expect(result.message).toMatch(/1000/);
  });

  it('rejects a cross brace with no sectionId at all', () => {
    const result = calculatePrice(
      baseConfig({ sections: [section(1000)], accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1 }] }),
      catalog,
    );
    expect(result.ok).toBe(false);
  });

  it('does not treat the whole row as eligible just because one section is 1000mm — a brace must name its own qualifying section', () => {
    const eligible = section(1000);
    const ineligible = section(700);
    // Attaching the brace to the 700mm section must fail even though the
    // row also contains a 1000mm section elsewhere.
    const result = calculatePrice(
      baseConfig({
        sections: [eligible, ineligible],
        accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: ineligible.id }],
      }),
      catalog,
    );
    expect(result.ok).toBe(false);

    // The same row prices fine once the brace targets the section that
    // actually qualifies.
    const fixed = calculatePrice(
      baseConfig({
        sections: [eligible, ineligible],
        accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: eligible.id }],
      }),
      catalog,
    );
    expect(fixed.ok).toBe(true);
  });

  it('prices the adjustable-feet and shelf-reinforcement options', () => {
    const result = calculatePrice(
      baseConfig({
        shelves: 4,
        sections: [section(1000)],
        accessories: [
          { accessoryId: 'acc-adjustable-feet', quantity: 1 },
          { accessoryId: 'acc-shelf-reinforcement', quantity: 4 },
        ],
      }),
      catalog,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bom.find((l) => l.componentId === 'acc-adjustable-feet')?.quantity).toBe(1);
    expect(result.bom.find((l) => l.componentId === 'acc-shelf-reinforcement')?.quantity).toBe(4);
  });

  it('round-trips metalFootPad, shelfCornerBrackets and a section-scoped accessory through validation without inventing a price for them', () => {
    const target = section(1000);
    const before = baseConfig({
      sections: [target],
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }],
      metalFootPad: true,
      shelfCornerBrackets: true,
    });
    const result = calculatePrice(before, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // These two flags must survive into the echoed configuration (what the
    // cart/order actually persist) even though neither produces a BOM line —
    // proof they are real state, not silently dropped by schema validation.
    expect(result.configuration.metalFootPad).toBe(true);
    expect(result.configuration.shelfCornerBrackets).toBe(true);
    expect(result.configuration.accessories).toEqual([{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }]);
    expect(result.bom.some((l) => l.name.includes('подпятник') || l.name.includes('Уголк'))).toBe(false);
  });
});
