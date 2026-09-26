import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as orderPost } from '@/app/api/orders/route';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { clearMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { getCatalog } from '@/lib/data/repository';
import { apiHeaders } from '@/lib/i18n/request';
import { configurationToShareQuery, parseWorkspaceFromSearchParams, workspaceToShareQuery } from '@/lib/configurator/url';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * Configurator V2.5 — a multi-kit workspace through the real server routes.
 * Every kit is priced by /api/pricing/calculate on its own; "add all to cart"
 * then checkout sends every kit as its own order line, and the order API
 * re-prices each one and enforces Σ quantity ≤ 5 whatever the browser sent.
 *
 * Commercial semantics verified here (unchanged by V2.5): assembly and
 * delivery are chosen and priced PER CONFIGURATION — assembly by the
 * service's own method (FIXED per configuration, PER_SECTION × sections ×
 * quantity, PERCENT of that configuration's items) and delivery as that
 * configuration's quoted price — and the order total is the SUM of every
 * line's server total. The workspace total the configurator shows is that
 * same sum, so it equals what the order is saved with.
 */

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `10.25.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
};

const section = (id: string, width: number, height: number, shelves: number, walls: Partial<ShelvingSection> = {}): ShelvingSection => ({
  id,
  width,
  height,
  shelves,
  rearWall: false,
  leftWall: false,
  rightWall: false,
  ...walls,
});

function kit(overrides: Partial<ShelvingConfiguration>): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections: [section('s1', 1000, 2000, 5)],
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

/** Three independent kits: mixed heights/shelves in one row, a different
 * depth and assembly, and a section-scoped cross brace. */
function workspace(): ShelvingConfiguration[] {
  return [
    kit({
      sections: [section('a1', 1000, 1500, 4, { rearWall: true }), section('a2', 1200, 2500, 8), section('a3', 700, 1000, 2)],
      quantity: 2,
      assemblyId: 'assembly-professional',
    }),
    kit({ depth: 500, sections: [section('b1', 1000, 3000, 6, { leftWall: true, rightWall: true })], assemblyId: 'assembly-full-install' }),
    kit({
      sections: [section('c1', 1000, 2000, 5), section('c2', 1000, 2000, 5)],
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'c2' }],
      deliveryId: 'delivery-city',
      quantity: 2,
    }),
  ];
}

async function price(configuration: ShelvingConfiguration) {
  const response = await pricingPost(
    new NextRequest('http://localhost/api/pricing/calculate', {
      method: 'POST',
      headers: { ...apiHeaders('ru'), 'x-forwarded-for': nextIp() },
      body: JSON.stringify(configuration),
    }),
  );
  const json = await response.json();
  expect(json.ok, JSON.stringify(json).slice(0, 300)).toBe(true);
  return json;
}

function order(configurations: unknown[], extra: Record<string, unknown> = {}) {
  return orderPost(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { ...apiHeaders('ru'), 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        fullName: 'Тест Тестов',
        phone: '+77001234567',
        email: 'test@example.com',
        city: 'Алматы',
        deliveryAddress: 'ул. Абая, 1',
        customerType: 'INDIVIDUAL',
        paymentPreference: 'BANK_TRANSFER',
        items: configurations.map((configuration) => ({ configuration })),
        ...extra,
      }),
    }),
  );
}

describe('V2.5 workspace → pricing → order', () => {
  beforeEach(() => clearMemoryOrders());

  it('prices every kit on its own; the order re-prices every kit and its total is the workspace total', async () => {
    const kits = workspace();
    const prices = await Promise.all(kits.map(price));
    const workspaceTotal = prices.reduce((sum, p) => sum + p.breakdown.total, 0);

    // Forged client-side money is ignored: the server re-prices every line.
    const forged = kits.map((k) => ({ ...k, total: 1, unitPrice: 1, breakdown: { total: 1 } }));
    const response = await order(forged, { grandTotal: 1, total: 1, discount: 999_999 });
    const json = await response.json();
    expect(response.status, JSON.stringify(json).slice(0, 300)).toBe(201);
    expect(json.data?.grandTotal ?? json.grandTotal).toBe(workspaceTotal);

    const saved = await getOrderByNumber(json.data?.orderNumber ?? json.orderNumber);
    expect(saved?.items).toHaveLength(3);
    saved!.items.forEach((item, i) => {
      expect(item.breakdown.total).toBe(prices[i].breakdown.total);
      expect(item.configuration.sections.map((s) => [s.width, s.height, s.shelves])).toEqual(kits[i].sections.map((s) => [s.width, s.height, s.shelves]));
      expect(item.configuration.quantity).toBe(kits[i].quantity);
    });
    expect(saved!.grandTotal).toBe(workspaceTotal);
  });

  it('assembly and delivery are priced per configuration by the existing rules (not once per order)', async () => {
    const catalog = await getCatalog();
    const professional = catalog.assemblyServices.find((a) => a.id === 'assembly-professional')!;
    expect(professional.method).toBe('PER_SECTION');
    const [k1, k2, k3] = workspace();
    const [p1, p2, p3] = await Promise.all([k1, k2, k3].map(price));
    // PER_SECTION: rate × this kit's sections × this kit's quantity.
    expect(p1.breakdown.assembly).toBe(professional.value * k1.sections.length * k1.quantity);
    // PERCENT: of this kit's own items only.
    const fullInstall = catalog.assemblyServices.find((a) => a.id === 'assembly-full-install')!;
    expect(fullInstall.method).toBe('PERCENT');
    expect(p2.breakdown.assembly).toBe(Math.round((p2.breakdown.itemsNet * fullInstall.value) / 100));
    // Self-assembly: nothing.
    expect(p3.breakdown.assembly).toBe(0);
    // Delivery: each kit carries its own quoted delivery (pickup / four-city
    // delivery are 0 ₸ in the catalog; regional delivery is null + a note).
    expect(p1.breakdown.delivery).toBe(0);
    expect(p3.breakdown.delivery).toBe(0);
  });

  it('a workspace sent through its own v3 link is priced exactly as the kits it came from', async () => {
    const kits = workspace();
    const link = parseWorkspaceFromSearchParams(new URLSearchParams(workspaceToShareQuery(kits, 1)))!;
    expect(link.kits).toHaveLength(3);
    const direct = await Promise.all(kits.map(price));
    const viaLink = await Promise.all(link.kits.map((k) => price(k as ShelvingConfiguration)));
    expect(viaLink.map((p) => p.breakdown.total)).toEqual(direct.map((p) => p.breakdown.total));
    expect(configurationToShareQuery(link.kits[2] as ShelvingConfiguration)).toBe(configurationToShareQuery(kits[2]));
  });

  it.each([
    ['2 + 3', [2, 3], 201],
    ['5 kits × 1', [1, 1, 1, 1, 1], 201],
    ['3 + 3', [3, 3], 400],
    ['6 kits × 1 (a forged sixth kit)', [1, 1, 1, 1, 1, 1], 400],
    ['one kit × 6', [6], 400],
  ])('Σ quantity ≤ 5 is enforced by the order API: %s', async (_name, quantities, status) => {
    const response = await order(quantities.map((quantity, i) => kit({ quantity, sections: [section(`k${i}`, 1000, 1500 + (i % 3) * 500, 4)] })));
    expect(response.status).toBe(status);
  });
});
