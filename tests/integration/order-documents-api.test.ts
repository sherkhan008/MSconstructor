import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Catalog } from '@/lib/data/repository';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { decimal, orderSource } from './helpers/order-document-fixtures';
import { readPdfText } from './helpers/pdf-text';

/**
 * GET /api/admin/orders/:id/documents/:kind
 *
 * The route is exercised end to end — session cookie, authorization, the
 * Prisma read, the catalog label lookup and the real PDF renderer — with only
 * the database client and the cookie store replaced.
 */

const AUTH_SECRET = 'test-secret-do-not-use-in-production-please';

const SELLER_ENV = {
  SELLER_LEGAL_NAME: 'ТОО «Тестовый Продавец»',
  SELLER_BIN: '987654321098',
  SELLER_ADDRESS: 'г. Астана, ул. Тестовая, 1',
  SELLER_BANK_NAME: 'АО «Тестовый Банк»',
  SELLER_IBAN: 'KZ000000000000000000',
  SELLER_BIC: 'TESTKZKA',
  SELLER_KBE: '17',
};

/** The row shape Prisma returns for loadOrderDocumentSource's select. */
function prismaRow(source = orderSource()) {
  return {
    id: source.id,
    orderNumber: source.orderNumber,
    createdAt: source.createdAt,
    paymentPreference: source.paymentPreference,
    deliveryMethodId: source.delivery.methodId,
    deliveryAddress: source.delivery.address,
    deliveryCity: source.delivery.city,
    deliveryFloor: source.delivery.floor,
    deliveryHasLift: source.delivery.hasLift,
    deliveryDate: source.delivery.date,
    netTotal: source.netTotal,
    vatTotal: source.vatTotal,
    discountTotal: source.discountTotal,
    grandTotal: source.grandTotal,
    customer: source.customer,
    items: source.items,
  };
}

interface SetupOptions {
  role?: string | null;
  row?: unknown;
  sellerEnv?: Record<string, string>;
  catalog?: Catalog;
}

async function setup(opts: SetupOptions = {}) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', AUTH_SECRET);
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  for (const [key, value] of Object.entries(opts.sellerEnv ?? {})) vi.stubEnv(key, value);

  let token: string | undefined;
  if (opts.role !== null) {
    const { createSessionToken } = await import('@/lib/auth/session');
    token = await createSessionToken({ id: 'admin-1', email: 'a@b.com', name: 'Админ', role: (opts.role ?? 'ADMIN') as never });
  }
  vi.doMock('next/headers', () => ({
    cookies: vi.fn(async () => ({ get: vi.fn(() => (token ? { value: token } : undefined)) })),
  }));

  const order = {
    findUnique: vi.fn(async () => (opts.row === undefined ? prismaRow() : opts.row)),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  const auditLog = { create: vi.fn() };
  const $transaction = vi.fn();
  vi.doMock('@/lib/db/client', () => ({ prisma: { order, auditLog, $transaction } }));

  // The catalog is only a name source for the documents; the in-memory seed
  // catalog stands in for the database one.
  const catalog = opts.catalog ?? (await memoryCatalog());
  vi.doMock('@/lib/data/repository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data/repository')>()),
    getCatalog: vi.fn(async () => catalog),
  }));

  const { GET } = await import('@/app/api/admin/orders/[id]/documents/[kind]/route');
  const call = (id: string, kind: string, query = '') =>
    GET(new NextRequest(`http://localhost/api/admin/orders/${id}/documents/${kind}${query}`), {
      params: Promise.resolve({ id, kind }),
    });
  return { call, order, auditLog, $transaction, catalog };
}

/** A fresh in-memory seed catalog, loaded with no DATABASE_URL in scope. */
async function memoryCatalog(): Promise<Catalog> {
  const saved = process.env.DATABASE_URL;
  vi.stubEnv('DATABASE_URL', '');
  vi.resetModules();
  const { getCatalog, resetCatalogCache } = await import('@/lib/data/repository');
  resetCatalogCache();
  const catalog = await getCatalog();
  vi.stubEnv('DATABASE_URL', saved ?? '');
  vi.resetModules();
  return catalog;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
  vi.doUnmock('@/lib/data/repository');
});

