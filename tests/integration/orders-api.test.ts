import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { clearMemoryOrders, countMemoryOrders, getOrderByNumber } from '@/lib/orders/store';

let ipCounter = 0;
function postOrder(body: unknown): Promise<Response> {
  ipCounter += 1;
  const request = new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${ipCounter}` },
    body: JSON.stringify(body),
  });
  return POST(request);
}

function validOrderBody(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Тест Тестов',
    phone: '+77001234567',
    email: 'test@example.com',
    city: 'Алматы',
    customerType: 'INDIVIDUAL',
    paymentPreference: 'BANK_TRANSFER',
    items: [
      {
        configuration: {
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
        },
      },
    ],
    ...overrides,
  };
}

describe('POST /api/orders', () => {
  beforeEach(() => {
    clearMemoryOrders();
  });

  it('creates an order for a valid individual submission', async () => {
    const response = await postOrder(validOrderBody());
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.orderNumber).toMatch(/^MS-\d{8}-/);
    expect(json.grandTotal).toBeGreaterThan(0);
  });

  it('rejects KASPI_PAY submitted directly to the API, bypassing the UI', async () => {
    const response = await postOrder(validOrderBody({ paymentPreference: 'KASPI_PAY' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('rejects KASPI_QR submitted directly to the API', async () => {
    const response = await postOrder(validOrderBody({ paymentPreference: 'KASPI_QR' }));
    expect(response.status).toBe(400);
  });

  it('ignores a client-supplied total/grandTotal and saves only the server-recalculated total', async () => {
    const response = await postOrder({
      ...validOrderBody(),
      grandTotal: 1,
      total: 1,
      breakdown: { total: 1 },
    });
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.grandTotal).toBeGreaterThan(1);

    const saved = await getOrderByNumber(json.orderNumber);
    expect(saved?.grandTotal).toBe(json.grandTotal);
    expect(saved?.grandTotal).toBeGreaterThan(1);
  });

  it('creates the order with status NEW, never PAID or AWAITING_PAYMENT, regardless of payment preference', async () => {
    const response = await postOrder(validOrderBody({ paymentPreference: 'BANK_INVOICE' }));
    const json = await response.json();
    expect(response.status).toBe(201);

    const saved = await getOrderByNumber(json.orderNumber);
    expect(saved?.status).toBe('NEW');
  });

  it('requires a delivery address when the selected delivery method requires one', async () => {
    const response = await postOrder(
      validOrderBody({
        items: [
          {
            configuration: {
              ...validOrderBody().items[0].configuration,
              deliveryId: 'delivery-city',
            },
          },
        ],
      }),
    );
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it('accepts city delivery when a delivery address is provided', async () => {
    const response = await postOrder(
      validOrderBody({
        deliveryAddress: 'ул. Абая 10',
        items: [
          {
            configuration: {
              ...validOrderBody().items[0].configuration,
              deliveryId: 'delivery-city',
            },
          },
        ],
      }),
    );
    expect(response.status).toBe(201);
  });

  it('rejects a legal entity submission missing a valid BIN', async () => {
    const response = await postOrder(
      validOrderBody({ customerType: 'LEGAL_ENTITY', companyName: 'ТОО Ромашка' }),
    );
    expect(response.status).toBe(400);
  });

  it('creates an order for a legal entity with a company name and a valid 12-digit BIN', async () => {
    const response = await postOrder(
      validOrderBody({ customerType: 'LEGAL_ENTITY', companyName: 'ТОО Ромашка', binIin: '123456789012' }),
    );
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
  });

  describe('required fields are rejected with a structured 400, and create zero orders', () => {
    it('rejects an empty fullName', async () => {
      const response = await postOrder(validOrderBody({ fullName: '' }));
      const json = await response.json();
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects a whitespace-only fullName', async () => {
      const response = await postOrder(validOrderBody({ fullName: '   ' }));
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects an empty phone', async () => {
      const response = await postOrder(validOrderBody({ phone: '' }));
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects a structurally invalid phone', async () => {
      const response = await postOrder(validOrderBody({ phone: '12345' }));
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects an empty email', async () => {
      const response = await postOrder(validOrderBody({ email: '' }));
      const json = await response.json();
      expect(response.status).toBe(400);
      // The failed field is machine-readable in fieldErrors; the displayed
      // details carry the message alone, without an "email:" prefix.
      expect(json.fieldErrors?.some((e: { field: string }) => e.field === 'email')).toBe(true);
      expect(json.details?.some((d: string) => d.startsWith('email:'))).toBe(false);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects an invalid email', async () => {
      const response = await postOrder(validOrderBody({ email: 'abc' }));
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects a legal entity submission with no company name', async () => {
      const response = await postOrder(validOrderBody({ customerType: 'LEGAL_ENTITY', binIin: '123456789012' }));
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects a legal entity submission with an invalid BIN', async () => {
      const response = await postOrder(
        validOrderBody({ customerType: 'LEGAL_ENTITY', companyName: 'ТОО Ромашка', binIin: '123' }),
      );
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects a request with the payment method field missing entirely', async () => {
      const body = validOrderBody();
      delete (body as { paymentPreference?: unknown }).paymentPreference;
      const response = await postOrder(body);
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects an unsupported payment method (KASPI_PAY) and creates zero orders', async () => {
      const response = await postOrder(validOrderBody({ paymentPreference: 'KASPI_PAY' }));
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('rejects a missing delivery address when the selected delivery method requires one, creating zero orders', async () => {
      const response = await postOrder(
        validOrderBody({
          items: [{ configuration: { ...validOrderBody().items[0].configuration, deliveryId: 'delivery-city' } }],
        }),
      );
      expect(response.status).toBe(400);
      expect(countMemoryOrders()).toBe(0);
    });

    it('never leaks Zod/Prisma internals or a stack trace in the response body', async () => {
      const response = await postOrder(validOrderBody({ fullName: '' }));
      const text = await response.text();
      expect(text).not.toMatch(/ZodError|PrismaClientKnownRequestError|at Object\.<anonymous>|node_modules/);
    });
  });
});
