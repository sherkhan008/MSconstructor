import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { POST as ordersPost } from '@/app/api/orders/route';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { toPublicPriceFailure, toPublicPriceResult } from '@/lib/pricing/public-result';
import { clearMemoryOrders } from '@/lib/orders/store';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * The commercial *vocabulary* boundary, as opposed to the field/value
 * boundary proved in public-price-leak.test.ts and
 * public-commercial-boundary.test.ts.
 *
 * Those two files prove that no internal NUMBER or FIELD NAME reaches a
 * customer. This one proves the remaining channel: free-text strings —
 * `warnings`, `discountReasons`, a failure's `message`/`details` — must not
 * NAME an internal commercial concept either. A customer may read
 * "Для этой конфигурации требуется индивидуальный расчёт"; they may not read
 * that a discount was capped by the minimum margin, which internal BOM rule
 * failed to resolve, or which price-level enum they were placed in.
 *
 * The same run also asserts the other half of the contract: the diagnostic
 * is not deleted, it is kept server-side on PriceResult.internalWarnings /
 * PriceFailure.internalDetails, so support and logs still have it.
 */

/**
 * Lowercased substrings that must never appear anywhere in a public payload,
 * in any field.
 */
const FORBIDDEN_VOCABULARY = [
  // margin / markup
  'наценк',
  'маржа',
  'маржин',
  'markup',
  'margin',
  // cost / supplier
  'себестоим',
  'закупочн',
  'поставщик',
  'purchaseprice',
  'unitcost',
  'costsubtotal',
  // internal BOM vocabulary
  'для правила',
  'правило «',
];

/**
 * Internal price-level enum values. These are checked in the customer-facing
 * TEXT channels only, not across the whole payload: `configuration` echoes
 * back the configuration the server priced — including a `priceLevel` the
 * caller itself sent — because the client stores that echo in the cart. The
 * public configurator never sets, serializes or renders `priceLevel`, so the
 * only way it appears is as the caller's own input coming back. What must
 * never happen is the enum being written into a sentence a customer reads.
 */
const PRICE_LEVEL_ENUM_VALUES = ['retail', 'wholesale', 'dealer', 'corporate', 'government'];

/** Internal BOM rule names, as seeded — none may surface to a customer. */
const INTERNAL_RULE_NAMES = [
  'Стойки',
  'Полки',
  'Балки продольные',
  'Балки поперечные',
  'Стяжки рамы',
  'Раскосы задние',
  'Крепёж',
  'Крепёж MS Стандарт (болт + гайка)',
  'Опоры',
  'Соединители секций',
  'Задние стенки',
  'Боковые стенки',
];

/** Every free-text string in a payload, at any depth. */
function collectStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, found);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) collectStrings(child, found);
  return found;
}

function expectNoForbiddenVocabulary(payload: unknown, label: string) {
  for (const text of collectStrings(payload)) {
    const haystack = text.toLowerCase();
    for (const forbidden of FORBIDDEN_VOCABULARY) {
      expect(haystack.includes(forbidden), `${label} exposes "${forbidden}" in: ${text}`).toBe(false);
    }
  }
}

/**
 * The customer-facing free-text channels of a priced response: everything a
 * customer can actually read on screen. `configuration` is deliberately not
 * among them — see PRICE_LEVEL_ENUM_VALUES.
 */
function customerFacingText(json: Record<string, unknown>): string[] {
  const breakdown = (json.breakdown ?? {}) as { discountReasons?: string[] };
  return [
    ...((json.warnings as string[]) ?? []),
    ...(breakdown.discountReasons ?? []),
    ...(typeof json.deliveryNote === 'string' ? [json.deliveryNote] : []),
    ...(typeof json.message === 'string' ? [json.message] : []),
    ...((json.details as string[]) ?? []),
    ...((json.bom as { name: string }[]) ?? []).map((line) => line.name),
  ];
}

