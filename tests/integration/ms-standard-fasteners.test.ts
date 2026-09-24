import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { toRule } from '@/lib/data/db-repository';
import { getOrderByNumber, clearMemoryOrders, saveOrder } from '@/lib/orders/store';
import type { OrderRecord } from '@/lib/orders/types';
import { buildBom, calculatePrice, toPublicBom } from '@/lib/pricing';
import { MS_STANDARD_MIN_SHELVES } from '@/lib/pricing/ms-standard-compatibility';
import type { BomLine, ShelvingConfiguration } from '@/lib/types/domain';
import { uniformRow, type LooseSection, type UniformRowInput } from '../helpers/uniform-row';

/**
 * MS Standard fastener rule: one fastener unit = one bolt + nut pair.
 * 2 shelves → 24 units, each additional shelf → +4, per section.
 */

const FASTENER_KIT_NAME = 'Комплект крепежа (болт + гайка)';

let sectionCounter = 0;
function section(width: number): LooseSection {
  sectionCounter += 1;
  return { id: `fst-sec-${sectionCounter}`, width, rearWall: false, leftWall: false, rightWall: false };
}

function config(overrides: Partial<UniformRowInput> = {}): ShelvingConfiguration {
  return uniformRow({
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 2,
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

describe('MS Standard fasteners', () => {
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

  function fastenerLines<T extends Pick<BomLine, 'type'>>(bom: T[]): T[] {
    return bom.filter((l) => l.type === 'FASTENER');
  }

  it('uses the project minimum of 2 shelves the formula is based on', () => {
    expect(MS_STANDARD_MIN_SHELVES).toBe(2);
  });

  describe.each([
    { shelves: 2, expected: 24 },
    { shelves: 3, expected: 28 },
    { shelves: 4, expected: 32 },
    { shelves: 5, expected: 36 },
    { shelves: 6, expected: 40 },
    { shelves: 7, expected: 44 },
    { shelves: 8, expected: 48 },
  ])('$shelves shelves', ({ shelves, expected }) => {
    it(`needs ${expected} bolt + nut pairs`, () => {
      const lines = fastenerLines(priced(config({ shelves })).bom);
      expect(lines).toHaveLength(1);
      expect(lines[0].quantity).toBe(expected);
    });

    it('shows exactly one grouped fastener row publicly, with the same quantity', () => {
      const publicBom = toPublicBom(priced(config({ shelves })).bom, 'ms-standard');
      const lines = fastenerLines(publicBom);
      expect(lines).toHaveLength(1);
      expect(lines[0].name).toBe(FASTENER_KIT_NAME);
      expect(lines[0].quantity).toBe(expected);
    });
  });

  it('applies the formula per section, as the existing rule did', () => {
    const lines = fastenerLines(priced(config({ shelves: 4, sections: [section(1000), section(1200)] })).bom);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(32 * 2);

    const three = fastenerLines(priced(config({ shelves: 5, sections: [section(700), section(1000), section(1200)] })).bom);
    expect(three[0].quantity).toBe(36 * 3);
  });

  it('has no separate bolt or nut row in the public composition', () => {
    const publicBom = toPublicBom(priced(config({ shelves: 5, sections: [section(1000), section(1200)] })).bom, 'ms-standard');
    const others = publicBom.filter((l) => l.type !== 'FASTENER');
    expect(others.some((l) => /болт/i.test(l.name))).toBe(false);
    expect(others.some((l) => /гайк/i.test(l.name))).toBe(false);
    expect(publicBom.some((l) => l.name === 'Болт' || l.name === 'Гайка')).toBe(false);
  });

  describe('server pricing', () => {
    it('counts the fastener kit once per pair — the generic rule is not added on top', () => {
      const result = priced(config({ shelves: 6 }));
      const [line] = fastenerLines(result.bom);

      expect(fastenerLines(result.bom)).toHaveLength(1);
      expect(line.quantity).toBe(40);
    });

    it('carries no separate fastener charge for MS Standard — the bolts are in the supplier kit price', () => {
      const fastener = catalog.components.find((c) => c.id === 'fastener-generic')!;
      const [line] = fastenerLines(priced(config({ shelves: 6 })).bom);

      // The catalog row keeps its own price (other models still charge it)…
      expect(fastener.sellingPrice).toBeGreaterThan(0);
      expect(fastener.purchasePrice).toBeGreaterThan(0);
      // …but for MS Standard the bolt/nut sets are already inside the
      // approved upright/shelf price, so the BOM line adds nothing on top.
      expect(line.unitPrice).toBe(0);
      expect(line.totalPrice).toBe(0);
      expect(line.unitCost).toBe(0);
      expect(line.weightKg).toBeGreaterThan(0);
    });

    it('keeps componentsSubtotal equal to the sum of the internal BOM and of the public rows', () => {
      const result = priced(config({ shelves: 5, sections: [section(700), section(1000)] }));
      const internal = result.bom.reduce((s, l) => s + l.totalPrice, 0);
      const pub = toPublicBom(result.bom, 'ms-standard').reduce((s, l) => s + l.totalPrice, 0);
      expect(result.breakdown.componentsSubtotal).toBe(internal);
      expect(pub).toBe(internal);
    });

    it('prices identically on repeated calls', () => {
      const cfg = config({ shelves: 7 });
      expect(priced(cfg).breakdown).toEqual(priced(cfg).breakdown);
    });

    it('leaves other models on the generic fastener rule', () => {
      const strong = priced(
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
      // rule-fastener: shelves * sections * 8 + sections * 16
      expect(fastenerLines(strong.bom)[0].quantity).toBe(4 * 8 + 16);
    });
  });

  describe('model-specific rule selection', () => {
    it('uses a model-scoped rule instead of the generic rule for the same component', () => {
      const rules = catalog.rules.filter((r) => r.componentType === 'FASTENER');
      expect(rules.map((r) => r.id).sort()).toEqual(['rule-fastener', 'rule-fastener-ms-standard']);

      const bom = buildBom(config({ shelves: 3 }), catalog);
      expect(fastenerLines(bom.lines)).toEqual([expect.objectContaining({ quantity: 28 })]);
    });

    it('maps a database rule model id to its slug so the model-scoped rule applies in Postgres mode', () => {
      const row = {
        id: 'rule-fastener-ms-standard',
        modelId: 'cm0dbmodelid',
        componentType: 'FASTENER',
        name: 'Крепёж MS Стандарт (болт + гайка)',
        formula: '(24 + (shelves - 2) * 4) * sections',
        condition: null,
        priority: 0,
        active: true,
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const slugs = new Map([['cm0dbmodelid', 'ms-standard']]);
      expect(toRule(row as Parameters<typeof toRule>[0], slugs).models).toEqual(['ms-standard']);
      expect(toRule({ ...row, modelId: null } as Parameters<typeof toRule>[0], slugs).models).toEqual([]);
      // An unknown model id never widens a scoped rule to every model.
      expect(toRule({ ...row, modelId: 'gone' } as Parameters<typeof toRule>[0], slugs).models).toEqual(['gone']);
    });
  });

  describe('historical order snapshots', () => {
    beforeEach(() => {
      clearMemoryOrders();
    });

    it('keep the fastener quantity, name and price they were placed with', async () => {
      const cfg = config({ shelves: 5 });
      const current = priced(cfg);
      // Snapshot as persisted under the previous formula (8 per shelf + 16).
      const legacyFastener = {
        componentId: 'fastener-generic',
        sku: 'FST-LEGACY',
        type: 'FASTENER' as const,
        name: 'Комплект крепежа (болт+гайка)',
        quantity: 56,
        unitPrice: 120,
        totalPrice: 6720,
        weightKg: 2.8,
      };
      const legacyBom = [
        ...current.bom.filter((l) => l.type !== 'FASTENER').map(({ unitCost: _unitCost, ...rest }) => rest),
        legacyFastener,
      ];
      const legacyBreakdown = { ...current.breakdown, componentsSubtotal: 249060, net: 303853, vat: 48616, total: 352469 };
      const order: OrderRecord = {
        id: 'order-legacy-fasteners',
        orderNumber: 'MS-20260801-LEGAC',
        status: 'NEW',
        customer: { fullName: 'Тест', phone: '+77001234567', city: 'Алматы', type: 'INDIVIDUAL' },
        paymentPreference: 'BANK_TRANSFER',
        items: [{ configuration: cfg, bom: legacyBom, breakdown: legacyBreakdown, modelName: 'MS Стандарт' }],
        netTotal: 303853,
        vatTotal: 48616,
        discountTotal: 0,
        grandTotal: 352469,
        createdAt: '2026-08-01T10:00:00.000Z',
      };
      const before = JSON.stringify(order);
      await saveOrder(order);

      // Re-pricing the same configuration today uses the new formula…
      expect(fastenerLines(priced(cfg).bom)[0].quantity).toBe(36);

      // …while the stored order is returned exactly as it was placed.
      const saved = await getOrderByNumber(order.orderNumber);
      expect(JSON.stringify(saved)).toBe(before);
      expect(fastenerLines(saved!.items[0].bom)[0]).toEqual(legacyFastener);
      expect(saved!.grandTotal).toBe(352469);
    });
  });
});
