import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { clearMemoryOrders, countMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { isCityDeliveryCity, normalizeCityName, resolveCityDeliveryCity } from '@/lib/delivery/city-delivery';

/**
 * Owner rule: free same-day CITY delivery exists ONLY in Алматы, Астана,
 * Караганда and Шымкент. Everywhere else is COUNTRY delivery (2–3 days,
 * cost calculated individually). The server must enforce this — the
 * configurator dropdown and the checkout city field are both client input.
 */

let ipCounter = 0;
function postOrder(body: unknown): Promise<Response> {
  ipCounter += 1;
  const request = new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.0.${ipCounter}` },
    body: JSON.stringify(body),
  });
  return POST(request);
}

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
  deliveryId: 'delivery-city',
  quantity: 1,
};

function orderBody(city: string, deliveryId = 'delivery-city', extra: Record<string, unknown> = {}) {
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

describe('city normalization (explicit allow-list, no substring matching)', () => {
  it.each([
    ['Алматы', 'ALMATY'],
    ['  алматы ', 'ALMATY'],
    ['г. Алматы', 'ALMATY'],
    ['Almaty', 'ALMATY'],
    ['Астана', 'ASTANA'],
    ['город Астана', 'ASTANA'],
    ['Нур-Султан', 'ASTANA'],
    ['Караганда', 'KARAGANDA'],
    ['Қарағанды', 'KARAGANDA'],
    ['Қарағанды қаласы', 'KARAGANDA'],
    ['Шымкент', 'SHYMKENT'],
    ['ШЫМКЕНТ', 'SHYMKENT'],
  ])('%s → %s', (input, expected) => {
    expect(resolveCityDeliveryCity(input)).toBe(expected);
  });

  it.each([
    'Тараз',
    'Павлодар',
    'Актобе',
    'Алматинская область',
    'Алматы область',
    'Караганда-Тараз',
    'Тараз (Алматы)',
    'Каскелен',
    'Косшы',
    'гАлматы',
    '',
    '   ',
  ])('%j is not a free-delivery city', (input) => {
    expect(isCityDeliveryCity(input)).toBe(false);
  });

  it('normalizes case, ё, dashes and the ru/kk city markers only', () => {
    expect(normalizeCityName('  Г.  Нур – Султан ')).toBe('нур-султан');
    expect(normalizeCityName('Қарағанды қ.')).toBe('қарағанды');
  });
});

describe('POST /api/orders — free CITY delivery eligibility', () => {
  beforeEach(() => {
    clearMemoryOrders();
  });

  it.each(['Алматы', 'Астана', 'Караганда', 'Шымкент', 'Қарағанды'])(
    '%s + CITY → accepted with free delivery',
    async (city) => {
      const response = await postOrder(orderBody(city));
      const json = await response.json();
      expect(response.status).toBe(201);

      const saved = await getOrderByNumber(json.orderNumber);
      expect(saved?.items[0].configuration.deliveryId).toBe('delivery-city');
      expect(saved?.items[0].breakdown.delivery).toBe(0);
    },
  );

  it.each(['Тараз', 'Павлодар', 'Актобе', 'Алматинская область'])(
    '%s + CITY → rejected, no order created, no zero-priced delivery',
    async (city) => {
      const response = await postOrder(orderBody(city));
      const json = await response.json();
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details.join(' ')).toContain('Алматы, Астане, Караганде и Шымкенте');
      expect(json.orderNumber).toBeUndefined();
      expect(countMemoryOrders()).toBe(0);
    },
  );

  it('a forged CITY request with client-supplied zero/negative delivery prices is still rejected', async () => {
    const forged = orderBody('Тараз', 'delivery-city', {
      deliveryPrice: 0,
      deliveryTotal: 0,
      delivery: 0,
      freeDelivery: true,
      cityDeliveryEligible: true,
      grandTotal: 1,
      items: [
        {
          configuration: { ...baseConfiguration, deliveryId: 'delivery-city', deliveryPrice: 0, freeDelivery: true },
          breakdown: { delivery: 0, total: 1 },
          priceSnapshot: { breakdown: { delivery: 0, total: 1 } },
        },
      ],
    });
    const response = await postOrder(forged);
    expect(response.status).toBe(400);
    expect(countMemoryOrders()).toBe(0);
  });

  it('a CITY item mixed with a pickup item for a non-eligible city is rejected as a whole', async () => {
    const body = orderBody('Павлодар', 'delivery-pickup', {
      items: [
        { configuration: { ...baseConfiguration, deliveryId: 'delivery-pickup' } },
        { configuration: { ...baseConfiguration, deliveryId: 'delivery-city' } },
      ],
    });
    const response = await postOrder(body);
    expect(response.status).toBe(400);
    expect(countMemoryOrders()).toBe(0);
  });

  it.each(['Тараз', 'Павлодар', 'Актобе'])(
    '%s + COUNTRY → accepted, delivery price left for individual calculation (never 0)',
    async (city) => {
      const response = await postOrder(orderBody(city, 'delivery-country'));
      const json = await response.json();
      expect(response.status).toBe(201);

      const saved = await getOrderByNumber(json.orderNumber);
      expect(saved?.items[0].breakdown.delivery).toBeNull();
    },
  );

  it('client-supplied delivery prices and totals are ignored for an eligible CITY order', async () => {
    const clean = await postOrder(orderBody('Алматы'));
    const cleanJson = await clean.json();

    const tampered = await postOrder(
      orderBody('Алматы', 'delivery-city', {
        grandTotal: 1,
        deliveryPrice: -50000,
        items: [
          {
            configuration: { ...baseConfiguration, deliveryId: 'delivery-city' },
            breakdown: { delivery: -50000, total: 1 },
          },
        ],
      }),
    );
    const tamperedJson = await tampered.json();
    expect(tampered.status).toBe(201);
    expect(tamperedJson.grandTotal).toBe(cleanJson.grandTotal);

    const saved = await getOrderByNumber(tamperedJson.orderNumber);
    expect(saved?.grandTotal).toBe(cleanJson.grandTotal);
    expect(saved?.items[0].breakdown.delivery).toBe(0);
  });

  it('order totals equal the server pricing engine result for the same configuration', async () => {
    const catalog = await getCatalog();
    const expected = calculatePrice({ ...baseConfiguration }, catalog);
    if (!expected.ok) throw new Error('fixture configuration must price');

    const response = await postOrder(orderBody('Шымкент'));
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.grandTotal).toBe(expected.breakdown.total);
  });

  it('pickup is accepted for any customer city — it is collection from one of the four warehouses, not delivery', async () => {
    const response = await postOrder(orderBody('Тараз', 'delivery-pickup'));
    expect(response.status).toBe(201);
  });
});

describe('public delivery copy', () => {
  it('regional delivery states 2–3 days with individually calculated cost, and carries no fixed price', async () => {
    const catalog = await getCatalog();
    const country = catalog.deliveryMethods.find((d) => d.kind === 'COUNTRY')!;
    expect(country.description.ru).toContain('2–3 дня');
    expect(country.description.ru).toContain('Стоимость доставки рассчитывается индивидуально');
    expect(country.description.kk).toContain('2–3 күн');
    expect(country.description.kk).toContain('жеке есептеледі');
    expect(country.basePrice).toBeNull();
  });

  it('city delivery copy names exactly the four free-delivery cities', async () => {
    const catalog = await getCatalog();
    const city = catalog.deliveryMethods.find((d) => d.kind === 'CITY')!;
    for (const name of ['Алматы', 'Астане', 'Караганде', 'Шымкенту']) expect(city.description.ru).toContain(name);
    for (const name of ['Алматы', 'Астана', 'Қарағанды', 'Шымкент']) expect(city.description.kk).toContain(name);
  });
});