function expectNoEnumInCustomerText(json: Record<string, unknown>, label: string) {
  for (const text of customerFacingText(json)) {
    for (const value of PRICE_LEVEL_ENUM_VALUES) {
      expect(text.toLowerCase().includes(value), `${label} names the price level "${value}" in: ${text}`).toBe(false);
    }
  }
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}`;
}

function config(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 500,
    shelves: 5,
    sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
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

async function postPricing(body: unknown) {
  const response = await pricingPost(
    new NextRequest('http://localhost/api/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, json: await response.json() };
}

let catalog: Catalog;

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
});

describe('POST /api/pricing/calculate — customer-facing text', () => {
  const scenarios: [string, ShelvingConfiguration][] = [
    ['basic configuration', config()],
    ['quantity discount', config({ quantity: 12 })],
    ['dealer price level', config({ priceLevel: 'DEALER', quantity: 12 })],
    ['promo code applied', config({ promoCode: 'SKLAD2026', quantity: 3 })],
    ['promo code below its minimum total', config({ promoCode: 'ARCHIVE10' })],
    ['unknown promo code', config({ promoCode: 'NOSUCHCODE' })],
    ['individual-quote assembly', config({ assemblyId: 'assembly-individual' })],
    ['delivery quoted by a manager', config({ deliveryId: 'delivery-individual' })],
  ];

  for (const [label, body] of scenarios) {
    it(`names no internal commercial concept: ${label}`, async () => {
      const { json } = await postPricing(body);
      expectNoForbiddenVocabulary(json, `/api/pricing/calculate (${label})`);
      expectNoEnumInCustomerText(json, `/api/pricing/calculate (${label})`);
    });
  }

  it('never returns the price-level enum in a discount reason', async () => {
    const { json } = await postPricing(config({ priceLevel: 'DEALER', quantity: 12 }));
    expect(json.ok).toBe(true);
    const reasons: string[] = json.breakdown.discountReasons;
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((reason) => reason.includes('уровню цены'))).toBe(true);
    for (const reason of reasons) {
      expect(reason).not.toMatch(/RETAIL|WHOLESALE|DEALER|CORPORATE|GOVERNMENT/);
    }
  });

  it('still delivers the genuinely useful commercial notices', async () => {
    // Proves the customer channel was narrowed, not emptied: these two
    // notices are exactly the kind a customer should still receive.
    const assembly = await postPricing(config({ assemblyId: 'assembly-individual' }));
    expect(assembly.json.ok).toBe(true);
    expect(assembly.json.warnings).toContain('Стоимость сборки будет рассчитана индивидуально менеджером');

    const delivery = await postPricing(config({ deliveryId: 'delivery-individual' }));
    expect(delivery.json.ok).toBe(true);
    expect(delivery.json.deliveryNote).toBe('Стоимость доставки рассчитывается индивидуально.');

    const promo = await postPricing(config({ promoCode: 'NOSUCHCODE' }));
    expect(promo.json.ok).toBe(true);
    expect((promo.json.warnings as string[]).some((w) => w.includes('Промокод'))).toBe(true);
  });

  it('exposes no internalWarnings field and no internal diagnostics in warnings', async () => {
    const { json } = await postPricing(config());
    expect(json.ok).toBe(true);
    expect('internalWarnings' in json).toBe(false);
    for (const warning of json.warnings as string[]) {
      for (const ruleName of INTERNAL_RULE_NAMES) {
        expect(warning.includes(ruleName), `warning names the internal rule "${ruleName}"`).toBe(false);
      }
    }
  });
});

describe('a discount capped by the margin floor', () => {
  /**
   * Forces the cap by combining an aggressive quantity break with a margin
   * floor high enough that the discount cannot be granted in full. Only the
   * catalog passed to calculatePrice is adjusted — the engine, its formulas
   * and the seeded catalog are untouched.
   */
  function cappedDiscountCatalog(): Catalog {
    return {
      ...catalog,
      pricingSettings: {
        ...catalog.pricingSettings,
        minMarginPercent: 400,
        quantityBreaks: [{ minQuantity: 2, discountPercent: 90 }],
      },
    };
  }

  it('keeps the margin-floor diagnostic server-side and out of the customer channel', () => {
    const result = calculatePrice(config({ quantity: 10 }), cappedDiscountCatalog());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The diagnostic still exists for support and logs...
    expect(result.internalWarnings.some((w) => w.includes('наценк'))).toBe(true);
    // ...but the customer-facing channel does not carry it.
    expect(result.warnings.some((w) => w.toLowerCase().includes('наценк'))).toBe(false);

    const publicResult = toPublicPriceResult(result);
    expect('internalWarnings' in publicResult).toBe(false);
    expectNoForbiddenVocabulary(publicResult, 'toPublicPriceResult (capped discount)');
  });
});

describe('a configuration whose BOM cannot be resolved', () => {
  /**
   * Removes every upright from a copy of the catalog so the BOM reports a
   * missing critical component. That is the real path that produces
   * INDIVIDUAL_QUOTE_REQUIRED together with rule-level diagnostics.
   */
  function catalogWithoutUprights(): Catalog {
    return { ...catalog, components: catalog.components.filter((component) => component.type !== 'UPRIGHT') };
  }

  it('produces rule diagnostics internally but a plain commercial message publicly', () => {
    const result = calculatePrice(config(), catalogWithoutUprights());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INDIVIDUAL_QUOTE_REQUIRED');
    // Diagnostics are preserved for the server...
    expect(result.internalDetails?.length).toBeGreaterThan(0);
    expect(result.internalDetails?.join(' ')).toContain('Стойки');
    // ...and the customer sees only the commercial message.
    expect(result.message).toBe(
      'Для этой конфигурации требуется индивидуальный расчёт. Пожалуйста, свяжитесь с менеджером.',
    );
    expect(result.details).toBeUndefined();

    const publicFailure = toPublicPriceFailure(result);
    expect('internalDetails' in publicFailure).toBe(false);
    expectNoForbiddenVocabulary(publicFailure, 'toPublicPriceFailure');
    for (const ruleName of INTERNAL_RULE_NAMES) {
      expect(JSON.stringify(publicFailure).includes(ruleName)).toBe(false);
    }
  });

  it('toPublicPriceFailure drops internalDetails even when details are also present', () => {
    const publicFailure = toPublicPriceFailure({
      ok: false,
      code: 'INCOMPATIBLE_CONFIGURATION',
      message: 'Высота 9000 мм недоступна',
      details: ['Высота 9000 мм недоступна'],
      internalDetails: ['Не найден компонент для правила «Стойки»'],
    });

    expect(publicFailure.details).toEqual(['Высота 9000 мм недоступна']);
    expect('internalDetails' in publicFailure).toBe(false);
    expectNoForbiddenVocabulary(publicFailure, 'toPublicPriceFailure (mixed)');
  });
});

describe('POST /api/orders — customer-facing text', () => {
  it('rejects an unpriceable item without naming an internal rule', async () => {
    clearMemoryOrders();
    const response = await ordersPost(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({
          fullName: 'Тест Тестов',
          phone: '+77001234567',
          email: 'test@example.com',
          city: 'Алматы',
          customerType: 'INDIVIDUAL',
          paymentPreference: 'BANK_TRANSFER',
          // Height 9000 fails compatibility: a real, reachable rejection whose
          // details must stay commercial.
          items: [{ configuration: config({ height: 9000 }) }],
        }),
      }),
    );
    const json = await response.json();

    expect(json.ok).toBe(false);
    expectNoForbiddenVocabulary(json, '/api/orders (unpriceable item)');
    expectNoEnumInCustomerText(json, '/api/orders (unpriceable item)');
    clearMemoryOrders();
  });

  it('accepts a valid order and returns no internal commercial text', async () => {
    clearMemoryOrders();
    const response = await ordersPost(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({
          fullName: 'Тест Тестов',
          phone: '+77001234567',
          email: 'test@example.com',
          city: 'Алматы',
          customerType: 'INDIVIDUAL',
          paymentPreference: 'BANK_TRANSFER',
          items: [{ configuration: config({ priceLevel: 'DEALER', quantity: 12 }) }],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expectNoForbiddenVocabulary(json, '/api/orders (accepted)');
    expectNoEnumInCustomerText(json, '/api/orders (accepted)');
    clearMemoryOrders();
  });
});

describe('public source files', () => {
  /**
   * A second net, independent of any request: no customer-facing component
   * or public page may hardcode internal commercial vocabulary, and no
   * developer-facing placeholder may be rendered to a customer.
   */
  const PUBLIC_DIRS = [
    join(process.cwd(), 'src', 'app'),
    join(process.cwd(), 'src', 'components'),
  ];
  const NON_PUBLIC = [
    join('src', 'app', 'admin'),
    join('src', 'app', 'api', 'admin'),
    join('src', 'components', 'admin'),
  ];

  function publicSourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (NON_PUBLIC.some((segment) => path.includes(segment))) continue;
      if (statSync(path).isDirectory()) publicSourceFiles(path, found);
      else if (path.endsWith('.tsx') || path.endsWith('.ts')) found.push(path);
    }
    return found;
  }

  /** Source text with comments removed — only what can reach the screen. */
  function renderableSource(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
  }

  const files = PUBLIC_DIRS.flatMap((dir) => publicSourceFiles(dir));

  it('scans a meaningful number of public files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('hardcode no internal commercial vocabulary', () => {
    for (const path of files) {
      const source = renderableSource(path).toLowerCase();
      for (const forbidden of ['наценк', 'маржа', 'маржин', 'себестоим', 'закупочн']) {
        expect(source.includes(forbidden), `${path} hardcodes "${forbidden}"`).toBe(false);
      }
    }
  });

  it('render no developer-facing placeholder text to a customer', () => {
    for (const path of files) {
      const source = renderableSource(path);
      // A customer must never be shown a source path or an instruction
      // addressed to whoever maintains the site.
      expect(/>[^<]*src\/lib\//.test(source), `${path} renders a source path`).toBe(false);
      expect(/>[^<]*укажите виджет/i.test(source), `${path} renders a setup instruction`).toBe(false);
    }
  });
});
