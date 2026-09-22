import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { POST as ordersPost } from '@/app/api/orders/route';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import DeliveryPage from '@/app/[locale]/delivery/page';
import { localeProps } from './helpers/public-page';
import { getCatalog, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { clearMemoryOrders, countMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { CITY_DELIVERY_UNAVAILABLE_MESSAGE, quotedDeliveryPrice } from '@/lib/delivery/city-delivery';
import type { DeliveryMethodKind } from '@/lib/types/domain';

/**
 * Owner rule: delivery is free (0 ₸, same day) ONLY for CITY delivery in
 * Алматы, Астана, Караганда, Шымкент. Delivery anywhere else — COUNTRY,
 * TRANSPORT_COMPANY, INDIVIDUAL — takes 2–3 days and its cost is calculated
 * individually: never 0 ₸, never "free", never a made-up tariff.
 *
 * Also the public validation contract: a failed field is machine-readable in
 * `fieldErrors[].field`, while the customer-facing text (`message`,
 * `details`, `fieldErrors[].message`) never carries a raw field name/path.
 */

let ipCounter = 0;
function post(handler: (r: NextRequest) => Promise<Response>, url: string, body: unknown): Promise<Response> {
  ipCounter += 1;
  return handler(
    new NextRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.10.0.${ipCounter}` },
      body: JSON.stringify(body),
    }),
  );
}
const postOrder = (body: unknown) => post(ordersPost, 'http://localhost/api/orders', body);
const postPricing = (body: unknown) => post(pricingPost, 'http://localhost/api/pricing/calculate', body);

const baseConfiguration = {
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
};

function orderBody(city: string, deliveryId: string, extra: Record<string, unknown> = {}) {
  return {
    fullName: 'Тест Тестов',
    phone: '+77001234567',
    email: 'test@example.com',
    city,
    deliveryAddress: 'ул. Абая, 10',
    customerType: 'INDIVIDUAL',
    paymentPreference: 'BANK_TRANSFER',
    items: [{ configuration: { ...baseConfiguration, deliveryId } }],
    ...extra,
  };
}

/** A raw "field:" / "a.b.0:" prefix as a developer would write it. */
const RAW_FIELD_PREFIX = /(^|\s)[A-Za-z_][\w.]*:\s/;
const REGIONAL_KINDS: DeliveryMethodKind[] = ['COUNTRY', 'TRANSPORT_COMPANY', 'INDIVIDUAL'];

/** The catalog as an old database might hold it: every method stored at 0. */
function withStoredDeliveryPrice(catalog: Catalog, basePrice: number): Catalog {
  return { ...catalog, deliveryMethods: catalog.deliveryMethods.map((d) => ({ ...d, basePrice })) };
}

describe('quotedDeliveryPrice — the only place a delivery amount is decided', () => {
  it('CITY and PICKUP quote their stored price (0 = free)', () => {
    expect(quotedDeliveryPrice({ kind: 'CITY', basePrice: 0 })).toBe(0);
    expect(quotedDeliveryPrice({ kind: 'PICKUP', basePrice: 0 })).toBe(0);
  });

  it.each(REGIONAL_KINDS)('%s is individually calculated whatever is stored (0, a tariff or null)', (kind) => {
    for (const basePrice of [0, 5000, null]) expect(quotedDeliveryPrice({ kind, basePrice })).toBeNull();
  });
});

describe('pricing engine — regional delivery is never free', () => {
  it('seed catalog: TRANSPORT_COMPANY has no fixed price', async () => {
    const catalog = await getCatalog();
    const transport = catalog.deliveryMethods.find((d) => d.kind === 'TRANSPORT_COMPANY')!;
    expect(transport.basePrice).toBeNull();
  });

  it.each(['delivery-transport-company', 'delivery-country', 'delivery-individual'])(
    '%s → delivery null + note; product total unchanged (no invented tariff)',
    async (deliveryId) => {
      const catalog = await getCatalog();
      const pickup = calculatePrice(baseConfiguration, catalog);
      const regional = calculatePrice({ ...baseConfiguration, deliveryId }, catalog);
      if (!pickup.ok || !regional.ok) throw new Error('fixture configuration must price');

      expect(regional.breakdown.delivery).toBeNull();
      expect(regional.deliveryNote).toBeTruthy();
      expect(regional.breakdown.total).toBe(pickup.breakdown.total);
      expect(regional.breakdown.itemsNet).toBe(pickup.breakdown.itemsNet);
    },
  );

  it('a database still storing basePrice 0 for regional methods cannot quote 0 ₸', async () => {
    const stale = withStoredDeliveryPrice(await getCatalog(), 0);
    for (const deliveryId of ['delivery-transport-company', 'delivery-country', 'delivery-individual']) {
      const result = calculatePrice({ ...baseConfiguration, deliveryId }, stale);
      if (!result.ok) throw new Error('fixture configuration must price');
      expect(result.breakdown.delivery).toBeNull();
      expect(result.deliveryNote).toBeTruthy();
    }
    const city = calculatePrice({ ...baseConfiguration, deliveryId: 'delivery-city' }, stale);
    if (!city.ok) throw new Error('fixture configuration must price');
    expect(city.breakdown.delivery).toBe(0);
    expect(city.deliveryNote).toBeNull();
  });

  it('public /api/pricing/calculate reports TRANSPORT_COMPANY delivery as null with the note, not 0', async () => {
    const response = await postPricing({ ...baseConfiguration, deliveryId: 'delivery-transport-company' });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.breakdown.delivery).toBeNull();
    expect(json.deliveryNote).toBeTruthy();
  });
});

describe('POST /api/orders — regional delivery stays individually calculated', () => {
  beforeEach(() => clearMemoryOrders());

  it.each(['Тараз', 'Павлодар', 'Актобе'])('%s + TRANSPORT_COMPANY → accepted, delivery null', async (city) => {
    const response = await postOrder(orderBody(city, 'delivery-transport-company'));
    const json = await response.json();
    expect(response.status).toBe(201);
    const saved = await getOrderByNumber(json.orderNumber);
    expect(saved?.items[0].breakdown.delivery).toBeNull();
    // The frozen document snapshot (invoice/PDF source) has no 0 ₸ delivery line either.
    expect(saved?.items[0].documentSnapshot?.pricing.delivery).toBeNull();
  });

  it('a forged zero regional delivery price from the client is ignored', async () => {
    const catalog = await getCatalog();
    const expected = calculatePrice({ ...baseConfiguration, deliveryId: 'delivery-transport-company' }, catalog);
    if (!expected.ok) throw new Error('fixture configuration must price');

    const response = await postOrder(
      orderBody('Тараз', 'delivery-transport-company', {
        deliveryPrice: 0,
        deliveryTotal: 0,
        freeDelivery: true,
        grandTotal: 1,
        items: [
          {
            configuration: { ...baseConfiguration, deliveryId: 'delivery-transport-company', deliveryPrice: 0, basePrice: 0 },
            breakdown: { delivery: 0, total: 1 },
            priceSnapshot: { breakdown: { delivery: 0, total: 1 }, deliveryNote: null },
          },
        ],
      }),
    );
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.grandTotal).toBe(expected.breakdown.total);

    const saved = await getOrderByNumber(json.orderNumber);
    expect(saved?.items[0].breakdown.delivery).toBeNull();
    expect(saved?.grandTotal).toBe(expected.breakdown.total);
  });

  it.each(['Алматы', 'Астана', 'Караганда', 'Қарағанды', 'Шымкент'])('%s + CITY → delivery 0', async (city) => {
    const response = await postOrder(orderBody(city, 'delivery-city'));
    const json = await response.json();
    expect(response.status).toBe(201);
    expect((await getOrderByNumber(json.orderNumber))?.items[0].breakdown.delivery).toBe(0);
  });

  it.each(['Тараз', 'Павлодар', 'Актобе'])('%s + CITY → rejected', async (city) => {
    const response = await postOrder(orderBody(city, 'delivery-city'));
    expect(response.status).toBe(400);
    expect(countMemoryOrders()).toBe(0);
  });
});

describe('/delivery page — regional methods never read as free', () => {
  it('the TRANSPORT_COMPANY card says "calculated individually", and only PICKUP/CITY say "Бесплатно"', async () => {
    const html = renderToStaticMarkup((await DeliveryPage(localeProps('ru'))) as ReactElement);
    const cards = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>.*?<p class="tech-label[^"]*">(.*?)<\/p>/gs)].map((m) => ({
      name: m[1],
      label: m[2],
    }));
    const transport = cards.find((c) => c.name === 'Передача транспортной компании');
    expect(transport?.label).toBe('Стоимость доставки рассчитывается индивидуально.');
    for (const card of cards.filter((c) => c.label === 'Бесплатно')) {
      expect(['Самовывоз со склада', 'Доставка по городу']).toContain(card.name);
    }
  });
});

describe('public order validation contract — structured field, clean message', () => {
  beforeEach(() => clearMemoryOrders());

  function expectCleanMessages(json: { message: string; details?: string[]; fieldErrors?: { message: string }[] }) {
    for (const text of [json.message, ...(json.details ?? []), ...(json.fieldErrors ?? []).map((e) => e.message)]) {
      expect(text).not.toMatch(RAW_FIELD_PREFIX);
    }
  }

  it('CITY for a non-eligible city: field "city", message without a "city:" prefix', async () => {
    const response = await postOrder(orderBody('Тараз', 'delivery-city'));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.fieldErrors).toEqual([{ field: 'city', message: CITY_DELIVERY_UNAVAILABLE_MESSAGE }]);
    expect(json.details).toEqual([CITY_DELIVERY_UNAVAILABLE_MESSAGE]);
    expect(JSON.stringify(json.details)).not.toContain('city:');
    expectCleanMessages(json);
  });

  it('missing delivery address: field "deliveryAddress", message without a "deliveryAddress:" prefix', async () => {
    const response = await postOrder(orderBody('Алматы', 'delivery-city', { deliveryAddress: '' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.fieldErrors).toEqual([{ field: 'deliveryAddress', message: 'Укажите адрес доставки' }]);
    expect(json.details).toEqual(['Укажите адрес доставки']);
    expectCleanMessages(json);
  });

  it('schema errors keep the top-level field and a Russian message; nested cart paths are not exposed', async () => {
    const response = await postOrder(
      orderBody('', 'delivery-pickup', {
        email: 'abc',
        items: [{ configuration: { ...baseConfiguration, sections: [{ id: 'x', width: -5 }] } }],
      }),
    );
    const json = await response.json();
    expect(response.status).toBe(400);
    const fields = json.fieldErrors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['city', 'email', 'items']));
    expect(json.fieldErrors.find((e: { field: string }) => e.field === 'city').message).toBe('Укажите город');
    expect(JSON.stringify(json)).not.toMatch(/items\.0|configuration\.|sections\./);
    expectCleanMessages(json);
  });

  it('engine validation failures: customer details carry no schema paths, the paths stay internal', async () => {
    const catalog = await getCatalog();
    const failure = calculatePrice({ ...baseConfiguration, height: 'high' }, catalog);
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    for (const detail of failure.details ?? []) expect(detail).not.toMatch(RAW_FIELD_PREFIX);
    expect(failure.internalDetails?.some((d) => d.startsWith('height:'))).toBe(true);
  });
});
