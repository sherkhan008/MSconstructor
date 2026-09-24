import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { clearMemoryOrders, countMemoryOrders } from '@/lib/orders/store';
import { apiHeaders } from '@/lib/i18n/request';
import type { Locale } from '@/lib/i18n/locales';

/**
 * V2.1 server authority: an order may hold at most 5 physical kits (the sum
 * of every line's quantity) and each configuration at most 5 sections. The
 * order API rejects anything past either limit whatever the browser sent —
 * a forged request, or a stale tab's cart that never saw another tab's lines.
 */

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.21.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function postOrder(body: unknown, locale: Locale = 'ru'): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { ...apiHeaders(locale), 'x-forwarded-for': nextIp() },
      body: JSON.stringify(body),
    }),
  );
}

function configuration(quantity: number, sectionCount = 1) {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 500,
    shelves: 5,
    sections: Array.from({ length: sectionCount }, (_, i) => ({ id: `sec-${i}`, width: 1000, rearWall: false, leftWall: false, rightWall: false })),
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity,
  };
}

function orderBody(quantities: number[], sectionCount = 1) {
  return {
    fullName: 'Тест Тестов',
    phone: '+77001234567',
    email: 'test@example.com',
    city: 'Алматы',
    customerType: 'INDIVIDUAL',
    paymentPreference: 'BANK_TRANSFER',
    items: quantities.map((q) => ({ configuration: configuration(q, sectionCount) })),
  };
}

describe('POST /api/orders — physical-kit limit', () => {
  beforeEach(() => clearMemoryOrders());

  it.each([
    ['5 lines × quantity 1', [1, 1, 1, 1, 1]],
    ['1 line × quantity 5', [5]],
    ['3 × quantity 1 + 1 × quantity 2', [1, 1, 1, 2]],
  ])('accepts %s', async (_name, quantities) => {
    const response = await postOrder(orderBody(quantities));
    expect(response.status).toBe(201);
    expect((await response.json()).ok).toBe(true);
  });

  it.each([
    ['6 lines × quantity 1', [1, 1, 1, 1, 1, 1]],
    ['1 line × quantity 6', [6]],
    ['3 + 3', [3, 3]],
    ['a stale tab: 4 already ordered here + 2 from another tab', [4, 2]],
  ])('rejects %s with a clear validation error and saves nothing', async (_name, quantities) => {
    const response = await postOrder(orderBody(quantities));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.details).toContain('В одном заказе можно оформить не более 5 стеллажей.');
    expect(json.fieldErrors).toContainEqual({ field: 'items', message: 'В одном заказе можно оформить не более 5 стеллажей.' });
    expect(countMemoryOrders()).toBe(0);
  });

  it('answers in the request locale', async () => {
    const response = await postOrder(orderBody([6]), 'kk');
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.details).toContain('Бір тапсырыста ең көбі 5 стеллажға тапсырыс беруге болады.');
  });

  it('ignores any client-side count or flag — only the submitted quantities matter', async () => {
    const response = await postOrder({ ...orderBody([3, 3]), kitCount: 5, withinLimit: true });
    expect(response.status).toBe(400);
    expect(countMemoryOrders()).toBe(0);
  });
});

describe('POST /api/orders — section limit', () => {
  beforeEach(() => clearMemoryOrders());

  it('accepts a 5-section configuration', async () => {
    const response = await postOrder(orderBody([1], 5));
    expect(response.status).toBe(201);
  });

  it('rejects a 6-section configuration', async () => {
    const response = await postOrder(orderBody([1], 6));
    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
    expect(countMemoryOrders()).toBe(0);
  });
});

describe('pricing is unchanged by the order limit', () => {
  function price(body: unknown): Promise<Response> {
    return pricingPost(
      new NextRequest('http://localhost/api/pricing/calculate', {
        method: 'POST',
        headers: { ...apiHeaders('ru'), 'x-forwarded-for': nextIp() },
        body: JSON.stringify(body),
      }),
    );
  }

  it('still prices one configuration of quantity 10 (the 10-unit tier is untouched)', async () => {
    const response = await price(configuration(10));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.breakdown.quantity).toBe(10);
  });

  it('rejects pricing a 6-section configuration', async () => {
    const response = await price(configuration(1, 6));
    expect(response.status).toBe(400);
  });
});
