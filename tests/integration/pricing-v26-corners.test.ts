import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as ordersPost } from '@/app/api/orders/route';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { clearMemoryOrders, countMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice, parseConfiguration, toPublicPriceResult } from '@/lib/pricing';
import { buildSectionBom } from '@/lib/pricing/bom';
import { whatsAppConfiguratorUrl, whatsAppWorkspaceUrl } from '@/lib/whatsapp';
import { buildOrderDocumentContent, DocumentIntegrityError } from '@/lib/documents/build';
import { configuration, item, orderSource } from './helpers/order-document-fixtures';
import { useCartStore } from '@/store/cart-store';
import type { BomLine, PriceResult, SectionCorner, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * Configurator V2.6 — corner sections are the same sections, rotated.
 *
 * Owner-approved rule: orientation never changes the physical component list
 * or the price. For an otherwise identical configuration, the straight and the
 * corner variant must have exactly the same BOM (line by line), the same
 * breakdown and the same weight: 4 uprights per section, no extra upright,
 * shelf, connector, bracket or fastener, no surcharge, no corner component.
 */

let counter = 0;
function sec(width: number, height: number, shelves: number, extra: Partial<ShelvingSection> = {}): ShelvingSection {
  counter += 1;
  return { id: `v26-${counter}`, width, height, shelves, rearWall: false, leftWall: false, rightWall: false, corner: 'NONE', ...extra };
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

/** The same configuration with the first/last section turned into a corner. */
function withCorners(cfg: ShelvingConfiguration, left: boolean, right: boolean): ShelvingConfiguration {
  const last = cfg.sections.length - 1;
  return {
    ...cfg,
    sections: cfg.sections.map((s, i): ShelvingSection => {
      const corner: SectionCorner = left && i === 0 ? 'LEFT' : right && i === last ? 'RIGHT' : 'NONE';
      return { ...s, corner };
    }),
  };
}

function priced(cfg: unknown, catalog: Catalog): PriceResult {
  const result = calculatePrice(cfg, catalog);
  if (!result.ok) throw new Error(`${result.code}: ${result.message} ${JSON.stringify(result.details)}`);
  return result;
}

const qtyOf = (bom: Pick<BomLine, 'type' | 'quantity'>[], type: BomLine['type']) =>
  bom.filter((l) => l.type === type).reduce((sum, l) => sum + l.quantity, 0);

/** Representative configurations: single, multi, mixed heights and shelves, walls, accessories, 5 sections. */
function cases(): [string, ShelvingConfiguration][] {
  return [
    ['one section', config([sec(1000, 2000, 5)])],
    ['two sections', config([sec(1000, 2000, 5), sec(1200, 2000, 5)])],
    ['mixed heights', config([sec(1000, 1500, 4), sec(1200, 2500, 8), sec(700, 1000, 3)])],
    ['mixed shelves', config([sec(1000, 2000, 2), sec(1000, 2000, 8), sec(1000, 2000, 5)])],
    [
      'walls on every section',
      config([sec(1000, 2000, 5, { rearWall: true, leftWall: true }), sec(1200, 2000, 5, { rightWall: true }), sec(700, 1800, 4, { rearWall: true, rightWall: true })]),
    ],
    [
      'accessories (kit-wide and section-scoped)',
      (() => {
        const sections = [sec(1000, 2000, 5), sec(1000, 2000, 5), sec(1000, 2000, 5)];
        return config(sections, {
          accessories: [
            { accessoryId: 'acc-adjustable-feet', quantity: 1 },
            { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: sections[0].id },
            { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: sections[2].id },
          ],
        });
      })(),
    ],
    [
      'five sections, mixed, walls, quantity 2, depth 500',
      config(
        [sec(700, 1500, 4), sec(1000, 2000, 5, { rearWall: true }), sec(1200, 2200, 6), sec(1500, 2500, 8), sec(1000, 3000, 7, { leftWall: true })],
        { depth: 500, quantity: 2, assemblyId: 'assembly-professional' },
      ),
    ],
  ];
}

describe('V2.6 — corner orientation never changes the BOM or the price', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  for (const [name, straight] of cases()) {
    const variants: [string, boolean, boolean][] = [
      ['LEFT', true, false],
      ['RIGHT', false, true],
      ['LEFT + RIGHT', true, true],
    ];
    for (const [label, left, right] of variants) {
      if (left && right && straight.sections.length < 2) continue;
      it(`${name}: straight == ${label} (BOM line by line, breakdown, weight, row length)`, () => {
        const a = priced(straight, catalog);
        const cornered = withCorners(straight, left, right);
        const b = priced(cornered, catalog);
        expect(b.bom).toEqual(a.bom);
        expect(b.breakdown).toEqual(a.breakdown);
        expect(b.totalWeightKg).toBe(a.totalWeightKg);
        expect(b.rowLengthMm).toBe(a.rowLengthMm);
        expect(b.leadTimeDays).toBe(a.leadTimeDays);
        expect(b.warnings).toEqual(a.warnings);
        // The orientation is kept on the priced configuration, not dropped.
        expect(b.configuration.sections.map((s) => s.corner)).toEqual(cornered.sections.map((s) => s.corner));
      });
    }
  }

  it('every section still stands on exactly 4 of its own uprights — a corner adds none', () => {
    for (const n of [1, 2, 3, 5]) {
      const sections = Array.from({ length: n }, () => sec(1000, 2000, 5));
      const straight = priced(config(sections), catalog);
      const cornered = priced(withCorners(config(sections), true, n > 1), catalog);
      expect(qtyOf(straight.bom, 'UPRIGHT')).toBe(4 * n);
      expect(qtyOf(cornered.bom, 'UPRIGHT')).toBe(4 * n);
    }
  });

  it('a corner section has exactly the per-section BOM of the same straight section', () => {
    const straight = config([sec(1200, 2500, 8, { rearWall: true, rightWall: true })]);
    const left = withCorners(straight, true, false);
    const right = withCorners(straight, false, true);
    const bomOf = (cfg: ShelvingConfiguration) => buildSectionBom(cfg, cfg.sections[0], catalog);
    expect(bomOf(left)).toEqual(bomOf(straight));
    expect(bomOf(right)).toEqual(bomOf(straight));
  });

  it('no connector, extra bracket, fastener, shelf, surcharge or corner component appears', () => {
    const straight = config([sec(1000, 2000, 5), sec(1000, 2000, 5), sec(1000, 2000, 5)]);
    const a = priced(straight, catalog);
    const b = priced(withCorners(straight, true, true), catalog);
    for (const type of ['UPRIGHT', 'SHELF', 'CONNECTOR', 'FASTENER', 'TIE', 'FOOT', 'BEAM_LONGITUDINAL', 'BEAM_DEPTH', 'CROSS_BRACE'] as const) {
      expect(qtyOf(b.bom, type), type).toBe(qtyOf(a.bom, type));
    }
    // V2.2B's connector decision is unchanged: independent sections, no connector.
    expect(qtyOf(b.bom, 'CONNECTOR')).toBe(0);
    expect(b.bom.map((l) => l.componentId).sort()).toEqual(a.bom.map((l) => l.componentId).sort());
    expect(JSON.stringify(b.bom)).not.toMatch(/угл|corner/i);
    expect(b.breakdown.colorSurcharge).toBe(a.breakdown.colorSurcharge);
    expect(b.breakdown.componentsSubtotal).toBe(a.breakdown.componentsSubtotal);
  });

  it('the public result of a corner rack leaks nothing internal', () => {
    const text = JSON.stringify(toPublicPriceResult(priced(withCorners(config([sec(1000, 2000, 5), sec(1000, 2000, 5)]), true, true), catalog)));
    expect(text).not.toMatch(/unitCost|purchasePrice|supplierRef|markup|internalWarnings/);
  });
});

describe('V2.6 — server validation of corner placement', () => {
  const valid = (sections: ShelvingSection[]) => parseConfiguration(config(sections)).success;

  it('accepts straight, LEFT first, RIGHT last, LEFT + RIGHT (with or without sections between), and a lone corner', () => {
    expect(valid([sec(1000, 2000, 5)])).toBe(true);
    expect(valid([sec(1000, 2000, 5, { corner: 'LEFT' })])).toBe(true);
    expect(valid([sec(1000, 2000, 5, { corner: 'RIGHT' })])).toBe(true);
    expect(valid([sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5)])).toBe(true);
    expect(valid([sec(1000, 2000, 5), sec(1000, 2000, 5, { corner: 'RIGHT' })])).toBe(true);
    expect(valid([sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5, { corner: 'RIGHT' })])).toBe(true);
    expect(valid([sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5), sec(1000, 2000, 5, { corner: 'RIGHT' })])).toBe(true);
  });

  it('rejects a corner in a middle section, on the wrong edge, twice on one side, or more than two', () => {
    expect(valid([sec(1000, 2000, 5), sec(1000, 2000, 5, { corner: 'LEFT' })])).toBe(false);
    expect(valid([sec(1000, 2000, 5, { corner: 'RIGHT' }), sec(1000, 2000, 5)])).toBe(false);
    expect(valid([sec(1000, 2000, 5), sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5)])).toBe(false);
    expect(valid([sec(1000, 2000, 5), sec(1000, 2000, 5, { corner: 'RIGHT' }), sec(1000, 2000, 5)])).toBe(false);
    expect(valid([sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5, { corner: 'LEFT' })])).toBe(false);
    expect(valid([sec(1000, 2000, 5, { corner: 'RIGHT' }), sec(1000, 2000, 5, { corner: 'RIGHT' })])).toBe(false);
    expect(valid([sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5, { corner: 'RIGHT' })])).toBe(false);
  });

  it('rejects an unknown or malformed corner value — it is never normalized into another meaning', () => {
    for (const corner of ['BACK', 'left', '', 0, 1, null, true, {}]) {
      const forged = { ...config([sec(1000, 2000, 5)]), sections: [{ ...sec(1000, 2000, 5), corner }] };
      expect(parseConfiguration(forged).success, JSON.stringify(corner)).toBe(false);
    }
  });

  it('reads a configuration saved before corners existed (no corner field) as straight', () => {
    const { corner: _corner, ...legacy } = sec(1000, 2000, 5);
    const parsed = parseConfiguration({ ...config([]), sections: [legacy] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sections[0].corner).toBe('NONE');
  });

  it('keeps every other rule: the five-section limit and the MS Standard matrix still apply to corner racks', () => {
    const six = Array.from({ length: 6 }, (_, i) => sec(1000, 2000, 5, { corner: i === 0 ? 'LEFT' : i === 5 ? 'RIGHT' : 'NONE' }));
    expect(valid(six)).toBe(false);
    expect(valid(six.slice(0, 4).concat({ ...six[5] }))).toBe(true);
  });
});