describe('authorization', () => {
  it('rejects a request without an admin session (401) and reads nothing', async () => {
    const { call, order } = await setup({ role: null });
    const response = await call('order-doc-1', 'invoice');
    expect(response.status).toBe(401);
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it('rejects CONTENT_MANAGER (403) and reads nothing', async () => {
    const { call, order } = await setup({ role: 'CONTENT_MANAGER' });
    const response = await call('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(403);
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])('allows %s', async (role) => {
    const { call } = await setup({ role });
    const response = await call('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(200);
  });
});

describe('input validation and missing orders', () => {
  it('404 for an unknown document kind, without a query', async () => {
    const { call, order } = await setup();
    for (const kind of ['receipt', '..', 'invoice.pdf', '%2e%2e%2fetc']) {
      expect((await call('order-doc-1', kind)).status).toBe(404);
    }
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it('404 for an implausible order id (path traversal, spaces), without a query', async () => {
    const { call, order } = await setup();
    for (const id of ['../../etc/passwd', 'a b', '', 'x'.repeat(65), "1' OR '1'='1"]) {
      expect((await call(id, 'invoice')).status).toBe(404);
    }
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it('404 for an order that does not exist', async () => {
    const { call } = await setup({ row: null });
    const response = await call('cmissingorder000000000000', 'commercial-proposal');
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('NOT_FOUND');
  });
});

describe('seller configuration', () => {
  it('refuses an invoice with 422 and names every missing variable — no fake bank details', async () => {
    const { call } = await setup();
    const response = await call('order-doc-1', 'invoice');
    expect(response.status).toBe(422);
    const json = await response.json();
    const details = (json.details as string[]).join('\n');
    for (const name of ['SELLER_LEGAL_NAME', 'SELLER_BIN', 'SELLER_ADDRESS', 'SELLER_BANK_NAME', 'SELLER_IBAN', 'SELLER_BIC', 'SELLER_KBE']) {
      expect(details).toContain(name);
    }
  });

  it('generates a commercial proposal without seller legal details and prints no placeholder BIN', async () => {
    const { call } = await setup();
    const response = await call('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(200);
    const { flat } = await readPdfText(new Uint8Array(await response.arrayBuffer()));
    expect(flat).toContain('MS Стеллажи');
    expect(flat).not.toContain('000000000000');
    expect(flat).not.toContain('MS Стеллаж Казахстан');
  });

  it('generates the invoice once the seller is configured', async () => {
    const { call } = await setup({ sellerEnv: SELLER_ENV });
    const response = await call('order-doc-1', 'invoice');
    expect(response.status).toBe(200);
    const { flat } = await readPdfText(new Uint8Array(await response.arrayBuffer()));
    expect(flat).toContain('Счёт на оплату № INV-MS-20260830-4HB57');
    expect(flat).toContain('Всего к оплате 222 696,00 ₸');
  });
});

describe('response', () => {
  it('is a private, uncached PDF with a safe file name, inline or as a download', async () => {
    const { call } = await setup({ sellerEnv: SELLER_ENV });
    const inline = await call('order-doc-1', 'invoice');
    expect(inline.headers.get('content-type')).toBe('application/pdf');
    expect(inline.headers.get('content-disposition')).toBe('inline; filename="INV-MS-20260830-4HB57.pdf"');
    expect(inline.headers.get('cache-control')).toContain('no-store');
    const body = new Uint8Array(await inline.arrayBuffer());
    expect(Buffer.from(body.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(inline.headers.get('content-length')).toBe(String(body.length));

    const download = await call('order-doc-1', 'commercial-proposal', '?download=1');
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="KP-MS-20260830-4HB57.pdf"');
  });

  it('409 instead of a document when the stored totals contradict each other', async () => {
    const broken = prismaRow({ ...orderSource(), grandTotal: decimal(1) });
    const { call } = await setup({ row: broken });
    const response = await call('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(409);
  });
});

describe('privacy and read-only access', () => {
  it('selects an explicit allow-list: no internal notes, manager, history, audit or costs', async () => {
    const { call, order } = await setup();
    await call('order-doc-1', 'commercial-proposal');
    expect(order.findUnique).toHaveBeenCalledTimes(1);
    const args = order.findUnique.mock.calls[0] as unknown as [{ where: unknown; select: Record<string, unknown>; include?: unknown }];
    const query = args[0];
    expect(query.where).toEqual({ id: 'order-doc-1' });
    expect(query.include).toBeUndefined();
    const selected = JSON.stringify(query.select);
    for (const forbidden of ['internalNotes', 'manager', 'managerId', 'statusHistory', 'payments', 'quotes', 'comment', 'whatsapp', 'purchasePrice', 'unitCost', 'supplierRef', 'markup']) {
      expect(selected, `document query selects "${forbidden}"`).not.toMatch(new RegExp(`"${forbidden}"`));
    }
  });

  it('never writes: repeated generation mutates nothing and returns identical bytes', async () => {
    const { call, order, auditLog, $transaction } = await setup({ sellerEnv: SELLER_ENV });
    const first = Buffer.from(await (await call('order-doc-1', 'invoice')).arrayBuffer());
    const second = Buffer.from(await (await call('order-doc-1', 'invoice')).arrayBuffer());
    expect(first.equals(second)).toBe(true);
    for (const write of [order.update, order.updateMany, order.create, order.delete, auditLog.create, $transaction]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('a client cannot inject amounts: query parameters are ignored', async () => {
    const { call } = await setup({ sellerEnv: SELLER_ENV });
    const response = await call('order-doc-1', 'invoice', '?grandTotal=1&vatTotal=0&price=1&download=0');
    const { flat } = await readPdfText(new Uint8Array(await response.arrayBuffer()));
    expect(flat).toContain('Всего к оплате 222 696,00 ₸');
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
  });
});

describe('historical immutability — a saved order is never repriced', () => {
  function shelvingConfiguration(): ShelvingConfiguration {
    return {
      modelSlug: 'ms-standard',
      height: 2000,
      depth: 400,
      shelves: 5,
      sections: [
        { id: 'h-1', width: 1000, rearWall: false, leftWall: false, rightWall: false },
        { id: 'h-2', width: 700, rearWall: false, leftWall: false, rightWall: false },
      ],
      loadCapacity: 150,
      shelfType: 'STANDARD',
      colorId: 'color-grey',
      accessories: [{ accessoryId: 'acc-extra-shelf', quantity: 2 }],
      assemblyId: 'assembly-professional',
      deliveryId: 'delivery-pickup',
      // 3 sets → the quantity-break discount applies.
      quantity: 3,
    };
  }

  it('changing component, accessory, markup, colour, assembly and VAT settings changes neither document', async () => {
    const catalog = await memoryCatalog();
    const { calculatePrice, stripBomCosts } = await import('@/lib/pricing');

    // 1. Place the order exactly the way POST /api/orders + saveOrderToDb do.
    const priced = calculatePrice(shelvingConfiguration(), catalog);
    if (!priced.ok) throw new Error(`fixture configuration must price: ${priced.message}`);
    const b = priced.breakdown;
    expect(b.discount).toBeGreaterThan(0);
    expect(b.assembly).toBeGreaterThan(0);

    const persisted = orderSource({
      items: [
        {
          id: 'hist-item-1',
          configuration: priced.configuration,
          bomSnapshot: stripBomCosts(priced.bom),
          quantity: priced.configuration.quantity,
          unitNetPrice: decimal(b.unitNet),
          totalNetPrice: decimal(b.net),
        },
      ],
      netTotal: decimal(b.net),
      vatTotal: decimal(b.vat),
      discountTotal: decimal(b.discount),
      grandTotal: decimal(b.total),
    });
    const row = prismaRow(persisted);
    const rowBefore = JSON.stringify(row, (_k, v) => (v && typeof v === 'object' && typeof v.toFixed === 'function' ? v.toFixed(2) : v));

    const env = { ...SELLER_ENV };
    const before = await setup({ row, catalog, sellerEnv: env });
    const kpBefore = Buffer.from(await (await before.call('order-doc-1', 'commercial-proposal')).arrayBuffer());
    const invBefore = Buffer.from(await (await before.call('order-doc-1', 'invoice')).arrayBuffer());

    // 2. Today's catalog moves on.
    for (const component of catalog.components) {
      component.sellingPrice *= 3;
      component.purchasePrice *= 3;
    }
    for (const accessory of catalog.accessories) {
      accessory.unitPrice *= 3;
      accessory.purchasePrice *= 3;
    }
    for (const model of catalog.models) {
      model.markupPercent += 40;
      model.markupFixed += 5000;
    }
    for (const color of catalog.colors) color.pricePercent += 10;
    for (const assembly of catalog.assemblyServices) assembly.value *= 2;
    catalog.pricingSettings.vatPercent = 20;
    catalog.pricingSettings.quantityBreaks = [];

    // Sanity: repricing the same configuration today WOULD give other numbers.
    const repriced = calculatePrice(shelvingConfiguration(), catalog);
    if (!repriced.ok) throw new Error('repricing must succeed');
    expect(repriced.breakdown.unitNet).not.toBe(b.unitNet);
    expect(repriced.breakdown.net).not.toBe(b.net);
    expect(repriced.breakdown.vat).not.toBe(b.vat);
    expect(repriced.breakdown.total).not.toBe(b.total);

    // 3. Documents generated after the change, against the changed catalog.
    const after = await setup({ row, catalog, sellerEnv: env });
    const kpAfter = Buffer.from(await (await after.call('order-doc-1', 'commercial-proposal')).arrayBuffer());
    const invAfter = Buffer.from(await (await after.call('order-doc-1', 'invoice')).arrayBuffer());

    expect(kpAfter.equals(kpBefore)).toBe(true);
    expect(invAfter.equals(invBefore)).toBe(true);

    const fmt = (tenge: number) => `${tenge.toLocaleString('ru-RU').replace(/\s/g, ' ')},00`;
    for (const bytes of [kpAfter, invAfter]) {
      const { flat } = await readPdfText(new Uint8Array(bytes));
      expect(flat).toContain(fmt(b.unitNet));
      expect(flat).toContain(`Итого без НДС ${fmt(b.net)} ₸`);
      expect(flat).toContain(`Скидка (учтена в суммах позиций) ${fmt(b.discount)} ₸`);
      expect(flat).toContain(`НДС ${fmt(b.vat)} ₸`);
      expect(flat).toContain(`${fmt(b.total)} ₸`);
      for (const today of [repriced.breakdown.unitNet, repriced.breakdown.net, repriced.breakdown.vat, repriced.breakdown.total]) {
        expect(flat).not.toContain(fmt(today));
      }
    }

    // The persisted item values themselves were not touched either.
    const rowAfter = JSON.stringify(row, (_k, v) => (v && typeof v === 'object' && typeof v.toFixed === 'function' ? v.toFixed(2) : v));
    expect(rowAfter).toBe(rowBefore);
  });
});
