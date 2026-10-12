import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as calculatePrice } from '@/app/api/pricing/calculate/route';
import { POST as createOrder } from '@/app/api/orders/route';
import { clearMemoryOrders, countMemoryOrders } from '@/lib/orders/store';

let requestNumber = 0;
function request(handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown): Promise<Response> {
  requestNumber += 1;
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.88.0.${requestNumber}` },
      body: JSON.stringify(body),
    }),
  );
}

const configuration = (overrides: Record<string, unknown> = {}) => ({
  modelSlug: 'ms-standard',
  depth: 500,
  sections: [{ id: 'section-1', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false }],
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId: 'delivery-pickup',
  quantity: 1,
  ...overrides,
});

const order = (config: Record<string, unknown>) => ({
  fullName: 'Тестовый Покупатель',
  phone: '+77001234567',
  email: 'launch-eligibility@example.com',
  city: 'Алматы',
  customerType: 'INDIVIDUAL',
  paymentPreference: 'BANK_TRANSFER',
  items: [{ configuration: config }],
});

beforeEach(() => clearMemoryOrders());

describe('public launch eligibility API boundary', () => {
  it('accepts the launched model and an explicitly public accessory', async () => {
    const accepted = configuration({ accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'section-1' }] });
    const pricing = await request(calculatePrice, '/api/pricing/calculate', accepted);
    expect(pricing.status).toBe(200);
    expect((await pricing.json()).ok).toBe(true);

    const submission = await request(createOrder, '/api/orders', order(accepted));
    expect(submission.status).toBe(201);
    expect(countMemoryOrders()).toBe(1);
  });

  it.each([
    ['hidden active model ms-strong', configuration({ modelSlug: 'ms-strong' })],
    ['hidden active model archive-ms', configuration({ modelSlug: 'archive-ms' })],
    ['active but non-public accessory', configuration({ accessories: [{ accessoryId: 'acc-extra-shelf', quantity: 1 }] })],
    ['metal foot pad with no commercial component', configuration({ metalFootPad: true })],
    ['shelf corner brackets with no commercial component', configuration({ shelfCornerBrackets: true })],
  ])('rejects a crafted raw request for %s without creating an order', async (_label, forged) => {
    const pricing = await request(calculatePrice, '/api/pricing/calculate', forged);
    expect(pricing.status).toBe(422);
    const priceJson = await pricing.json();
    expect(priceJson).toMatchObject({ ok: false, code: 'INCOMPATIBLE_CONFIGURATION' });
    expect(priceJson).not.toHaveProperty('bom');

    const submission = await request(createOrder, '/api/orders', order(forged));
    expect(submission.status).toBe(422);
    expect(await submission.json()).toMatchObject({ ok: false, code: 'INCOMPATIBLE_CONFIGURATION' });
    expect(countMemoryOrders()).toBe(0);
  });
});