let ipCounter = 0;
function post(handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown): Promise<Response> {
  ipCounter += 1;
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.26.0.${ipCounter}` },
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

describe('V2.6 — pricing and order APIs with corners', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });
  beforeEach(() => clearMemoryOrders());

  const corner = () => withCorners(config([sec(1000, 2000, 5), sec(1200, 2500, 8), sec(700, 1500, 4)]), true, true);

  it('POST /api/pricing/calculate prices a corner rack exactly like the straight one', async () => {
    const cfg = corner();
    const response = await post(pricingPost, '/api/pricing/calculate', cfg);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    const straightTotal = priced(withCorners(cfg, false, false), catalog).breakdown.total;
    expect(JSON.stringify(json)).toContain(String(straightTotal));
  });

  it('refuses a forged misplaced corner on the pricing API, with no price', async () => {
    const forged = config([sec(1000, 2000, 5), sec(1000, 2000, 5, { corner: 'LEFT' }), sec(1000, 2000, 5)]);
    const response = await post(pricingPost, '/api/pricing/calculate', forged);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/"total"|breakdown/);
  });

  it('an order re-prices a corner rack on the server and stores its orientation', async () => {
    const cfg = corner();
    const response = await post(ordersPost, '/api/orders', orderBody([{ ...cfg, total: 1 }]));
    const json = await response.json();
    expect(response.status).toBe(201);
    const order = (await getOrderByNumber(json.data?.orderNumber ?? json.orderNumber))!;
    expect(order.grandTotal).toBe(priced(cfg, catalog).breakdown.total);
    expect(order.grandTotal).toBe(priced(withCorners(cfg, false, false), catalog).breakdown.total);
    expect(order.items[0].configuration.sections.map((s) => s.corner)).toEqual(['LEFT', 'NONE', 'RIGHT']);
    expect(qtyOf(order.items[0].bom, 'UPRIGHT')).toBe(12);
  });

  it('refuses a forged misplaced corner in any order line and creates NO order', async () => {
    const forged = config([sec(1000, 2000, 5, { corner: 'RIGHT' }), sec(1000, 2000, 5)]);
    const response = await post(ordersPost, '/api/orders', orderBody([corner(), forged]));
    expect(response.ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });

  it('the 5-rack order limit still counts corner racks like any other', async () => {
    const response = await post(ordersPost, '/api/orders', orderBody([{ ...corner(), quantity: 3 }, { ...corner(), quantity: 3 }]));
    expect(response.ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });

  it('the cart keeps a corner configuration as added', () => {
    useCartStore.getState().clear();
    const cfg = corner();
    const result = useCartStore.getState().addItem({
      modelSlug: 'ms-standard',
      modelName: 'MS',
      configuration: cfg,
      priceSnapshot: toPublicPriceResult(priced(cfg, catalog)),
    });
    expect(result.ok).toBe(true);
    expect(useCartStore.getState().items[0].configuration.sections.map((s) => s.corner)).toEqual(['LEFT', 'NONE', 'RIGHT']);
    useCartStore.getState().clear();
  });
});

const messageOf = (url: string) => new URL(url).searchParams.get('text') ?? '';
const textOf = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));

describe('V2.6 — customer outputs describe corners', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('WhatsApp names each corner section, in both languages, and nothing for a straight rack', () => {
    const cfg = withCorners(config([sec(1000, 2000, 5), sec(1000, 2000, 5), sec(1000, 2000, 5)]), true, true);
    const price = toPublicPriceResult(priced(cfg, catalog));
    const ru = messageOf(whatsAppConfiguratorUrl(price, [], 'https://example.test/c', 'ru'));
    expect(ru).toContain('Секция 1: угол слева');
    expect(ru).toContain('Секция 3: угол справа');
    const kk = messageOf(whatsAppWorkspaceUrl([price, price], [], 'https://example.test/c', 'kk'));
    expect(kk).toContain('1-секция: сол жақ бұрыш');
    expect(kk).toContain('3-секция: оң жақ бұрыш');
    const straight = messageOf(whatsAppConfiguratorUrl(toPublicPriceResult(priced(withCorners(cfg, false, false), catalog)), [], 'x', 'ru'));
    expect(straight).not.toMatch(/угол/);
  });

  it('order documents list the corners and the real overall size; pre-V2.6 orders still build as straight', () => {
    const corner = configuration([1000, 1000], {
      sections: [
        { id: 's0', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false, corner: 'LEFT' },
        { id: 's1', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false, corner: 'NONE' },
      ],
    });
    const text = textOf(buildOrderDocumentContent(orderSource({ items: [item({ configuration: corner })] })));
    expect(text).toContain('Угловые секции');
    expect(text).toContain('секция 1 — угол слева');
    // Plan size: the corner's 400 mm depth + 1000 mm on the front line; the corner reaches 1000 mm back.
    expect(text).toContain('В×Ш×Г 2000×1400×1000');

    // An order stored before corners existed carries no corner field: straight, exactly as before.
    const legacy = textOf(buildOrderDocumentContent(orderSource({ items: [item({ configuration: configuration([1000, 1000]) })] })));
    expect(legacy).not.toContain('Угловые');
    expect(legacy).toContain('В×Ш×Г 2000×2000×400');

    // A stored misplaced or unknown corner is refused, never reinterpreted.
    for (const bad of ['BACK', 'RIGHT']) {
      const cfg = configuration([1000, 1000]);
      (cfg.sections as Record<string, unknown>[])[0].corner = bad;
      expect(() => buildOrderDocumentContent(orderSource({ items: [item({ configuration: cfg })] }))).toThrow(DocumentIntegrityError);
    }
  });
});
