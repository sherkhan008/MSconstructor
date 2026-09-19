import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice, stripBomCosts, toPublicBom } from '@/lib/pricing';
import type { BomLine, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * Customer-visible kit composition: MS Standard ships as one complete shelf
 * assembly, so beams, frame ties and section connectors must not appear as
 * their own kit positions for a customer — while staying real rows, with
 * their own quantity and weight, in the internal BOM the authoritative price
 * and the delivery weight are computed from.
 *
 * MS Standard is priced from a supplier list that quotes only the upright and
 * the ordinary shelf, so those structural helper parts carry no selling price
 * and no purchase cost of their own for this model (see
 * applySupplierKitPriceOwnership in src/lib/pricing/bom.ts): their commercial
 * value is already inside the upright/shelf price, and charging their own
 * catalog price on top would invoice the same supplied part twice.
 */

let sectionCounter = 0;
function section(width: number, overrides: Partial<ShelvingSection> = {}): ShelvingSection {
  sectionCounter += 1;
  return { id: `pub-sec-${sectionCounter}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
}

function config(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
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

/**
 * Authoritative totals captured from the pricing engine with the MS Standard
 * fastener rule (24 bolt + nut pairs for 2 shelves, +4 per shelf — see
 * tests/integration/ms-standard-fasteners.test.ts) and MS Standard's
 * supplier-kit price ownership. Hiding customer-visible rows must not move
 * any of these numbers by a single tenge. Every figure here comes from the
 * development sample catalog — never from a real supplier price list.
 */
const PRICE_BASELINES = [
  {
    label: '700 × 1500 × 600 / 6 полок',
    config: config({ sections: [section(700)], height: 1500, depth: 600, shelves: 6 }),
    shelfComponentId: 'shelf-STANDARD-700-600',
    shelfName: 'Полка Стандартная 700×600',
    componentsSubtotal: 256200,
    net: 312564,
    vat: 50010,
    total: 362574,
    totalWeightKg: 86,
  },
  {
    label: '1000 × 2500 × 800 / 8 полок',
    config: config({ sections: [section(1000)], height: 2500, depth: 800, shelves: 8 }),
    shelfComponentId: 'shelf-STANDARD-1000-800',
    shelfName: 'Полка Стандартная 1000×800',
    componentsSubtotal: 636000,
    net: 775920,
    vat: 124147,
    total: 900067,
    totalWeightKg: 165,
  },
  {
    label: '1500 × 3000 × 600 / 8 полок',
    config: config({ sections: [section(1500)], height: 3000, depth: 600, shelves: 8 }),
    shelfComponentId: 'shelf-STANDARD-1500-600',
    shelfName: 'Полка Стандартная 1500×600',
    componentsSubtotal: 717600,
    net: 875472,
    vat: 140076,
    total: 1015548,
    totalWeightKg: 191,
  },
] as const;

describe('public (customer-visible) BOM', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  function internalBom(cfg: ShelvingConfiguration): BomLine[] {
    const result = calculatePrice(cfg, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    return result.bom;
  }

  describe.each(PRICE_BASELINES)('$label', (baseline) => {
    it('shows no separate beam positions', () => {
      const publicBom = toPublicBom(internalBom(baseline.config), 'ms-standard');
      expect(publicBom.filter((l) => l.type === 'BEAM_LONGITUDINAL' || l.type === 'BEAM_DEPTH')).toEqual([]);
      expect(publicBom.some((l) => l.name.toLowerCase().includes('балка'))).toBe(false);
    });

    it('shows no separate frame-tie positions', () => {
      const publicBom = toPublicBom(internalBom(baseline.config), 'ms-standard');
      expect(publicBom.filter((l) => l.type === 'TIE')).toEqual([]);
      expect(publicBom.some((l) => l.name.toLowerCase().includes('стяжка'))).toBe(false);
    });

    it('still represents the shelf assembly, the uprights and the fastener kit', () => {
      const publicBom = toPublicBom(internalBom(baseline.config), 'ms-standard');
      const shelves = publicBom.filter((l) => l.type === 'SHELF');
      expect(shelves).toHaveLength(1);
      expect(shelves[0].quantity).toBe(baseline.config.shelves);
      expect(publicBom.some((l) => l.type === 'UPRIGHT')).toBe(true);
      expect(publicBom.some((l) => l.type === 'FASTENER')).toBe(true);
    });

    it('keeps the real shelf identity — folding never rewrites SKU, name or quantity', () => {
      const bom = internalBom(baseline.config);
      const publicBom = toPublicBom(bom, 'ms-standard');
      const internalShelf = bom.find((l) => l.type === 'SHELF');
      const publicShelf = publicBom.find((l) => l.type === 'SHELF');

      expect(publicShelf?.componentId).toBe(baseline.shelfComponentId);
      expect(publicShelf?.sku).toBe(internalShelf?.sku);
      expect(publicShelf?.name).toBe(baseline.shelfName);
      expect(publicShelf?.quantity).toBe(internalShelf?.quantity);

      // Same for every other surviving row: identity comes from the BOM, untouched.
      for (const line of publicBom) {
        const source = bom.find((l) => l.componentId === line.componentId);
        expect(source, `public row ${line.componentId} must exist in the internal BOM`).toBeDefined();
        expect(line.sku).toBe(source!.sku);
        expect(line.name).toBe(source!.name);
        expect(line.type).toBe(source!.type);
        expect(line.quantity).toBe(source!.quantity);
      }
    });

    it('keeps beams and frame ties in the internal BOM, with their quantity and weight', () => {
      const bom = internalBom(baseline.config);
      for (const type of ['BEAM_LONGITUDINAL', 'BEAM_DEPTH', 'TIE'] as const) {
        const line = bom.find((l) => l.type === type);
        expect(line, `internal BOM must keep a ${type} line`).toBeDefined();
        expect(line!.quantity).toBeGreaterThan(0);
        expect(line!.weightKg).toBeGreaterThan(0);
        // Priced inside the supplier's upright/shelf price for MS Standard:
        // the part is still built, packed and weighed, never charged twice.
        expect(line!.unitPrice).toBe(0);
        expect(line!.totalPrice).toBe(0);
        expect(line!.unitCost).toBe(0);
      }
    });

    it('prices the rack as exactly the approved uprights + shelves, nothing else', () => {
      const result = calculatePrice(baseline.config, catalog);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const approved = result.bom
        .filter((l) => l.type === 'UPRIGHT' || l.type === 'SHELF')
        .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
      expect(result.breakdown.componentsSubtotal).toBe(approved);
      // ...and the helper parts really are still in the BOM, so the identity
      // above is price ownership, not a BOM that quietly lost its parts.
      expect(result.bom.filter((l) => l.type !== 'UPRIGHT' && l.type !== 'SHELF').length).toBeGreaterThan(0);
    });

    it('prices exactly as before the kit composition was simplified', () => {
      const result = calculatePrice(baseline.config, catalog);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.breakdown.componentsSubtotal).toBe(baseline.componentsSubtotal);
      expect(result.breakdown.net).toBe(baseline.net);
      expect(result.breakdown.vat).toBe(baseline.vat);
      expect(result.breakdown.total).toBe(baseline.total);
      expect(result.totalWeightKg).toBe(baseline.totalWeightKg);
    });

    it('public rows still account for the full priced amount and weight', () => {
      const bom = internalBom(baseline.config);
      const publicBom = toPublicBom(bom, 'ms-standard');
      expect(publicBom.reduce((s, l) => s + l.totalPrice, 0)).toBe(baseline.componentsSubtotal);
      expect(publicBom.reduce((s, l) => s + l.weightKg, 0)).toBeCloseTo(
        bom.reduce((s, l) => s + l.weightKg, 0),
        6,
      );
    });
  });

  it('hides beams and frame ties for a multi-section row too, and keeps every remaining row', () => {
    const bom = internalBom(config({ sections: [section(1000), section(1200), section(1000)], shelves: 4 }));
    const publicBom = toPublicBom(bom, 'ms-standard');

    expect(publicBom.some((l) => l.type === 'BEAM_LONGITUDINAL' || l.type === 'BEAM_DEPTH' || l.type === 'TIE')).toBe(
      false,
    );
    expect(publicBom.filter((l) => l.type === 'SHELF').length).toBeGreaterThan(0);
    expect(publicBom.some((l) => l.type === 'CONNECTOR')).toBe(false);
    expect(bom.find((l) => l.type === 'CONNECTOR')?.quantity).toBe(2);
    expect(publicBom.reduce((s, l) => s + l.totalPrice, 0)).toBe(bom.reduce((s, l) => s + l.totalPrice, 0));
  });

  describe('section connector in a mixed-width row (700 + 1000 × 2000 × 600 / 5 полок)', () => {
    const CONNECTOR_NAME = 'Комплект соединения секций';
    // Authoritative totals for this row, from the development sample
    // catalog — never a real supplier figure.
    const baseline = {
      componentsSubtotal: 518100,
      net: 632082,
      vat: 101133,
      total: 733215,
      totalWeightKg: 165,
    };
    const mixed = () => config({ sections: [section(700), section(1000)], depth: 600, shelves: 5 });

    it('shows no CONNECTOR row and no «Комплект соединения секций» publicly', () => {
      const publicBom = toPublicBom(internalBom(mixed()), 'ms-standard');
      expect(publicBom.filter((l) => l.type === 'CONNECTOR')).toEqual([]);
      expect(publicBom.some((l) => l.name === CONNECTOR_NAME)).toBe(false);
    });

    it('keeps the connector in the internal BOM with its quantity and weight', () => {
      const connector = internalBom(mixed()).find((l) => l.type === 'CONNECTOR');
      expect(connector?.name).toBe(CONNECTOR_NAME);
      expect(connector!.quantity).toBe(1);
      expect(connector!.weightKg).toBeGreaterThan(0);
      // Part of the supplier-priced frame for MS Standard — see the module
      // header: it ships and it weighs, it is not charged separately.
      expect(connector!.totalPrice).toBe(0);
      expect(connector!.unitCost).toBe(0);
    });

    it('folds the connector price and weight into the upright (frame) row', () => {
      const bom = internalBom(mixed());
      const sumOf = (types: string[], key: 'totalPrice' | 'weightKg') =>
        bom.filter((l) => types.includes(l.type)).reduce((s, l) => s + l[key], 0);
      const publicUpright = toPublicBom(bom, 'ms-standard').find((l) => l.type === 'UPRIGHT');

      expect(publicUpright?.totalPrice).toBe(sumOf(['UPRIGHT', 'TIE', 'CONNECTOR'], 'totalPrice'));
      expect(publicUpright?.weightKg).toBeCloseTo(sumOf(['UPRIGHT', 'TIE', 'CONNECTOR'], 'weightKg'), 6);
    });

    it('keeps every surviving row identity unchanged', () => {
      const bom = internalBom(mixed());
      const publicBom = toPublicBom(bom, 'ms-standard');
      expect(publicBom.map((l) => l.type).sort()).toEqual(['FASTENER', 'FOOT', 'SHELF', 'SHELF', 'UPRIGHT']);
      for (const line of publicBom) {
        const source = bom.find((l) => l.componentId === line.componentId)!;
        expect(line.sku).toBe(source.sku);
        expect(line.name).toBe(source.name);
        expect(line.type).toBe(source.type);
        expect(line.quantity).toBe(source.quantity);
      }
      expect(publicBom.find((l) => l.type === 'FASTENER')?.name).toBe('Комплект крепежа (болт + гайка)');
    });

    it('public rows still sum to componentsSubtotal and the full weight', () => {
      const bom = internalBom(mixed());
      const publicBom = toPublicBom(bom, 'ms-standard');
      expect(publicBom.reduce((s, l) => s + l.totalPrice, 0)).toBe(baseline.componentsSubtotal);
      expect(publicBom.reduce((s, l) => s + l.weightKg, 0)).toBeCloseTo(
        bom.reduce((s, l) => s + l.weightKg, 0),
        6,
      );
    });

    it('prices exactly as before the connector was hidden', () => {
      const result = calculatePrice(mixed(), catalog);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.breakdown.componentsSubtotal).toBe(baseline.componentsSubtotal);
      expect(result.breakdown.net).toBe(baseline.net);
      expect(result.breakdown.vat).toBe(baseline.vat);
      expect(result.breakdown.total).toBe(baseline.total);
      expect(result.totalWeightKg).toBe(baseline.totalWeightKg);
    });
  });

  it('single-section ms-standard has no connector internally or publicly', () => {
    const bom = internalBom(config());
    expect(bom.some((l) => l.type === 'CONNECTOR')).toBe(false);
    expect(toPublicBom(bom, 'ms-standard').some((l) => l.type === 'CONNECTOR')).toBe(false);
  });

  it('keeps the section connector as its own public row for ms-strong and archive-ms', () => {
    const strong = internalBom(
      config({
        modelSlug: 'ms-strong',
        sections: [section(1000), section(1200)],
        height: 2400,
        depth: 500,
        shelves: 4,
        loadCapacity: 300,
        shelfType: 'REINFORCED',
      }),
    );
    const archive = internalBom(
      config({ modelSlug: 'archive-ms', sections: [section(700), section(1000)], height: 2000, depth: 400, shelves: 5 }),
    );

    for (const [bom, slug] of [
      [strong, 'ms-strong'],
      [archive, 'archive-ms'],
    ] as const) {
      const pub = toPublicBom(bom, slug);
      expect(pub).toEqual(stripBomCosts(bom));
      expect(pub.some((l) => l.type === 'CONNECTOR')).toBe(true);
    }
  });

  it('keeps walls and accessories as their own customer-visible positions', () => {
    const bom = internalBom(
      config({
        sections: [section(1000, { rearWall: true, leftWall: true })],
        accessories: [{ accessoryId: 'acc-extra-shelf', quantity: 2 }],
      }),
    );
    const publicBom = toPublicBom(bom, 'ms-standard');

    expect(publicBom.some((l) => l.type === 'REAR_WALL')).toBe(true);
    expect(publicBom.some((l) => l.type === 'SIDE_WALL')).toBe(true);
    expect(publicBom.find((l) => l.componentId === 'acc-extra-shelf')?.quantity).toBe(2);
  });

  it('never exposes internal purchase cost', () => {
    const publicBom = toPublicBom(internalBom(config()), 'ms-standard');
    for (const line of publicBom) {
      expect(Object.prototype.hasOwnProperty.call(line, 'unitCost')).toBe(false);
    }
  });

  it('does not mutate the internal BOM it projects from', () => {
    const bom = internalBom(config());
    const before = JSON.stringify(bom);
    toPublicBom(bom, 'ms-standard');
    expect(JSON.stringify(bom)).toBe(before);
  });

  it('keeps one correct shelf row per section width in a mixed-width row', () => {
    const bom = internalBom(config({ sections: [section(700), section(1000)], depth: 600, shelves: 5 }));
    const publicBom = toPublicBom(bom, 'ms-standard');
    const shelves = publicBom.filter((l) => l.type === 'SHELF');

    // Two different shelf SKUs must stay two distinct rows — never merged.
    expect(shelves).toHaveLength(2);
    expect(shelves.map((l) => l.componentId).sort()).toEqual(['shelf-STANDARD-1000-600', 'shelf-STANDARD-700-600']);
    expect(shelves.map((l) => l.name).sort()).toEqual(['Полка Стандартная 1000×600', 'Полка Стандартная 700×600']);
    expect(new Set(shelves.map((l) => l.sku)).size).toBe(2);
    for (const shelf of shelves) {
      expect(shelf.quantity).toBe(5);
      expect(shelf.quantity).toBe(bom.find((l) => l.componentId === shelf.componentId)?.quantity);
    }
    expect(publicBom.some((l) => l.type === 'BEAM_LONGITUDINAL' || l.type === 'BEAM_DEPTH' || l.type === 'TIE')).toBe(
      false,
    );
    expect(publicBom.reduce((s, l) => s + l.totalPrice, 0)).toBe(bom.reduce((s, l) => s + l.totalPrice, 0));
  });

  it('applies the one-assembly grouping only to ms-standard', () => {
    // /api/pricing/calculate prices whatever catalog model the client sends,
    // so the grouping is scoped by slug: ms-strong sells beams as their own
    // load-bearing positions and must keep them in its customer-facing BOM.
    const strong = internalBom(
      config({
        modelSlug: 'ms-strong',
        sections: [section(1200)],
        height: 2400,
        depth: 500,
        shelves: 4,
        loadCapacity: 300,
        shelfType: 'REINFORCED',
      }),
    );
    const strongPublic = toPublicBom(strong, 'ms-strong');

    expect(strongPublic.some((l) => l.type === 'BEAM_LONGITUDINAL')).toBe(true);
    expect(strongPublic.some((l) => l.type === 'BEAM_DEPTH')).toBe(true);
    expect(strongPublic.some((l) => l.type === 'TIE')).toBe(true);
    expect(strongPublic).toEqual(stripBomCosts(strong));

    const standard = internalBom(config());
    expect(toPublicBom(standard, 'ms-standard').some((l) => l.type === 'BEAM_LONGITUDINAL')).toBe(false);
  });

  it('leaves the internal order snapshot projection (stripBomCosts) component-level', () => {
    // Order records persist stripBomCosts(), not toPublicBom(): historical and
    // new snapshots keep beams/frame ties for the admin and production views.
    const snapshot = stripBomCosts(internalBom(config()));
    expect(snapshot.some((l) => l.type === 'BEAM_LONGITUDINAL')).toBe(true);
    expect(snapshot.some((l) => l.type === 'BEAM_DEPTH')).toBe(true);
    expect(snapshot.some((l) => l.type === 'TIE')).toBe(true);
    expect(snapshot.every((l) => !Object.prototype.hasOwnProperty.call(l, 'unitCost'))).toBe(true);
  });
});
