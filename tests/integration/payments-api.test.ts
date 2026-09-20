import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as paymentsPost } from '@/app/api/payments/route';
import { POST as ordersPost } from '@/app/api/orders/route';
import PaymentPage from '@/app/payment/page';
import { clearMemoryOrders, countMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { clearMemoryPayments, countMemoryPayments } from '@/lib/payments/store';
import { isOnlinePaymentAvailable } from '@/lib/payments/config';
import { CUSTOMER_PAYMENT_METHODS } from '@/lib/pricing/schema';
import { PAYMENT_METHOD_DESCRIPTION } from '@/lib/orders/payment-methods';

/**
 * The public surface of online payment, which in this build is: nothing.
 *
 * These tests are written against the SHIPPED configuration (no
 * PAYMENTS_ENABLED, no registered adapter), because the thing worth proving
 * is that the default build exposes no payment capability at all — not that
 * some hypothetical enabled build would behave.
 */

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.1.0.${ipCounter % 250}`;
}

function postPayment(body: unknown): Promise<Response> {
  return paymentsPost(
    new NextRequest('http://localhost/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify(body),
    }),
  );
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

/** Every HTTP route in the app, as source — the set of things a request can
 * possibly reach. Read from disk so a route added later is covered without
 * anyone remembering to list it here. */
function apiRoutes(): { file: string; source: string }[] {
  const root = path.join(process.cwd(), 'src', 'app', 'api');
  const out: { file: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') {
        out.push({ file: path.relative(root, full).split(path.sep).join('/'), source: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(root);
  return out;
}

function postOrder(body: unknown): Promise<Response> {
  return ordersPost(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  clearMemoryOrders();
  clearMemoryPayments();
});

/* -------------------------------------------------------------------------- */

describe('POST /api/payments — unavailable in this build', () => {
  it('is disabled by default', () => {
    expect(isOnlinePaymentAvailable()).toBe(false);
  });

  it('answers 404, not 403 — the route advertises no capability', async () => {
    const response = await postPayment({ orderNumber: 'MS-20260920-AAAAA' });
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('NOT_FOUND');
  });

  it('leaks nothing about payments, providers or the flag in its response', async () => {
    const body = await (await postPayment({ orderNumber: 'MS-20260920-AAAAA' })).text();
    for (const term of ['payment', 'оплат', 'kaspi', 'provider', 'PAYMENTS_ENABLED', 'disabled', 'PENDING']) {
      expect(body.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it('writes nothing, whatever the body claims', async () => {
    const forged = [
      { orderNumber: 'MS-20260920-AAAAA', amount: 1 },
      { orderNumber: 'MS-20260920-AAAAA', status: 'PAID' },
      { orderNumber: 'MS-20260920-AAAAA', provider: 'kaspi', grandTotal: 1, paidAt: '2026-01-01' },
      { amount: 1 },
      {},
      'not json at all',
    ];
    for (const body of forged) {
      expect((await postPayment(body)).status).toBe(404);
    }
    expect(countMemoryPayments()).toBe(0);
  });

  it('answers a real, payable order exactly the same way', async () => {
    const created = await (await postOrder(validOrderBody())).json();
    const response = await postPayment({ orderNumber: created.orderNumber });
    expect(response.status).toBe(404);
    expect(countMemoryPayments()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('no public route can mark anything PAID', () => {
  it('the payment route cannot, even when it is the only thing asked for', async () => {
    const created = await (await postOrder(validOrderBody())).json();
    await postPayment({ orderNumber: created.orderNumber, status: 'PAID' });

    const order = await getOrderByNumber(created.orderNumber);
    expect(order?.status).toBe('NEW');
    expect(countMemoryPayments()).toBe(0);
  });

  it('order creation always starts at NEW and ignores a claimed status', async () => {
    const created = await (await postOrder(validOrderBody({ status: 'PAID' }))).json();
    expect((await getOrderByNumber(created.orderNumber))?.status).toBe('NEW');
  });

  it('exposes no route at all that confirms a payment', () => {
    // confirmPaymentWithProvider is the ONLY producer of PAID. Nothing
    // reachable over HTTP — admin routes included — may import it, so there
    // is no request of any kind that reaches it.
    const importers = apiRoutes().filter(({ source }) =>
      /import[^;]*confirmPaymentWithProvider/s.test(source),
    );
    expect(importers.map((r) => r.file)).toEqual([]);
  });

  it('drives the order workflow from the admin route only', () => {
    // updateOrderStatus is the single writer of Order.status. Only the
    // authenticated admin route may call it directly; the payment path goes
    // through the service, which asserts the PAYMENT_PROVIDER channel.
    const callers = apiRoutes()
      .filter(({ source }) => source.includes('updateOrderStatus'))
      .map((r) => r.file);
    expect(callers).toEqual(['admin/orders/[id]/status/route.ts']);
  });

  it('lets no route assert a trusted status channel from request input', () => {
    for (const { file, source } of apiRoutes()) {
      // A channel must be a literal the route decides, never read from a body.
      const channels = source.match(/channel:\s*[^,\n]+/g) ?? [];
      for (const channel of channels) {
        expect(`${file}: ${channel}`).toMatch(/channel: '(ADMIN|PAYMENT_PROVIDER|PUBLIC)'/);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('existing checkout is unchanged', () => {
  it('still creates an order through the offline methods', async () => {
    for (const paymentPreference of CUSTOMER_PAYMENT_METHODS) {
      clearMemoryOrders();
      const response = await postOrder(validOrderBody({ paymentPreference }));
      const json = await response.json();
      expect(response.status).toBe(201);
      expect(json.ok).toBe(true);
      expect(json.grandTotal).toBeGreaterThan(0);
      expect(countMemoryOrders()).toBe(1);
    }
  });

  it('offers only the three manager-confirmed methods, none of them online', () => {
    expect([...CUSTOMER_PAYMENT_METHODS]).toEqual(['BANK_TRANSFER', 'BANK_INVOICE', 'CASH']);
    for (const method of CUSTOMER_PAYMENT_METHODS) {
      expect(PAYMENT_METHOD_DESCRIPTION[method]).toBeTruthy();
    }
  });

  it('still refuses an online method at checkout', async () => {
    for (const paymentPreference of ['KASPI_PAY', 'KASPI_QR']) {
      const response = await postOrder(validOrderBody({ paymentPreference }));
      expect(response.status).toBe(400);
    }
    expect(countMemoryOrders()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('no fake payment availability in the UI', () => {
  it('the /payment page offers no online payment action', () => {
    const rendered = JSON.stringify(PaymentPage());
    // Kaspi may be named as "coming soon" — but nothing may invite a click.
    expect(rendered).not.toContain('/api/payments');
    expect(rendered).not.toContain('Оплатить');
    expect(rendered).toContain('Скоро');
  });

  it('the checkout form never references the payment route or an online method', () => {
    const form = readFileSync(path.join(process.cwd(), 'src', 'components', 'order', 'OrderForm.tsx'), 'utf8');
    expect(form).not.toContain('/api/payments');
    expect(form).not.toContain('KASPI');
  });

  it('no client component imports the payment service, provider or registry', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        const source = readFileSync(full, 'utf8');
        if (!/^\s*['"]use client['"]/m.test(source)) continue;
        if (/@\/lib\/payments\/(service|provider|registry|config|store|db-store)/.test(source)) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('no secrets or private pricing in the payment layer', () => {
  const paymentsDir = path.join(process.cwd(), 'src', 'lib', 'payments');
  const sources = readdirSync(paymentsDir).map((f) => ({
    file: f,
    source: readFileSync(path.join(paymentsDir, f), 'utf8'),
  }));

  it('contains no credential, endpoint or key material', () => {
    // A provider-neutral foundation must not have guessed at any of this.
    const forbidden = [
      /https?:\/\/(?!provider\.example)[a-z0-9.-]*kaspi/i,
      /api[_-]?key\s*[:=]\s*['"]/i,
      /secret\s*[:=]\s*['"][^'"]+['"]/i,
      /merchant[_-]?id\s*[:=]\s*['"]/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /service[_-]?id\s*[:=]\s*['"]/i,
    ];
    const hits = sources.flatMap(({ file, source }) =>
      forbidden.filter((pattern) => pattern.test(source)).map((pattern) => `${file} matches ${pattern}`),
    );
    expect(hits).toEqual([]);
  });

  it('reads no NEXT_PUBLIC_ variable — nothing here is inlined into the bundle', () => {
    for (const { source } of sources) {
      expect(source).not.toContain('NEXT_PUBLIC_');
    }
  });

  it('never touches supplier, cost or markup data', () => {
    for (const { source } of sources) {
      for (const term of ['supplierRef', 'purchasePrice', 'markupPercent', 'markupFixed', 'unitCost', 'minMargin']) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('never logs a provider payload', () => {
    for (const { source } of sources) {
      expect(source).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});
