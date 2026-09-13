import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as ordersPost } from '@/app/api/orders/route';
import { getOrderByNumber, clearMemoryOrders } from '@/lib/orders/store';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * The internal/public boundary around an order.
 *
 * /admin/orders deliberately reads and writes data a customer must never see:
 * internal notes, who is responsible for the order, the internal BOM, and the
 * audit trail behind both. This file is the regression net for that boundary,
 * and it checks it from two directions:
 *
 *   1. behaviourally — the payloads a customer actually receives carry none
 *      of those fields, at any depth, under any name;
 *   2. structurally — no customer-facing module even imports the admin order
 *      service or the audit helper, so a future page cannot pass one of those
 *      objects to the browser by accident.
 *
 * The purchase-price half of the same boundary lives in
 * tests/integration/public-price-leak.test.ts; the two are deliberately
 * separate files because they guard different secrets.
 */

const FORBIDDEN_KEYS = [
  'internalNotes',
  'managerId',
  'manager',
  'auditLog',
  'previousData',
  'newData',
  'passwordHash',
  'purchasePrice',
  'unitCost',
  'supplierRef',
];

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found);
    }
  }
  return found;
}

function expectNoForbiddenKeys(payload: unknown, label: string) {
  const keys = collectKeys(payload);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.has(forbidden), `${label} leaks "${forbidden}"`).toBe(false);
  }
}

function testConfig(): ShelvingConfiguration {
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
  };
}

async function placeOrder(ip: string) {
  const request = new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      fullName: 'Тест Тестов',
      phone: '+77001234567',
      email: 'test@example.com',
      city: 'Алматы',
      customerType: 'INDIVIDUAL',
      paymentPreference: 'BANK_TRANSFER',
      items: [{ configuration: testConfig() }],
    }),
  });
  const response = await ordersPost(request);
  return { response, json: await response.json() };
}

describe('POST /api/orders — the customer never receives internal order data', () => {
  it('answers with the order number and total only', async () => {
    clearMemoryOrders();
    const { response, json } = await placeOrder('198.51.100.41');
    expect(response.status).toBe(201);
    expect(Object.keys(json).sort()).toEqual(['grandTotal', 'ok', 'orderNumber']);
    expectNoForbiddenKeys(json, 'POST /api/orders');
    clearMemoryOrders();
  });

  it('accepts no internal field from the browser — a client-supplied note or manager is ignored', async () => {
    clearMemoryOrders();
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.42' },
      body: JSON.stringify({
        fullName: 'Тест Тестов',
        phone: '+77001234568',
        email: 'test@example.com',
        city: 'Алматы',
        customerType: 'INDIVIDUAL',
        paymentPreference: 'BANK_TRANSFER',
        internalNotes: 'дайте скидку 90%',
        managerId: 'manager-1',
        status: 'PAID',
        grandTotal: 1,
        items: [{ configuration: testConfig() }],
      }),
    });
    const response = await ordersPost(request);
    const json = await response.json();
    expect(response.status).toBe(201);

    const stored = await getOrderByNumber(json.orderNumber);
    expect(stored).toBeDefined();
    // Not merely absent from the response: never persisted, and the totals
    // are the server's own, not the one the browser asked for.
    expectNoForbiddenKeys(stored, 'persisted order record');
    expect(stored?.status).toBe('NEW');
    expect(stored?.grandTotal).toBeGreaterThan(1);
    clearMemoryOrders();
  });
});

describe('the order record behind /order/success', () => {
  it('carries no internal notes, manager or audit data', async () => {
    clearMemoryOrders();
    const { json } = await placeOrder('198.51.100.43');
    const order = await getOrderByNumber(json.orderNumber);
    expect(order).toBeDefined();
    expectNoForbiddenKeys(order, 'getOrderByNumber');
    clearMemoryOrders();
  });
});

/* -------------------------------------------------------------------------- */
/* Structural: what customer-facing code is allowed to import                  */
/* -------------------------------------------------------------------------- */

const SRC = join(process.cwd(), 'src');

/** Modules that exist to serve the admin area, and must stay there. */
const ADMIN_ONLY_MODULES = [
  '@/lib/admin/orders',
  '@/lib/admin/prices',
  '@/lib/admin/audit',
  '@/lib/admin/internal-notes',
];

/** Everything under these paths is behind the admin session. */
function isAdminPath(relativePath: string): boolean {
  const normalized = relativePath.split(sep).join('/');
  return (
    normalized.startsWith('app/admin/') ||
    normalized.startsWith('app/api/admin/') ||
    normalized.startsWith('components/admin/') ||
    normalized.startsWith('lib/admin/')
  );
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

describe('module boundary', () => {
  const customerFacingFiles = walk(SRC)
    .map((file) => relative(SRC, file))
    .filter((file) => !isAdminPath(file));

  it('finds customer-facing source to check', () => {
    expect(customerFacingFiles.length).toBeGreaterThan(20);
  });

  it.each(ADMIN_ONLY_MODULES)('no customer-facing module imports %s at runtime', (module) => {
    const offenders = customerFacingFiles.filter((file) => {
      const source = readFileSync(join(SRC, file), 'utf8');
      // `import type` is erased at build time and cannot carry a value into a
      // customer payload; a value import can.
      const valueImport = new RegExp(`import\\s+(?!type\\s)[^;]*?from\\s+['"]${module}['"]`, 's');
      const dynamicImport = new RegExp(`import\\(\\s*['"]${module}['"]`);
      return valueImport.test(source) || dynamicImport.test(source);
    });
    expect(offenders, `imported by: ${offenders.join(', ')}`).toEqual([]);
  });
});
