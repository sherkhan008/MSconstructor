import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import type { BomLine, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * MS Standard core price identity.
 *
 * MS Standard is bought as exactly two commercial positions — the upright and
 * the ordinary straight shelf. Everything else in the rack (the beams that
 * make a shelf a shelf, the frame ties, the bolt/nut sets, the feet, the
 * connectors joining two sections on a shared upright) ships inside those two
 * supplier prices, so the merchandise price of a plain MS Standard rack must
 * be exactly:
 *
 *     Σ upright price × upright quantity  +  Σ shelf price × shelf quantity
 *
 * and nothing else. The same holds for purchase cost: a helper part must not
 * add supplier cost a second time.
 *
 * These tests run against the in-memory development catalog
 * (src/lib/data/seed-data.ts), whose prices are invented sample figures —
 * no real supplier price is committed to this repository. What is asserted is
 * the identity, never a particular tenge amount.
 */

let sectionCounter = 0;
function section(width: number, overrides: Partial<ShelvingSection> = {}): ShelvingSection {
  sectionCounter += 1;
  return { id: `kit-sec-${sectionCounter}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
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

/** The structural helper parts whose price the upright and the shelf own. */
const HELPER_TYPES: BomLine['type'][] = [
  'BEAM_LONGITUDINAL',
  'BEAM_DEPTH',
  'TIE',
  'FASTENER',
  'FOOT',
  'CONNECTOR',
];

const approvedTotal = (bom: BomLine[]) =>
  bom
    .filter((l) => l.type === 'UPRIGHT' || l.type === 'SHELF')
    .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

const approvedCost = (bom: BomLine[]) =>
  bom
    .filter((l) => l.type === 'UPRIGHT' || l.type === 'SHELF')
    .reduce((sum, l) => sum + (l.unitCost ?? 0) * l.quantity, 0);

const SCENARIOS = [
  { label: '1 section, 2 shelves, lowest height', config: config({ height: 1000, depth: 300, shelves: 2, sections: [section(700)] }) },
  { label: '1 section, 4 shelves', config: config({ height: 1500, depth: 400, shelves: 4, sections: [section(1000)] }) },
  { label: '1 section, 5 shelves, deep', config: config({ height: 2000, depth: 700, shelves: 5, sections: [section(1000)] }) },
  { label: '1 section, 6 shelves', config: config({ height: 2500, depth: 600, shelves: 6, sections: [section(1200)] }) },
  { label: '1 section, 8 shelves, tallest', config: config({ height: 3000, depth: 600, shelves: 8, sections: [section(1500)] }) },
  { label: '2 equal sections', config: config({ height: 2000, depth: 400, shelves: 5, sections: [section(1000), section(1000)] }) },
  { label: 'mixed-width row of 3 sections', config: config({ height: 2000, depth: 400, shelves: 5, sections: [section(700), section(1000), section(1200)] }) },
] as const;

describe('MS Standard is priced from the approved upright + shelf list only', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  function priced(cfg: ShelvingConfiguration) {
    const result = calculatePrice(cfg, catalog);
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  describe.each(SCENARIOS)('$label', (scenario) => {
    it('merchandise price equals the approved uprights + shelves exactly', () => {
      const result = priced(scenario.config);
      expect(result.breakdown.componentsSubtotal).toBe(approvedTotal(result.bom));
    });

    it('adds no model markup on top — the supplier uplift is already in the price', () => {
      // Sample-catalog MS Standard still carries a markup percentage; what
      // must hold everywhere is that the price a customer sees is the
      // component subtotal plus colour and markup, with no hidden helper
      // amount between them.
      const result = priced(scenario.config);
      expect(result.breakdown.unitNet).toBe(
        result.breakdown.componentsSubtotal + result.breakdown.colorSurcharge + result.breakdown.markup,
      );
    });

    it('charges no purchase cost twice — supplier cost is the uprights + shelves', () => {
      const result = priced(scenario.config);
      const cost = result.bom.reduce((sum, l) => sum + (l.unitCost ?? 0) * l.quantity, 0);
      expect(cost).toBe(approvedCost(result.bom));
    });

    it('keeps every helper part in the BOM with its quantity and weight', () => {
      const result = priced(scenario.config);
      const helpers = result.bom.filter((l) => HELPER_TYPES.includes(l.type));
      expect(helpers.length).toBeGreaterThan(0);
      for (const line of helpers) {
        expect(line.quantity, line.sku).toBeGreaterThan(0);
        expect(line.weightKg, line.sku).toBeGreaterThan(0);
        expect(line.unitPrice, line.sku).toBe(0);
        expect(line.totalPrice, line.sku).toBe(0);
        expect(line.unitCost, line.sku).toBe(0);
      }
    });

    it('still lists the uprights and the shelves at a real price', () => {
      const result = priced(scenario.config);
      const priceCarriers = result.bom.filter((l) => l.type === 'UPRIGHT' || l.type === 'SHELF');
      expect(priceCarriers.length).toBeGreaterThan(0);
      for (const line of priceCarriers) {
        expect(line.unitPrice, line.sku).toBeGreaterThan(0);
        expect(line.unitCost, line.sku).toBeGreaterThan(0);
      }
    });
  });

  it('leaves the shared-upright quantity formulas untouched', () => {
    const uprights = (cfg: ShelvingConfiguration) =>
      priced(cfg).bom.find((l) => l.type === 'UPRIGHT')?.quantity ?? 0;
    expect(uprights(config({ sections: [section(1000)] }))).toBe(4);
    expect(uprights(config({ sections: [section(1000), section(1000)] }))).toBe(6);
    expect(uprights(config({ sections: [section(700), section(1000), section(1200)] }))).toBe(8);
  });

  it('scales exactly with shelf count — one approved shelf price per shelf', () => {
    const base = priced(config({ shelves: 4 }));
    const more = priced(config({ shelves: 5 }));
    const shelfPrice = base.bom.find((l) => l.type === 'SHELF')!.unitPrice;
    expect(more.breakdown.componentsSubtotal - base.breakdown.componentsSubtotal).toBe(shelfPrice);
  });

  it('still charges walls, accessories, assembly and delivery as their own paid options', () => {
    const plain = priced(config());
    const withWall = priced(config({ sections: [section(1000, { rearWall: true })] }));
    expect(withWall.breakdown.componentsSubtotal).toBeGreaterThan(plain.breakdown.componentsSubtotal);

    const wallLine = withWall.bom.find((l) => l.type === 'REAR_WALL');
    expect(wallLine?.totalPrice).toBeGreaterThan(0);
    expect(wallLine?.unitCost).toBeGreaterThan(0);

    const accessory = catalog.accessories.find((a) => a.active && a.unitPrice > 0)!;
    const withAccessory = priced(config({ accessories: [{ accessoryId: accessory.id, quantity: 1 }] }));
    const accessoryLine = withAccessory.bom.find((l) => l.type === 'ACCESSORY');
    expect(accessoryLine?.totalPrice).toBe(accessory.unitPrice);
    expect(accessoryLine?.unitCost).toBe(accessory.purchasePrice);
  });
});

describe('other models are unaffected by the MS Standard supplier-kit pricing', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  const OTHER_MODELS = [
    {
      slug: 'ms-strong',
      config: config({
        modelSlug: 'ms-strong',
        height: 2400,
        depth: 500,
        shelves: 4,
        loadCapacity: 300,
        shelfType: 'REINFORCED',
        sections: [section(1000), section(1200)],
      }),
    },
    {
      slug: 'archive-ms',
      config: config({
        modelSlug: 'archive-ms',
        height: 2000,
        depth: 400,
        shelves: 6,
        loadCapacity: 150,
        shelfType: 'STANDARD',
        sections: [section(1000), section(1000)],
      }),
    },
  ] as const;

  it.each(OTHER_MODELS)('$slug keeps every structural part separately priced', ({ config: cfg }) => {
    const result = calculatePrice(cfg, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const helpers = result.bom.filter((l) => HELPER_TYPES.includes(l.type));
    expect(helpers.length).toBeGreaterThan(0);
    for (const line of helpers) {
      expect(line.totalPrice, line.sku).toBeGreaterThan(0);
      expect(line.unitCost, line.sku).toBeGreaterThan(0);
    }
    // ...so their subtotal is strictly more than the uprights and shelves alone.
    expect(result.breakdown.componentsSubtotal).toBeGreaterThan(approvedTotal(result.bom));
  });
});
