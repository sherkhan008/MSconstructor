import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as ordersPost } from '@/app/api/orders/route';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { clearMemoryOrders, countMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { findAccessory, findComponent, getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { buildBom, calculatePrice, parseConfiguration, toPublicPriceResult } from '@/lib/pricing';
import { buildSectionBom } from '@/lib/pricing/bom';
import { buildOrderDocumentContent } from '@/lib/documents/build';
import type { OrderDocumentSource } from '@/lib/documents/order-source';
import { buildWhatsAppTemplateParameters } from '@/lib/notifications/providers/whatsapp';
import { buildOrderEvent, formatOrderEventText } from '@/lib/notifications/events';
import { whatsAppConfiguratorUrl } from '@/lib/whatsapp';
import { useCartStore } from '@/store/cart-store';
import type { OrderRecord } from '@/lib/orders/types';
import type { BomLine, ComponentType, PriceResult, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * Configurator V2.2B — every section is physically independent.
 *
 * Owner-approved rule: adjacent sections never share an upright; every
 * section stands on its own 4 uprights (1 section → 4, 2 → 8, 3 → 12,
 * 5 → 20), and the BOM is built per section from that section's own width,
 * height, shelf count and walls, then aggregated by catalog component.
 *
 * Evidence, from three independent directions:
 *
 *  1. tests/fixtures/pricing-golden-v2.2b.json — representative single,
 *     uniform multi-section and mixed configurations (plus expected
 *     failures), captured from the V2.2B engine. Every amount is
 *     reproducible from the committed src/lib/data/seed-data.ts (no purchase
 *     cost, no private supplier data).
 *  2. Every successful fixture case is re-derived WITHOUT the configuration
 *     rules: 4 uprights of the section's own height per section, the
 *     section's own shelves, walls from its own flags, each at the catalog
 *     component's own selling price — so the golden values are not merely
 *     the engine agreeing with itself.
 *  3. Every multi-section case of the historical V2.1 fixture
 *     (tests/fixtures/pricing-golden-v2.1.json, kept unchanged) is compared
 *     line by line: every difference is exactly the upright/frame change and
 *     nothing else moved.
 */

const HELPER_TYPES = new Set<BomLine['type']>(['BEAM_LONGITUDINAL', 'BEAM_DEPTH', 'TIE', 'FASTENER', 'FOOT', 'CONNECTOR']);
/** The parts whose quantity V2.2B changes: the frame shared between neighbours before. */
const FRAME_CHANGED_TYPES = new Set<BomLine['type']>(['UPRIGHT', 'TIE', 'FOOT', 'CONNECTOR']);

interface GoldenCase {
  name: string;
  config: ShelvingConfiguration;
  outcome: Record<string, unknown> & { ok: boolean };
}

interface V21Case {
  name: string;
  config: Record<string, unknown> & { height: number; shelves: number; sections: Record<string, unknown>[] };
  outcome: Record<string, unknown> & {
    ok: boolean;
    bom: Omit<BomLine, 'unitCost'>[];
    breakdown: { componentsSubtotal: number; total: number };
    totalWeightKg: number;
  };
}

const V22B_PATH = 'tests/fixtures/pricing-golden-v2.2b.json';
const GOLDEN: GoldenCase[] = JSON.parse(readFileSync(V22B_PATH, 'utf8'));
const V21: V21Case[] = JSON.parse(readFileSync('tests/fixtures/pricing-golden-v2.1.json', 'utf8'));

function outcomeOf(result: ReturnType<typeof calculatePrice>) {
  return result.ok
    ? {
        ok: true,
        breakdown: result.breakdown,
        bom: result.bom.map(({ unitCost: _unitCost, ...line }) => line),
        totalWeightKg: result.totalWeightKg,
        rowLengthMm: result.rowLengthMm,
        leadTimeDays: result.leadTimeDays,
        warnings: result.warnings,
        deliveryNote: result.deliveryNote,
      }
    : { ok: false, code: result.code, message: result.message, details: result.details ?? null };
}

function priced(config: unknown, catalog: Catalog): PriceResult {
  const result = calculatePrice(config, catalog);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

let sectionCounter = 0;
function sec(width: number, height: number, shelves: number, walls: Partial<ShelvingSection> = {}): ShelvingSection {
  sectionCounter += 1;
  return { id: `v22b-${sectionCounter}`, width, height, shelves, rearWall: false, leftWall: false, rightWall: false, ...walls };
}

function config(sections: ShelvingSection[], overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections,
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

/** The owner's example: 1000 × 1500 / 4 shelves next to 1200 × 2500 / 8 shelves. */
const ownerExample = () => config([sec(1000, 1500, 4), sec(1200, 2500, 8)]);

const qtyOf = (bom: Pick<BomLine, 'type' | 'quantity'>[], type: BomLine['type']) =>
  bom.filter((l) => l.type === type).reduce((sum, l) => sum + l.quantity, 0);

/** componentId → summed quantity / price / weight — the aggregation-invariant view of a BOM. */
function byComponent(lines: Pick<BomLine, 'componentId' | 'quantity' | 'totalPrice' | 'weightKg'>[]) {
  const map = new Map<string, { quantity: number; totalPrice: number; weightKg: number }>();
  for (const line of lines) {
    const entry = map.get(line.componentId) ?? { quantity: 0, totalPrice: 0, weightKg: 0 };
    entry.quantity += line.quantity;
    entry.totalPrice += line.totalPrice;
    entry.weightKg = Math.round((entry.weightKg + line.weightKg) * 1000) / 1000;
    map.set(line.componentId, entry);
  }
  return map;
}

describe('V2.2B — golden fixture (per-section BOM, independent uprights)', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('covers single, uniform multi-section, mixed and failing configurations and holds no purchase cost', () => {
    const ok = GOLDEN.filter((g) => g.outcome.ok);
    expect(ok.filter((g) => g.config.sections.length === 1).length).toBeGreaterThanOrEqual(10);
    const multi = ok.filter((g) => g.config.sections.length > 1);
    expect(multi.map((g) => g.config.sections.length)).toEqual(expect.arrayContaining([2, 3, 5]));
    const mixedHeights = multi.filter((g) => new Set(g.config.sections.map((s) => s.height)).size > 1);
    const mixedShelves = multi.filter((g) => new Set(g.config.sections.map((s) => s.shelves)).size > 1);
    const mixedWidths = multi.filter((g) => new Set(g.config.sections.map((s) => s.width)).size > 1);
    expect(mixedHeights.length).toBeGreaterThanOrEqual(3);
    expect(mixedShelves.length).toBeGreaterThanOrEqual(3);
    expect(mixedWidths.length).toBeGreaterThanOrEqual(3);
    expect(GOLDEN.filter((g) => !g.outcome.ok).length).toBeGreaterThanOrEqual(3);
    expect(readFileSync(V22B_PATH, 'utf8')).not.toMatch(/unitCost|purchasePrice|supplierRef/);
  });

  it.each(GOLDEN.map((g) => [g.name, g] as const))('%s', (_name, golden) => {
    expect(outcomeOf(calculatePrice(golden.config, catalog))).toEqual(golden.outcome);
  });
});

describe('V2.2B — every golden case re-derived from the catalog, without the rules', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  const successes = GOLDEN.filter((g) => g.outcome.ok).map((g) => [g.name, g.config] as const);

  it.each(successes)('%s — 4 uprights of its own height per section', (_name, cfg) => {
    const result = priced(cfg, catalog);
    expect(qtyOf(result.bom, 'UPRIGHT')).toBe(4 * cfg.sections.length);
    for (const height of new Set(cfg.sections.map((s) => s.height))) {
      const upright = findComponent(catalog, { type: 'UPRIGHT', modelSlug: cfg.modelSlug, height, depth: cfg.depth, loadCapacity: cfg.loadCapacity, shelfType: cfg.shelfType });
      const line = result.bom.find((l) => l.componentId === upright?.id);
      expect(line?.quantity, `uprights of height ${height}`).toBe(4 * cfg.sections.filter((s) => s.height === height).length);
    }
    expect(result.bom.some((l) => l.type === 'CONNECTOR')).toBe(false);
  });

  it.each(successes)('%s — each section\'s own shelves, at its own width', (_name, cfg) => {
    const result = priced(cfg, catalog);
    expect(qtyOf(result.bom, 'SHELF')).toBe(cfg.sections.reduce((sum, s) => sum + s.shelves, 0));
    for (const width of new Set(cfg.sections.map((s) => s.width))) {
      const shelf = findComponent(catalog, { type: 'SHELF', modelSlug: cfg.modelSlug, width, depth: cfg.depth, loadCapacity: cfg.loadCapacity, shelfType: cfg.shelfType });
      const line = result.bom.find((l) => l.componentId === shelf?.id);
      expect(line?.quantity, `shelves of width ${width}`).toBe(
        cfg.sections.filter((s) => s.width === width).reduce((sum, s) => sum + s.shelves, 0),
      );
    }
    expect(result.rowLengthMm).toBe(cfg.sections.reduce((sum, s) => sum + s.width, 0));
  });

  it.each(successes)('%s — BOM price is the sum of authoritative component prices, no surcharge', (_name, cfg) => {
    const result = priced(cfg, catalog);
    for (const line of result.bom) {
      if (line.type === 'ACCESSORY') {
        const accessory = findAccessory(catalog, line.componentId)!;
        expect(line.unitPrice, line.sku).toBe(accessory.unitPrice);
      } else {
        const component = catalog.components.find((c) => c.id === line.componentId)!;
        const ownedByKit = cfg.modelSlug === 'ms-standard' && HELPER_TYPES.has(line.type);
        expect(line.unitPrice, line.sku).toBe(ownedByKit ? 0 : component.sellingPrice);
      }
      expect(line.totalPrice, line.sku).toBe(line.unitPrice * line.quantity);
    }
    expect(result.breakdown.componentsSubtotal).toBe(result.bom.reduce((sum, l) => sum + l.totalPrice, 0));
  });

  it.each(successes.filter(([, cfg]) => cfg.modelSlug === 'ms-standard'))(
    '%s — MS Standard merchandise = Σ sections (4 uprights + own shelves + own walls) + accessories',
    (_name, cfg) => {
      const lookup = (type: ComponentType, section: ShelvingSection, withWidth: boolean) =>
        findComponent(catalog, {
          type,
          modelSlug: cfg.modelSlug,
          height: section.height,
          width: withWidth ? section.width : undefined,
          depth: cfg.depth,
          loadCapacity: cfg.loadCapacity,
          shelfType: cfg.shelfType,
          variant: type === 'REAR_WALL' || type === 'SIDE_WALL' ? 'SOLID' : undefined,
        })!.sellingPrice;

      const expected =
        cfg.sections.reduce(
          (sum, s) =>
            sum +
            4 * lookup('UPRIGHT', s, false) +
            s.shelves * lookup('SHELF', s, true) +
            (s.rearWall ? lookup('REAR_WALL', s, true) : 0) +
            ((s.leftWall ? 1 : 0) + (s.rightWall ? 1 : 0)) * (s.leftWall || s.rightWall ? lookup('SIDE_WALL', s, true) : 0),
          0,
        ) + cfg.accessories.reduce((sum, a) => sum + findAccessory(catalog, a.accessoryId)!.unitPrice * a.quantity, 0);

      expect(priced(cfg, catalog).breakdown.componentsSubtotal).toBe(expected);
    },
  );

  it.each(successes)('%s — the kit BOM is exactly the sum of its sections priced alone', (_name, cfg) => {
    const kit = buildBom(cfg, catalog);
    const alone = cfg.sections.flatMap((s) => buildBom({ ...cfg, sections: [s], accessories: [] }, catalog).lines);
    const structural = kit.lines.filter((l) => l.type !== 'ACCESSORY');
    expect(byComponent(structural)).toEqual(byComponent(alone));
  });
});

describe('V2.2B — uprights: 4 per section, never shared', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it.each([
    [1, 4],
    [2, 8],
    [3, 12],
    [5, 20],
  ])('%i section(s) → %i uprights', (sections, uprights) => {
    const result = priced(config(Array.from({ length: sections }, () => sec(1000, 2000, 5))), catalog);
    expect(qtyOf(result.bom, 'UPRIGHT')).toBe(uprights);
    expect(result.bom.some((l) => l.type === 'CONNECTOR')).toBe(false);
  });

  it('every section\'s own BOM carries exactly 4 uprights, whatever its neighbours', () => {
    const cfg = config([sec(700, 1000, 2), sec(1000, 1500, 6), sec(1200, 2000, 8), sec(1500, 2500, 5), sec(1000, 3000, 8)]);
    for (const section of cfg.sections) {
      const sectionBom = buildSectionBom(cfg, section, catalog);
      expect(sectionBom.missingCritical).toBe(false);
      expect(qtyOf(sectionBom.frameLines, 'UPRIGHT')).toBe(4);
      expect(sectionBom.frameLines.some((l) => l.type === 'CONNECTOR')).toBe(false);
    }
  });

  it('a section prices the same wherever it stands in the row', () => {
    const a = sec(1000, 1500, 4);
    const b = sec(1200, 2500, 8);
    const c = sec(700, 2000, 5);
    const forward = priced(config([a, b, c]), catalog);
    const reversed = priced(config([c, b, a]), catalog);
    expect(reversed.breakdown).toEqual(forward.breakdown);
    expect(byComponent(reversed.bom)).toEqual(byComponent(forward.bom));
  });

  it('a uniform N-section row costs N single sections in merchandise', () => {
    const single = priced(config([sec(1000, 2000, 5)]), catalog).breakdown.componentsSubtotal;
    for (const n of [2, 3, 5]) {
      const row = priced(config(Array.from({ length: n }, () => sec(1000, 2000, 5))), catalog);
      expect(row.breakdown.componentsSubtotal).toBe(n * single);
    }
  });
});

describe('V2.2B — per-section BOM and aggregation', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('prices the owner example from each section\'s own dimensions', () => {
    const result = priced(ownerExample(), catalog);
    const line = (id: string) => result.bom.find((l) => l.componentId === id);
    expect(line('upright-1500-STANDARD')?.quantity).toBe(4);
    expect(line('upright-2500-STANDARD')?.quantity).toBe(4);
    expect(line('shelf-STANDARD-1000-400')?.quantity).toBe(4);
    expect(line('shelf-STANDARD-1200-400')?.quantity).toBe(8);
    // No fake row-level height or shelf count: no 2500 upright for the
    // 1500 section, no 8 shelves for the 4-shelf section.
    expect(qtyOf(result.bom, 'UPRIGHT')).toBe(8);
    expect(qtyOf(result.bom, 'SHELF')).toBe(12);
  });

  it('mixed heights keep one upright line per height; identical parts merge', () => {
    const result = priced(config([sec(1000, 1500, 4), sec(1000, 2500, 4), sec(1000, 1500, 4)]), catalog);
    const uprights = result.bom.filter((l) => l.type === 'UPRIGHT');
    expect(uprights.map((l) => [l.componentId, l.quantity])).toEqual([
      ['upright-1500-STANDARD', 8],
      ['upright-2500-STANDARD', 4],
    ]);
    // One aggregated line per component — never two lines for the same part.
    const ids = result.bom.map((l) => l.componentId);
    expect(new Set(ids).size).toBe(ids.length);
    const shelf = result.bom.filter((l) => l.type === 'SHELF');
    expect(shelf).toHaveLength(1);
    expect(shelf[0].quantity).toBe(12);
  });

  it('aggregated lines sum the sections\' own quantity, price and weight', () => {
    const cfg = config([sec(1000, 2000, 3), sec(1000, 2000, 5), sec(1000, 2000, 7)]);
    const sectionLines = cfg.sections.flatMap((s) => {
      const b = buildSectionBom(cfg, s, catalog);
      return [...b.frameLines, ...b.widthLines];
    });
    const kit = buildBom(cfg, catalog).lines;
    const shelf = kit.find((l) => l.type === 'SHELF')!;
    expect(shelf.quantity).toBe(3 + 5 + 7);
    const fromSections = sectionLines.filter((l) => l.componentId === shelf.componentId);
    expect(fromSections).toHaveLength(3);
    expect(shelf.totalPrice).toBe(fromSections.reduce((s, l) => s + l.totalPrice, 0));
    expect(shelf.weightKg).toBeCloseTo(fromSections.reduce((s, l) => s + l.weightKg, 0), 6);
    expect(shelf.unitPrice).toBe(fromSections[0].unitPrice);
  });

  it('mixed shelf counts are priced shelf by shelf', () => {
    const three = priced(config([sec(1000, 2000, 3), sec(1000, 2000, 3)]), catalog);
    const mixed = priced(config([sec(1000, 2000, 3), sec(1000, 2000, 7)]), catalog);
    const shelfPrice = three.bom.find((l) => l.type === 'SHELF')!.unitPrice;
    expect(mixed.breakdown.componentsSubtotal - three.breakdown.componentsSubtotal).toBe(4 * shelfPrice);
  });

  it('mixed heights are priced upright by upright', () => {
    const low = priced(config([sec(1000, 1500, 4), sec(1000, 1500, 4)]), catalog);
    const mixed = priced(config([sec(1000, 1500, 4), sec(1000, 2500, 4)]), catalog);
    const price = (id: string) => catalog.components.find((c) => c.id === id)!.sellingPrice;
    expect(mixed.breakdown.componentsSubtotal - low.breakdown.componentsSubtotal).toBe(
      4 * (price('upright-2500-STANDARD') - price('upright-1500-STANDARD')),
    );
  });

  it('each section is checked against its own width/height/shelf limits and the shared depth', () => {
    // 1500 mm width supports depth 400 but not 700; 1000 mm height allows at most 4 shelves.
    const badDepth = calculatePrice(config([sec(1000, 2000, 5), sec(1500, 2000, 5)], { depth: 700 }), catalog);
    expect(badDepth.ok).toBe(false);
    if (!badDepth.ok) expect(badDepth.code).toBe('INCOMPATIBLE_CONFIGURATION');
    const badShelves = calculatePrice(config([sec(1000, 2000, 8), sec(1000, 1000, 5)]), catalog);
    expect(badShelves.ok).toBe(false);
    if (!badShelves.ok) expect(badShelves.code).toBe('INCOMPATIBLE_CONFIGURATION');
  });
});

describe('V2.2B vs the historical V2.1 fixture — only the independent frame changed', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  const toV2 = ({ height, shelves, sections, ...rest }: V21Case['config']) =>
    ({ ...rest, sections: sections.map((s) => ({ ...s, height, shelves })) }) as unknown as ShelvingConfiguration;

  const multi = V21.filter((g) => g.outcome.ok && g.config.sections.length > 1);

  it('the historical fixture still has its multi-section cases', () => {
    expect(multi.length).toBeGreaterThanOrEqual(10);
  });

  it.each(multi.map((g) => [g.name, g] as const))('%s', (_name, golden) => {
    const cfg = toV2(golden.config);
    const n = cfg.sections.length;
    const old = golden.outcome;
    const next = priced(cfg, catalog);

    // Everything but the frame is unchanged, line for line. (Weights are
    // compared on a milligram grid: V2.1 summed merged weights with raw
    // floating-point noise such as 14.399999999999999, V2.2B strips it.)
    const unchanged = (bom: Omit<BomLine, 'unitCost'>[]) =>
      bom
        .filter((l) => !FRAME_CHANGED_TYPES.has(l.type))
        .map((l) => ({ ...l, weightKg: Math.round(l.weightKg * 1e6) / 1e6 }));
    expect(unchanged(next.bom.map(({ unitCost: _u, ...l }) => l))).toEqual(unchanged(old.bom));

    // The removed V2.1 behaviour: (sections + 1) × 2 shared uprights and a
    // connector between every pair of neighbours…
    expect(qtyOf(old.bom, 'UPRIGHT')).toBe((n + 1) * 2);
    expect(qtyOf(old.bom, 'CONNECTOR')).toBe(n - 1);
    // …replaced by 4 uprights per section and no shared-upright connector.
    expect(qtyOf(next.bom, 'UPRIGHT')).toBe(4 * n);
    expect(qtyOf(next.bom, 'CONNECTOR')).toBe(0);
    // Ties and feet follow the same per-section frame: n × one section's own.
    const one = priced({ ...cfg, sections: [cfg.sections[0]], accessories: [] }, catalog);
    expect(qtyOf(next.bom, 'TIE')).toBe(n * qtyOf(one.bom, 'TIE'));
    expect(qtyOf(next.bom, 'FOOT')).toBe(n * qtyOf(one.bom, 'FOOT'));

    // The merchandise difference is exactly the frame lines' difference.
    const frameTotal = (bom: Pick<BomLine, 'type' | 'totalPrice'>[]) =>
      bom.filter((l) => FRAME_CHANGED_TYPES.has(l.type)).reduce((s, l) => s + l.totalPrice, 0);
    expect(next.breakdown.componentsSubtotal - old.breakdown.componentsSubtotal).toBe(frameTotal(next.bom) - frameTotal(old.bom));

    // MS Standard: ties/feet/connectors are inside the upright price, so
    // the change is exactly the extra uprights at the upright price.
    if (cfg.modelSlug === 'ms-standard') {
      const uprightPrice = next.bom.find((l) => l.type === 'UPRIGHT')!.unitPrice;
      expect(next.breakdown.componentsSubtotal - old.breakdown.componentsSubtotal).toBe((4 * n - (n + 1) * 2) * uprightPrice);
      expect(next.breakdown.total).toBeGreaterThan(old.breakdown.total);
    }
  });
});

