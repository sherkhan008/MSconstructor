import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postPricingRoute } from '@/app/api/pricing/calculate/route';
import { POST as postOrderRoute } from '@/app/api/orders/route';
import { findPromoCode, getCatalog, isPromoCodeExpired, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { PROMO_CODES, promoCodesToSeed } from '@/lib/data/seed-data';
import { clearMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { calculatePrice } from '@/lib/pricing';
import type { PromoCode, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Promo codes before launch: the demo codes committed to this public
 * repository never reach a production database, and an expired code
 * (validUntil in the past on the SERVER clock) is refused by every public
 * pricing and order path — never trusted from the browser.
 */

const DEMO_CODES = ['SKLAD2026', 'ARCHIVE10'];

function config(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections: [{ id: 'sec-1', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false, corner: 'NONE' }],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 5,
    ...overrides,
  };
}

describe('production seed', () => {
  it('seeds no promo codes in production, and only the demo codes elsewhere', () => {
    expect(promoCodesToSeed(true)).toEqual([]);
    expect(promoCodesToSeed(false).map((p) => p.code).sort()).toEqual([...DEMO_CODES].sort());
  });

  it('prisma/seed.ts writes promo codes only through the production-aware policy', () => {
    const seed = readFileSync('prisma/seed.ts', 'utf8');
    expect(seed).toMatch(/promoCodesToSeed\(isProduction\)/);
    // The raw demo list is never iterated (or even imported) by the seed.
    expect(seed).not.toMatch(/\bPROMO_CODES\b/);
  });

  it('commits no promo code other than the known demo codes', () => {
    expect(PROMO_CODES.map((p) => p.code).sort()).toEqual([...DEMO_CODES].sort());
  });
});

describe('validUntil — server-side expiry', () => {
  const UNTIL = '2026-10-01T00:00:00.000Z';
  const edge: PromoCode = { code: 'EDGE5', discountPercent: 5, discountFixed: 0, minTotal: 0, active: true, validUntil: UNTIL };
  const at = (iso: string) => new Date(iso);
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = structuredClone(await getCatalog());
    catalog.promoCodes.push(
      edge,
      { ...edge, code: 'FOREVER5', validUntil: undefined },
      { ...edge, code: 'BADDATE5', validUntil: 'not-a-date' },
      { ...edge, code: 'OFF5', active: false, validUntil: undefined },
    );
  });

  it('accepts a code up to and including its validUntil instant, and refuses it one millisecond later', () => {
    expect(isPromoCodeExpired(edge, at('2026-09-30T23:59:59.999Z'))).toBe(false);
    expect(isPromoCodeExpired(edge, at(UNTIL))).toBe(false);
    expect(isPromoCodeExpired(edge, at('2026-10-01T00:00:00.001Z'))).toBe(true);

    expect(findPromoCode(catalog, 'edge5', at(UNTIL))?.code).toBe('EDGE5');
    expect(findPromoCode(catalog, 'EDGE5', at('2026-10-01T00:00:00.001Z'))).toBeUndefined();
  });

  it('never expires a code without validUntil, treats an unreadable date as expired, and still requires active', () => {
    expect(findPromoCode(catalog, 'FOREVER5', at('2099-01-01T00:00:00Z'))?.code).toBe('FOREVER5');
    expect(findPromoCode(catalog, 'BADDATE5', at('2026-01-01T00:00:00Z'))).toBeUndefined();
    expect(findPromoCode(catalog, 'OFF5', at('2026-01-01T00:00:00Z'))).toBeUndefined();
  });

  it('prices a valid code with its discount and an expired one exactly like no code at all', () => {
    const none = calculatePrice(config(), catalog, { now: at(UNTIL) });
    const valid = calculatePrice(config({ promoCode: 'EDGE5' }), catalog, { now: at(UNTIL) });
    const expired = calculatePrice(config({ promoCode: 'EDGE5' }), catalog, { now: at('2026-10-01T00:00:00.001Z') });
    expect(none.ok && valid.ok && expired.ok).toBe(true);
    if (!none.ok || !valid.ok || !expired.ok) return;

    expect(valid.breakdown.discount).toBeGreaterThan(none.breakdown.discount);
    expect(valid.breakdown.discountReasons.some((r) => r.includes('EDGE5'))).toBe(true);

    expect(expired.breakdown).toEqual(none.breakdown);
    expect(expired.warnings.some((w) => w.includes('EDGE5'))).toBe(true);
  });
});

describe('public routes use the server clock', () => {
  let ip = 0;
  const request = (path: string, body: unknown) => {
    ip += 1;
    return new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.0.${ip}` },
      body: JSON.stringify(body),
    });
  };
  // The demo code's validUntil is '2026-12-31' (2026-12-31T00:00:00Z).
  const BEFORE = '2026-12-30T12:00:00Z';
  const AFTER = '2026-12-31T00:00:00.001Z';

  beforeEach(() => {
    resetCatalogCache();
    clearMemoryOrders();
    // Only Date is faked: timers and I/O run normally.
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function pricedDiscount(promoCode?: string): Promise<number> {
    const response = await postPricingRoute(request('/api/pricing/calculate', config(promoCode ? { promoCode } : {})));
    const json = await response.json();
    expect(response.status).toBe(200);
    return json.breakdown.discount;
  }

  it('/api/pricing/calculate applies SKLAD2026 before validUntil and refuses it after', async () => {
    vi.setSystemTime(new Date(BEFORE));
    const baseline = await pricedDiscount();
    expect(await pricedDiscount('SKLAD2026')).toBeGreaterThan(baseline);

    vi.setSystemTime(new Date(AFTER));
    expect(await pricedDiscount('SKLAD2026')).toBe(baseline);
  });

  it('/api/orders stores no promo discount for an expired code, whatever the browser sends', async () => {
    const order = async (promoCode: string) => {
      const response = await postOrderRoute(
        request('/api/orders', {
          fullName: 'Тест Промокодов',
          phone: '+77001230000',
          email: 'promo@example.com',
          city: 'Алматы',
          customerType: 'INDIVIDUAL',
          paymentPreference: 'BANK_TRANSFER',
          // A forged client total and discount are ignored as always.
          discountTotal: 999_999,
          grandTotal: 1,
          items: [{ configuration: config({ promoCode }) }],
        }),
      );
      const json = await response.json();
      expect(response.status, JSON.stringify(json)).toBe(201);
      return (await getOrderByNumber(json.orderNumber))!;
    };

    vi.setSystemTime(new Date(BEFORE));
    const valid = await order('SKLAD2026');
    const baselineDiscount = (await order('NOSUCHCODE')).discountTotal;
    expect(valid.discountTotal).toBeGreaterThan(baselineDiscount);

    vi.setSystemTime(new Date(AFTER));
    const expired = await order('SKLAD2026');
    expect(expired.discountTotal).toBe(baselineDiscount);
    expect(expired.grandTotal).toBeGreaterThan(valid.grandTotal);
  });
});