describe('V2.2B — single-section prices are unchanged from V2.1', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  const pairs = [
    ['single-H1000-S2', 'H1000-S2'],
    ['single-H1000-S4', 'H1000-S4'],
    ['single-H1500-S6', 'H1500-S6'],
    ['single-H2500-S8', 'H2500-S8'],
    ['single-H3000-S2', 'H3000-S2'],
    ['single-H3000-S8', 'H3000-S8'],
    ['single-W700-D300', 'W700-D300'],
    ['single-W1200-D600', 'W1200-D600'],
    ['single-W1500-D400', 'W1500-D400'],
  ] as const;

  it.each(pairs)('%s equals V2.1 %s', (v22bName, v21Name) => {
    const v22b = GOLDEN.find((g) => g.name === v22bName)!;
    const v21 = V21.find((g) => g.name === v21Name)!;
    const result = priced(v22b.config, catalog);
    expect(result.breakdown).toEqual(v21.outcome.breakdown);
    expect(result.bom.map(({ unitCost: _u, ...l }) => l)).toEqual(v21.outcome.bom);
  });
});

let ipCounter = 0;
function post(handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown): Promise<Response> {
  ipCounter += 1;
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.23.0.${ipCounter}` },
      body: JSON.stringify(body),
    }),
  );
}

function orderBody(configurations: unknown[]) {
  return {
    fullName: 'Тест Тестов',
    phone: '+77001234567',
    email: 'test@example.com',
    city: 'Алматы',
    customerType: 'INDIVIDUAL',
    paymentPreference: 'BANK_TRANSFER',
    items: configurations.map((configuration) => ({ configuration })),
  };
}

const LEAK = /unitCost|purchasePrice|purchase|supplierRef|markup|наценк|margin|internalNotes|internalWarnings|internalDetails/i;

describe('V2.2B — pricing API with a mixed configuration', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('POST /api/pricing/calculate prices the mixed row on the server, without leaking internals', async () => {
    const cfg = ownerExample();
    const response = await post(pricingPost, '/api/pricing/calculate', cfg);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    const text = JSON.stringify(json);
    expect(text).toContain(String(priced(cfg, catalog).breakdown.total));
    expect(text).not.toMatch(LEAK);
  });

  it('ignores any total the browser sends', async () => {
    const cfg = ownerExample();
    const response = await post(pricingPost, '/api/pricing/calculate', { ...cfg, total: 1, breakdown: { total: 1 } });
    const json = await response.json();
    expect(JSON.stringify(json)).toContain(String(priced(cfg, catalog).breakdown.total));
  });

  it('still refuses a forged invalid mixed configuration with no price', async () => {
    const forged = config([sec(1000, 2000, 5), sec(1000, 1000, 6)]);
    const response = await post(pricingPost, '/api/pricing/calculate', forged);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/"total"|breakdown/);
  });

  it('the public result of a mixed row exposes no purchase cost', () => {
    const publicResult = toPublicPriceResult(priced(ownerExample(), catalog));
    expect(JSON.stringify(publicResult)).not.toMatch(/unitCost|purchasePrice|supplierRef|markup/);
  });
});

describe('V2.2B — order API with mixed configurations', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });
  beforeEach(() => clearMemoryOrders());

  it('accepts a mixed configuration and stores the server price and each section as built', async () => {
    const cfg = ownerExample();
    const response = await post(ordersPost, '/api/orders', orderBody([{ ...cfg, total: 1 }]));
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(countMemoryOrders()).toBe(1);

    const expected = priced(cfg, catalog);
    const order = (await getOrderByNumber(json.data?.orderNumber ?? json.orderNumber))!;
    expect(order.grandTotal).toBe(expected.breakdown.total);
    expect(order.items[0].breakdown).toEqual(expected.breakdown);
    expect(order.items[0].configuration.sections.map((s) => [s.width, s.height, s.shelves])).toEqual([
      [1000, 1500, 4],
      [1200, 2500, 8],
    ]);
    expect(qtyOf(order.items[0].bom, 'UPRIGHT')).toBe(8);
    expect(JSON.stringify(order.items[0].bom)).not.toMatch(/unitCost|purchasePrice/);
  });

  it('accepts a mixed line next to a uniform line', async () => {
    const uniform = config([sec(1000, 2000, 5), sec(1000, 2000, 5)]);
    const response = await post(ordersPost, '/api/orders', orderBody([uniform, ownerExample()]));
    expect(response.status).toBe(201);
    expect(countMemoryOrders()).toBe(1);
  });

  it('still refuses a forged invalid mixed line and creates NO order', async () => {
    const forged = config([sec(1000, 2000, 5), sec(1000, 1700, 5)]);
    const response = await post(ordersPost, '/api/orders', orderBody([ownerExample(), forged]));
    expect(response.ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });

  it('still enforces Σ quantity ≤ 5 physical racks for mixed configurations', async () => {
    const ok = await post(ordersPost, '/api/orders', orderBody([{ ...ownerExample(), quantity: 2 }, { ...ownerExample(), quantity: 3 }]));
    expect(ok.status).toBe(201);
    clearMemoryOrders();
    const tooMany = await post(ordersPost, '/api/orders', orderBody([{ ...ownerExample(), quantity: 3 }, { ...ownerExample(), quantity: 3 }]));
    expect(tooMany.ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });

  it('still enforces the 5-section limit for mixed configurations', async () => {
    const heights = [1000, 1500, 2000, 2500, 3000];
    const five = config(heights.map((h) => sec(1000, h, 3)));
    expect(parseConfiguration(five).success).toBe(true);
    const six = config([...heights, 1800].map((h) => sec(1000, h, 3)));
    expect(parseConfiguration(six).success).toBe(false);
    const response = await post(ordersPost, '/api/orders', orderBody([six]));
    expect(response.ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });
});

describe('V2.2B — cart holds mixed configurations under the same kit limit', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });
  beforeEach(() => useCartStore.setState({ items: [] }));

  it('adds a priced mixed configuration and still refuses the sixth rack', () => {
    const cfg = ownerExample();
    const snapshot = toPublicPriceResult(priced(cfg, catalog));
    const add = (quantity: number) =>
      useCartStore.getState().addItem({
        modelSlug: 'ms-standard',
        modelName: 'MS Standard',
        configuration: { ...cfg, quantity },
        priceSnapshot: snapshot,
      });
    expect(add(3).ok).toBe(true);
    expect(add(2).ok).toBe(true);
    expect(add(1)).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(useCartStore.getState().items[0].configuration.sections.map((s) => s.height)).toEqual([1500, 2500]);
  });
});

describe('V2.2B — documents, WhatsApp and notifications for an ordered mixed row', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });
  beforeEach(() => clearMemoryOrders());

  async function placeMixedOrder(): Promise<OrderRecord> {
    const response = await post(ordersPost, '/api/orders', orderBody([ownerExample()]));
    const json = await response.json();
    expect(response.status).toBe(201);
    return (await getOrderByNumber(json.data?.orderNumber ?? json.orderNumber))!;
  }

  function documentSource(order: OrderRecord): OrderDocumentSource {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: new Date(order.createdAt),
      paymentPreference: order.paymentPreference,
      delivery: { methodId: order.items[0].configuration.deliveryId, address: null, city: order.customer.city, floor: null, hasLift: null, date: null },
      netTotal: order.netTotal,
      vatTotal: order.vatTotal,
      discountTotal: order.discountTotal,
      grandTotal: order.grandTotal,
      buyerSnapshot: order.buyerSnapshot,
      items: order.items.map((item, i) => ({
        id: `item-${i}`,
        configuration: item.configuration,
        documentSnapshot: item.documentSnapshot,
        quantity: item.configuration.quantity,
        unitNetPrice: item.breakdown.unitNet,
        totalNetPrice: item.breakdown.net,
      })),
    };
  }

  it('commercial documents state each section\'s own height and shelves and the per-section kit', async () => {
    const order = await placeMixedOrder();
    const content = buildOrderDocumentContent(documentSource(order));
    const specs = Object.fromEntries(content.items[0].specs.map((f) => [f.label, f.value]));
    expect(specs['Высота']).toBe('1500 / 2500 мм');
    expect(specs['Полок']).toBe('4 / 8');
    expect(specs['Секций']).toBe('2');
    const kitUprights = content.items[0].kit.filter((l) => /стойк/i.test(l.name)).reduce((s, l) => s + l.quantity, 0);
    expect(kitUprights).toBe(8);
    // Document money is bigint tiyn — serialize it as text for the scan.
    expect(JSON.stringify(content, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).not.toMatch(LEAK);
  });

  it('the WhatsApp template and event text stay within their privacy boundary', async () => {
    const order = await placeMixedOrder();
    const parameters = buildWhatsAppTemplateParameters(order);
    expect(parameters).toHaveLength(6);
    expect(parameters[0]).toBe(order.orderNumber);
    expect(parameters.join(' ')).not.toMatch(LEAK);
    expect(parameters.join(' ')).not.toContain('test@example.com');

    const eventText = formatOrderEventText(
      buildOrderEvent({ event: 'order.created', orderNumber: order.orderNumber, status: order.status, grandTotal: order.grandTotal }),
    );
    expect(eventText).toContain(order.orderNumber);
    expect(eventText).not.toMatch(LEAK);
    expect(eventText).not.toContain(order.customer.phone);
  });

  it('the customer WhatsApp configurator message lists each section\'s values, no cost', () => {
    const url = whatsAppConfiguratorUrl(toPublicPriceResult(priced(ownerExample(), catalog)), [], 'https://example.com/x', 'ru');
    const message = new URLSearchParams(url.split('?')[1] ?? '').get('text') ?? '';
    expect(message).toContain('Высота: 1500 / 2500 мм');
    expect(message).toContain('Полок: 4 / 8');
    expect(message).not.toMatch(LEAK);
  });
});
