import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import type { Catalog } from '@/lib/data/repository';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { decimal, item, orderSource } from './helpers/order-document-fixtures';
import { readPdfText } from './helpers/pdf-text';

/**
 * GET /api/admin/orders/:id/documents/:kind (render, read-only)
 * POST /api/admin/orders/:id/documents/:kind/issue (issue, write-once)
 *
 * Both routes are exercised end to end — session cookie, authorization, the
 * Prisma read, issuance and the real PDF renderer — with only the database
 * client and the cookie store replaced. The fake OrderDocument table enforces
 * the same unique constraints as the migration (orderId+kind, documentNumber)
 * and raises a real Prisma P2002 error, so the race path is the real one.
 *
 * The two routes are deliberately separate: GET must never have a side
 * effect (a document link, a prefetch, a crawler hitting it must never
 * create anything), so issuance only ever happens through an explicit POST.
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

const SELLER_NAMES = ['SELLER_LEGAL_NAME', 'SELLER_BIN', 'SELLER_ADDRESS', 'SELLER_PHONE', 'SELLER_EMAIL', 'SELLER_BANK_NAME', 'SELLER_IBAN', 'SELLER_BIC', 'SELLER_KBE', 'SELLER_KNP'];

/** The row shape Prisma returns for loadOrderDocumentSource's select. */
function prismaRow(source = orderSource()) {
  return {
    id: source.id,
    orderNumber: source.orderNumber,
    createdAt: source.createdAt,
    buyerSnapshot: source.buyerSnapshot,
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
    items: source.items,
  };
}

interface DocumentRow {
  orderId: string;
  kind: 'COMMERCIAL_PROPOSAL' | 'INVOICE';
  documentNumber: string;
  issuedAt: Date;
  sellerSnapshot: unknown;
  issuedById: string | null;
  issuedByName: string;
}

/** An in-memory OrderDocument table with the migration's unique constraints.
 * `barrier` holds the first N lookups until N have arrived — two requests
 * that both see "not issued yet" before either creates. */
function documentTable(opts: { barrier?: number } = {}) {
  const rows: DocumentRow[] = [];
  const pick = (row: DocumentRow) => ({
    kind: row.kind,
    documentNumber: row.documentNumber,
    issuedAt: new Date(row.issuedAt),
    sellerSnapshot: JSON.parse(JSON.stringify(row.sellerSnapshot)),
    issuedByName: row.issuedByName,
  });

  let waiting: (() => void)[] = [];
  let lookups = 0;
  const gate = async () => {
    lookups += 1;
    if (!opts.barrier || lookups > opts.barrier) return;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length === opts.barrier) {
        waiting.forEach((release) => release());
        waiting = [];
      }
    });
  };

  const orderDocument = {
    findUnique: vi.fn(async ({ where }: { where: { orderId_kind: { orderId: string; kind: string } } }) => {
      await gate();
      const row = rows.find((r) => r.orderId === where.orderId_kind.orderId && r.kind === where.orderId_kind.kind);
      return row ? pick(row) : null;
    }),
    findMany: vi.fn(async ({ where }: { where: { orderId: string } }) => rows.filter((r) => r.orderId === where.orderId).map(pick)),
    create: vi.fn(async ({ data }: { data: DocumentRow }) => {
      if (rows.some((r) => (r.orderId === data.orderId && r.kind === data.kind) || r.documentNumber === data.documentNumber)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`orderId`,`kind`)', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const row = { ...data, issuedAt: new Date(data.issuedAt), sellerSnapshot: JSON.parse(JSON.stringify(data.sellerSnapshot)) };
      rows.push(row);
      return pick(row);
    }),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  return { rows, orderDocument };
}

interface SetupOptions {
  role?: string | null;
  row?: unknown;
  sellerEnv?: Record<string, string>;
  table?: ReturnType<typeof documentTable>;
  catalog?: Catalog;
}

async function setup(opts: SetupOptions = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('AUTH_SECRET', AUTH_SECRET);
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  for (const name of SELLER_NAMES) expect(process.env[name], `${name} must not leak into tests`).toBeUndefined();
  for (const [key, value] of Object.entries(opts.sellerEnv ?? {})) vi.stubEnv(key, value);

  let token: string | undefined;
  if (opts.role !== null) {
    const { createSessionToken } = await import('@/lib/auth/session');
    token = await createSessionToken({ id: 'admin-1', email: 'a@b.com', name: 'Админ Тестов', role: (opts.role ?? 'ADMIN') as never });
  }
  vi.doMock('next/headers', () => ({
    cookies: vi.fn(async () => ({ get: vi.fn(() => (token ? { value: token } : undefined)) })),
  }));

  const order = {
    findUnique: vi.fn(async () => (opts.row === undefined ? prismaRow() : opts.row)),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  const orderItem = { update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), delete: vi.fn() };
  const customer = { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), upsert: vi.fn() };
  const auditLog = { create: vi.fn() };
  const $transaction = vi.fn();
  const table = opts.table ?? documentTable();
  vi.doMock('@/lib/db/client', () => ({
    prisma: { order, orderItem, customer, auditLog, $transaction, orderDocument: table.orderDocument },
  }));

  // Documents must not consult today's catalog at all; a spy proves it.
  const getCatalog = vi.fn(async () => opts.catalog ?? ({} as Catalog));
  vi.doMock('@/lib/data/repository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data/repository')>()),
    getCatalog,
  }));

  const { GET } = await import('@/app/api/admin/orders/[id]/documents/[kind]/route');
  const { POST: ISSUE } = await import('@/app/api/admin/orders/[id]/documents/[kind]/issue/route');

  const call = (id: string, kind: string, query = '') =>
    GET(new NextRequest(`http://localhost/api/admin/orders/${id}/documents/${kind}${query}`), {
      params: Promise.resolve({ id, kind }),
    });
  const issue = (id: string, kind: string) =>
    ISSUE(new NextRequest(`http://localhost/api/admin/orders/${id}/documents/${kind}/issue`, { method: 'POST' }), {
      params: Promise.resolve({ id, kind }),
    });
  /** Issues (if needed) then renders — the two-step happy path most tests
   * exercise; each step is still a distinct, separately-observable request. */
  const bytes = async (id: string, kind: string, query = '') => {
    const issued = await issue(id, kind);
    expect([200, 201], `${kind} issue status`).toContain(issued.status);
    const response = await call(id, kind, query);
    expect(response.status, `${kind} render status`).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  /** Every mocked write that is not the issuance record itself. */
  const forbiddenWrites = [
    order.update, order.updateMany, order.upsert, order.create, order.delete,
    orderItem.update, orderItem.updateMany, orderItem.create, orderItem.delete,
    customer.update, customer.upsert, auditLog.create, $transaction,
    table.orderDocument.update, table.orderDocument.updateMany, table.orderDocument.upsert,
    table.orderDocument.delete, table.orderDocument.deleteMany,
  ];
  return { call, issue, bytes, order, customer, table, getCatalog, forbiddenWrites };
}

/** A fresh in-memory seed catalog, loaded with no DATABASE_URL in scope. */
async function memoryCatalog(): Promise<Catalog> {
  vi.stubEnv('DATABASE_URL', '');
  vi.resetModules();
  const { getCatalog, resetCatalogCache } = await import('@/lib/data/repository');
  resetCatalogCache();
  const catalog = await getCatalog();
  vi.resetModules();
  return catalog;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
  vi.doUnmock('@/lib/data/repository');
});

describe('authorization', () => {
  it('GET rejects a request without an admin session (401) and reads/issues nothing', async () => {
    const { call, order, table } = await setup({ role: null });
    const response = await call('order-doc-1', 'invoice');
    expect(response.status).toBe(401);
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it('POST /issue rejects a request without an admin session (401) and issues nothing', async () => {
    const { issue, order, table } = await setup({ role: null });
    const response = await issue('order-doc-1', 'invoice');
    expect(response.status).toBe(401);
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it('GET rejects CONTENT_MANAGER (403) and reads/issues nothing', async () => {
    const { call, order, table } = await setup({ role: 'CONTENT_MANAGER' });
    const response = await call('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(403);
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it('POST /issue rejects CONTENT_MANAGER (403) and issues nothing', async () => {
    const { issue, order, table } = await setup({ role: 'CONTENT_MANAGER' });
    const response = await issue('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(403);
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])('%s can issue and then render', async (role) => {
    const { issue, call } = await setup({ role });
    const issued = await issue('order-doc-1', 'commercial-proposal');
    expect(issued.status).toBe(201);
    const response = await call('order-doc-1', 'commercial-proposal');
    expect(response.status).toBe(200);
  });
});

describe('input validation and missing orders', () => {
  it('GET: 404 for an unknown document kind, without a query', async () => {
    const { call, order } = await setup();
    for (const kind of ['receipt', '..', 'invoice.pdf', '%2e%2e%2fetc', 'INVOICE', 'COMMERCIAL_PROPOSAL']) {
      expect((await call('order-doc-1', kind)).status).toBe(404);
    }
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it('POST /issue: 404 for an unknown document kind, and nothing is created', async () => {
    const { issue, order, table } = await setup();
    for (const kind of ['receipt', '..', 'invoice.pdf', '%2e%2e%2fetc', 'INVOICE', 'COMMERCIAL_PROPOSAL']) {
      expect((await issue('order-doc-1', kind)).status).toBe(404);
    }
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it('GET: 404 for an implausible order id (path traversal, spaces), without a query', async () => {
    const { call, order } = await setup();
    for (const id of ['../../etc/passwd', 'a b', '', 'x'.repeat(65), "1' OR '1'='1"]) {
      expect((await call(id, 'invoice')).status).toBe(404);
    }
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it('POST /issue: 404 for an implausible order id, and nothing is created', async () => {
    const { issue, order, table } = await setup();
    for (const id of ['../../etc/passwd', 'a b', '', 'x'.repeat(65), "1' OR '1'='1"]) {
      expect((await issue(id, 'invoice')).status).toBe(404);
    }
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it('GET: 404 for an order that does not exist, and nothing is issued', async () => {
    const { call, table } = await setup({ row: null });
    const response = await call('cmissingorder000000000000', 'commercial-proposal');
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('NOT_FOUND');
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });

  it('POST /issue: 404 for an order that does not exist, and nothing is issued', async () => {
    const { issue, table } = await setup({ row: null });
    const response = await issue('cmissingorder000000000000', 'commercial-proposal');
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('NOT_FOUND');
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });
});

describe('GET before issuance', () => {
  it('is refused (409) and performs zero writes, even though the order is otherwise ready', async () => {
    const { call, order, table, forbiddenWrites } = await setup({ sellerEnv: SELLER_ENV });
    const response = await call('order-doc-1', 'invoice');
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe('CONFLICT');
    expect(json.message).toContain('не выставлен');
    expect((json.details as string[]).join(' ')).toContain('issue');

    // Read-only: the order was loaded to validate content (so the message
    // can distinguish "not issued" from "legacy"/"contradictory"), but
    // nothing about it, and no OrderDocument, was ever written.
    expect(order.findUnique).toHaveBeenCalledTimes(1);
    expect(table.orderDocument.create).not.toHaveBeenCalled();
    expect(table.rows).toHaveLength(0);
    for (const write of forbiddenWrites) expect(write).not.toHaveBeenCalled();
  });
});

describe('seller configuration at first issuance', () => {
  it('POST /issue refuses an invoice with 422 and names every missing variable — no fake bank details, no row', async () => {
    const { issue, table } = await setup();
    const response = await issue('order-doc-1', 'invoice');
    expect(response.status).toBe(422);
    const details = ((await response.json()).details as string[]).join('\n');
    for (const name of ['SELLER_LEGAL_NAME', 'SELLER_BIN', 'SELLER_ADDRESS', 'SELLER_BANK_NAME', 'SELLER_IBAN', 'SELLER_BIC', 'SELLER_KBE']) {
      expect(details).toContain(name);
    }
    expect(table.rows).toHaveLength(0);
  });

  it('issues a commercial proposal without seller legal details and prints no placeholder BIN', async () => {
    const { bytes } = await setup();
    const { flat } = await readPdfText(new Uint8Array(await bytes('order-doc-1', 'commercial-proposal')));
    expect(flat).toContain('MS Стеллажи');
    expect(flat).not.toContain('000000000000');
    expect(flat).not.toContain('MS Стеллаж Казахстан');
  });

  it('issues the invoice once the seller is configured', async () => {
    const { bytes } = await setup({ sellerEnv: SELLER_ENV });
    const { flat } = await readPdfText(new Uint8Array(await bytes('order-doc-1', 'invoice')));
    expect(flat).toContain('Счёт на оплату № INV-MS-20260830-4HB57');
    expect(flat).toContain('Всего к оплате 222 696,00 ₸');
  });
});

describe('issuance lifecycle', () => {
  it('POST /issue writes exactly one OrderDocument row — and nothing else; GET afterwards writes nothing more', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T06:30:00.000Z'));
    const { issue, call, table, forbiddenWrites, customer } = await setup({ sellerEnv: SELLER_ENV });

    const issueResponse = await issue('order-doc-1', 'invoice');
    expect(issueResponse.status).toBe(201);
    const issueJson = await issueResponse.json();
    expect(issueJson).toMatchObject({ ok: true, kind: 'invoice', number: 'INV-MS-20260830-4HB57', created: true });

    expect(table.orderDocument.create).toHaveBeenCalledTimes(1);
    expect(table.rows).toEqual([
      {
        orderId: 'order-doc-1',
        kind: 'INVOICE',
        documentNumber: 'INV-MS-20260830-4HB57',
        issuedAt: new Date('2026-09-13T06:30:00.000Z'),
        sellerSnapshot: {
          version: 1,
          brandName: 'MS Стеллажи',
          details: {
            legalName: 'ТОО «Тестовый Продавец»',
            bin: '987654321098',
            address: 'г. Астана, ул. Тестовая, 1',
            bankName: 'АО «Тестовый Банк»',
            iban: 'KZ000000000000000000',
            bic: 'TESTKZKA',
            kbe: '17',
          },
        },
        issuedById: 'admin-1',
        issuedByName: 'Админ Тестов',
      },
    ]);
    for (const write of forbiddenWrites) expect(write).not.toHaveBeenCalled();
    expect(customer.findUnique).not.toHaveBeenCalled();

    const getResponse = await call('order-doc-1', 'invoice');
    expect(getResponse.status).toBe(200);
    // GET rendered the already-issued document; it created no second row.
    expect(table.orderDocument.create).toHaveBeenCalledTimes(1);
    for (const write of forbiddenWrites) expect(write).not.toHaveBeenCalled();

    const { flat } = await readPdfText(new Uint8Array(await getResponse.arrayBuffer()));
    expect(flat).toContain('Счёт на оплату № INV-MS-20260830-4HB57 от 13 сентября 2026 г.');
  });

  it('repeated POST /issue is idempotent: same number/date/issuer, no second row, 200 not 201 after the first', async () => {
    const { issue, table } = await setup({ sellerEnv: SELLER_ENV });
    const first = await issue('order-doc-1', 'invoice');
    expect(first.status).toBe(201);
    const firstJson = await first.json();

    for (let i = 0; i < 3; i += 1) {
      const again = await issue('order-doc-1', 'invoice');
      expect(again.status).toBe(200);
      const againJson = await again.json();
      expect(againJson).toEqual({ ...firstJson, created: false });
    }
    expect(table.rows).toHaveLength(1);
    expect(table.orderDocument.create).toHaveBeenCalledTimes(1);
  });

  it('regeneration: GET reuses the issuance across time — same number, same date, same bytes — with no further POST and no writes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T06:30:00.000Z'));
    const table = documentTable();
    const first = await setup({ sellerEnv: SELLER_ENV, table });
    const issued = await first.issue('order-doc-1', 'invoice');
    expect(issued.status).toBe(201);
    const firstBytes = Buffer.from(await (await first.call('order-doc-1', 'invoice')).arrayBuffer());
    const rowsAfterFirst = JSON.stringify(table.rows);

    // Months later, a different session opens it again — GET only, no issue.
    vi.setSystemTime(new Date('2026-12-31T12:00:00.000Z'));
    const later = await setup({ sellerEnv: SELLER_ENV, table });
    const second = Buffer.from(await (await later.call('order-doc-1', 'invoice')).arrayBuffer());
    const download = Buffer.from(await (await later.call('order-doc-1', 'invoice', '?download=1')).arrayBuffer());

    expect(second.equals(firstBytes)).toBe(true);
    expect(download.equals(firstBytes)).toBe(true);
    expect(table.orderDocument.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(table.rows)).toBe(rowsAfterFirst);
    for (const write of later.forbiddenWrites) expect(write).not.toHaveBeenCalled();
    const { flat } = await readPdfText(new Uint8Array(second));
    expect(flat).toContain('от 13 сентября 2026 г.');
    expect(flat).not.toContain('31 декабря 2026');
  });

  it('each kind is issued once, independently', async () => {
    const { issue, table } = await setup({ sellerEnv: SELLER_ENV });
    expect((await issue('order-doc-1', 'commercial-proposal')).status).toBe(201);
    expect((await issue('order-doc-1', 'invoice')).status).toBe(201);
    expect((await issue('order-doc-1', 'commercial-proposal')).status).toBe(200); // idempotent repeat
    expect(table.rows.map((r) => [r.kind, r.documentNumber])).toEqual([
      ['COMMERCIAL_PROPOSAL', 'KP-MS-20260830-4HB57'],
      ['INVOICE', 'INV-MS-20260830-4HB57'],
    ]);
  });

  it('concurrent first POST /issue calls settle on one logical issuance: one row, matching numbers, one 201 and the rest 200', async () => {
    const table = documentTable({ barrier: 3 });
    const { issue } = await setup({ sellerEnv: SELLER_ENV, table });

    const [a, b, c] = await Promise.all([
      issue('order-doc-1', 'invoice'),
      issue('order-doc-1', 'invoice'),
      issue('order-doc-1', 'invoice'),
    ]);
    const statuses = [a.status, b.status, c.status].sort();
    expect(statuses).toEqual([200, 200, 201]);

    // All three saw "not issued" (the barrier) and all three tried to
    // create; the unique constraint let exactly one in and the losers
    // re-read the winner's row instead of erroring.
    expect(table.orderDocument.create).toHaveBeenCalledTimes(3);
    let conflicts = 0;
    for (const result of table.orderDocument.create.mock.results) {
      try {
        await result.value;
      } catch (error) {
        conflicts += 1;
        expect(error).toMatchObject({ code: 'P2002' });
      }
    }
    expect(conflicts).toBe(2);
    expect(table.rows).toHaveLength(1);

    const [bodyA, bodyB, bodyC] = await Promise.all([a.json(), b.json(), c.json()]);
    const canonical = { ok: true, kind: 'invoice', number: table.rows[0].documentNumber, issuedAt: table.rows[0].issuedAt.toISOString(), issuedByName: table.rows[0].issuedByName };
    expect({ ...bodyA, created: undefined }).toEqual({ ...canonical, created: undefined });
    expect({ ...bodyB, created: undefined }).toEqual({ ...canonical, created: undefined });
    expect({ ...bodyC, created: undefined }).toEqual({ ...canonical, created: undefined });
  });

  it('a database failure other than the unique conflict is not swallowed', async () => {
    const table = documentTable();
    table.orderDocument.create.mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'P1017' }));
    const { issue } = await setup({ sellerEnv: SELLER_ENV, table });
    const response = await issue('order-doc-1', 'invoice');
    expect(response.status).toBe(500);
    expect(table.rows).toHaveLength(0);
  });

  it('an issued document with a corrupted seller snapshot is refused (409) by both GET and POST /issue, never re-issued from today\'s settings', async () => {
    const table = documentTable();
    const first = await setup({ sellerEnv: SELLER_ENV, table });
    expect((await first.issue('order-doc-1', 'invoice')).status).toBe(201);
    (table.rows[0].sellerSnapshot as { details: { iban: string } }).details.iban = 'not-an-iban';

    const again = await setup({ sellerEnv: SELLER_ENV, table });
    expect((await again.call('order-doc-1', 'invoice')).status).toBe(409);
    expect((await again.issue('order-doc-1', 'invoice')).status).toBe(409);
    expect(table.rows).toHaveLength(1);
  });
});

describe('Order.updatedAt', () => {
  it('POST /issue never writes Order (and so never bumps Order.updatedAt)', async () => {
    const { issue, order } = await setup({ sellerEnv: SELLER_ENV });
    expect((await issue('order-doc-1', 'invoice')).status).toBe(201);
    for (const write of [order.update, order.updateMany, order.upsert, order.create, order.delete]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('GET never writes Order either, before or after issuance', async () => {
    const { issue, call, order } = await setup({ sellerEnv: SELLER_ENV });
    await call('order-doc-1', 'invoice'); // 409, not yet issued
    await issue('order-doc-1', 'invoice');
    await call('order-doc-1', 'invoice'); // 200, now issued
    for (const write of [order.update, order.updateMany, order.upsert, order.create, order.delete]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe('an issued document never follows later changes', () => {
  it('SELLER_* changed (or removed) after issuance does not change the issued PDF', async () => {
    const table = documentTable();
    const before = await setup({ sellerEnv: SELLER_ENV, table });
    expect((await before.issue('order-doc-1', 'invoice')).status).toBe(201);
    const invoice = Buffer.from(await (await before.call('order-doc-1', 'invoice')).arrayBuffer());

    const changedEnv = {
      ...SELLER_ENV,
      SELLER_LEGAL_NAME: 'ТОО «Новое Название»',
      SELLER_BIN: '111111111111',
      SELLER_BANK_NAME: 'АО «Другой Банк»',
      SELLER_IBAN: 'KZ111111111111111111',
      SELLER_BIC: 'OTHRKZKA',
      SELLER_KBE: '19',
    };
    const changed = await setup({ sellerEnv: changedEnv, table });
    // Already issued: a GET alone (no new POST) reuses the frozen seller block.
    expect(Buffer.from(await (await changed.call('order-doc-1', 'invoice')).arrayBuffer()).equals(invoice)).toBe(true);

    const removed = await setup({ table });
    expect(Buffer.from(await (await removed.call('order-doc-1', 'invoice')).arrayBuffer()).equals(invoice)).toBe(true);

    const { flat } = await readPdfText(new Uint8Array(invoice));
    expect(flat).toContain('ТОО «Тестовый Продавец»');
    expect(flat).not.toContain('Новое Название');

    // A document issued only now captures the configuration of now.
    expect((await changed.issue('order-doc-1', 'commercial-proposal')).status).toBe(201);
    const proposal = await readPdfText(new Uint8Array(await (await changed.call('order-doc-1', 'commercial-proposal')).arrayBuffer()));
    expect(proposal.flat).toContain('ТОО «Новое Название»');
    expect(table.rows).toHaveLength(2);
  });

  it('the mutable Customer row is never read: the buyer comes from the order-time snapshot', async () => {
    // Even if a later order from the same phone renamed the Customer, the
    // document query does not select it; a stray customer object is ignored.
    const row = { ...prismaRow(), customer: { fullName: 'Изменённое Имя', companyName: 'ТОО «Позже»', email: 'later@example.com' } };
    const { call, issue, order, customer } = await setup({ row });
    expect((await issue('order-doc-1', 'commercial-proposal')).status).toBe(201);
    const response = await call('order-doc-1', 'commercial-proposal');
    const { flat } = await readPdfText(new Uint8Array(await response.arrayBuffer()));
    expect(flat).toContain('Айгуль Тестова');
    expect(flat).toContain('aigul@example.com');
    for (const later of ['Изменённое Имя', 'ТОО «Позже»', 'later@example.com']) expect(flat).not.toContain(later);

    const select = (order.findUnique.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(select).not.toHaveProperty('customer');
    expect(select).not.toHaveProperty('customerId');
    expect(customer.findUnique).not.toHaveBeenCalled();
    expect(customer.findFirst).not.toHaveBeenCalled();
  });
});

describe('legacy orders', () => {
  it('409 with a clear explanation for both documents from both routes, and nothing is issued', async () => {
    const legacySource = orderSource({ buyerSnapshot: null, items: [item({ documentSnapshot: null })] });
    const { call, issue, table } = await setup({ row: prismaRow(legacySource) });
    for (const kind of ['commercial-proposal', 'invoice']) {
      const getResponse = await call('order-doc-1', kind);
      expect(getResponse.status).toBe(409);
      const getJson = await getResponse.json();
      expect(getJson.code).toBe('CONFLICT');
      expect(getJson.message).toContain('исторические данные');
      expect((getJson.details as string[]).join(' ')).toContain('Не сохранены данные покупателя');

      // POST /issue refuses the same way, before any seller check.
      const issueResponse = await issue('order-doc-1', kind);
      expect(issueResponse.status).toBe(409);
      const issueJson = await issueResponse.json();
      expect(issueJson.code).toBe('CONFLICT');
      expect(issueJson.message).toContain('исторические данные');
    }
    expect(table.orderDocument.create).not.toHaveBeenCalled();
  });
});

describe('response', () => {
  it('is a private, uncached PDF with a safe file name from the persisted number, inline or as a download', async () => {
    const { issue, call } = await setup({ sellerEnv: SELLER_ENV });
    await issue('order-doc-1', 'invoice');
    await issue('order-doc-1', 'commercial-proposal');

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

  it('409 instead of a document when the stored totals contradict each other — and no number is issued', async () => {
    const broken = prismaRow({ ...orderSource(), grandTotal: decimal(1) });
    const { call, issue, table } = await setup({ row: broken, sellerEnv: SELLER_ENV });
    expect((await call('order-doc-1', 'commercial-proposal')).status).toBe(409);
    expect((await issue('order-doc-1', 'commercial-proposal')).status).toBe(409);
    expect(table.rows).toHaveLength(0);
  });
});

describe('privacy', () => {
  it('selects an explicit allow-list: no customer, internal BOM, internal notes, manager, history, audit or costs', async () => {
    const { call, order } = await setup();
    await call('order-doc-1', 'commercial-proposal'); // 409 (not issued), but still validates via the same query
    expect(order.findUnique).toHaveBeenCalledTimes(1);
    const args = order.findUnique.mock.calls[0] as unknown as [{ where: unknown; select: Record<string, unknown>; include?: unknown }];
    const query = args[0];
    expect(query.where).toEqual({ id: 'order-doc-1' });
    expect(query.include).toBeUndefined();
    const selected = JSON.stringify(query.select);
    for (const forbidden of ['customer', 'bomSnapshot', 'internalNotes', 'manager', 'managerId', 'statusHistory', 'payments', 'quotes', 'comment', 'whatsapp', 'purchasePrice', 'unitCost', 'supplierRef', 'markup']) {
      expect(selected, `document query selects "${forbidden}"`).not.toMatch(new RegExp(`"${forbidden}"`));
    }
  });

  it('a client cannot inject amounts: query parameters are ignored', async () => {
    const { bytes, call } = await setup({ sellerEnv: SELLER_ENV });
    await bytes('order-doc-1', 'invoice');
    const response = await call('order-doc-1', 'invoice', '?grandTotal=1&vatTotal=0&price=1&download=0');
    const { flat } = await readPdfText(new Uint8Array(await response.arrayBuffer()));
    expect(flat).toContain('Всего к оплате 222 696,00 ₸');
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
  });
});

describe('historical immutability — an order placed through the real pricing path', () => {
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

  it('repricing, VAT rules, renamed and removed catalog entries change neither issued document', async () => {
    const catalog = await memoryCatalog();
    const { calculatePrice } = await import('@/lib/pricing');
    const { createOrderBuyerSnapshot, createOrderItemDocumentSnapshot } = await import('@/lib/documents/snapshots');

    // 1. Place the order exactly the way POST /api/orders + saveOrderToDb do.
    const priced = calculatePrice(shelvingConfiguration(), catalog);
    if (!priced.ok) throw new Error(`fixture configuration must price: ${priced.message}`);
    const b = priced.breakdown;
    expect(b.discount).toBeGreaterThan(0);
    expect(b.assembly).toBeGreaterThan(0);

    const documentSnapshot = JSON.parse(
      JSON.stringify(
        createOrderItemDocumentSnapshot(
          { configuration: priced.configuration, bom: priced.bom, breakdown: b, pricesIncludeVat: catalog.pricingSettings.pricesIncludeVat },
          catalog,
        ),
      ),
    );
    const persisted = orderSource({
      buyerSnapshot: JSON.parse(JSON.stringify(createOrderBuyerSnapshot({ type: 'INDIVIDUAL', fullName: 'Айгуль Тестова', phone: '+77001234567', email: 'aigul@example.com', city: 'Алматы' }))),
      items: [
        {
          id: 'hist-item-1',
          configuration: priced.configuration,
          documentSnapshot,
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
    const serialise = () => JSON.stringify(row, (_k, v) => (v && typeof v === 'object' && typeof v.toFixed === 'function' ? v.toFixed(2) : v));
    const rowBefore = serialise();

    const table = documentTable();
    const before = await setup({ row, catalog, sellerEnv: SELLER_ENV, table });
    const kpBefore = await before.bytes('order-doc-1', 'commercial-proposal');
    const invBefore = await before.bytes('order-doc-1', 'invoice');

    // 2. Today's catalog moves on: prices, markup, VAT rules, names, removals.
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
      model.name.ru = `${model.name.ru} NEW`;
    }
    for (const color of catalog.colors) {
      color.pricePercent += 10;
      color.name.ru = 'Переименованный цвет';
    }
    for (const assembly of catalog.assemblyServices) {
      assembly.value *= 2;
      assembly.name.ru = 'Переименованная сборка';
    }
    catalog.pricingSettings.vatPercent = 20;
    catalog.pricingSettings.pricesIncludeVat = true;
    catalog.pricingSettings.quantityBreaks = [];

    // Sanity: repricing the same configuration today WOULD give other numbers.
    const repriced = calculatePrice(shelvingConfiguration(), catalog);
    if (!repriced.ok) throw new Error('repricing must succeed');
    expect(repriced.breakdown.unitNet).not.toBe(b.unitNet);
    expect(repriced.breakdown.net).not.toBe(b.net);
    expect(repriced.breakdown.total).not.toBe(b.total);
    catalog.deliveryMethods = catalog.deliveryMethods.filter((d) => d.id !== 'delivery-pickup');

    // 3. Documents rendered after the change — already issued, so a GET
    // alone (no new POST) is what reuses the frozen number/date/seller.
    const after = await setup({ row, catalog, sellerEnv: SELLER_ENV, table });
    const kpAfter = Buffer.from(await (await after.call('order-doc-1', 'commercial-proposal')).arrayBuffer());
    const invAfter = Buffer.from(await (await after.call('order-doc-1', 'invoice')).arrayBuffer());
    expect(kpAfter.equals(kpBefore)).toBe(true);
    expect(invAfter.equals(invBefore)).toBe(true);
    expect(before.getCatalog).not.toHaveBeenCalled();
    expect(after.getCatalog).not.toHaveBeenCalled();

    const fmt = (tenge: number) => `${tenge.toLocaleString('ru-RU').replace(/\s/g, ' ')},00`;
    for (const bytes of [kpAfter, invAfter]) {
      const { flat } = await readPdfText(new Uint8Array(bytes));
      expect(flat).toContain('Стеллаж MS Стандарт:');
      if (bytes === kpAfter) expect(flat).toContain('Доставка Самовывоз со склада');
      expect(flat).toContain('Услуга сборки: Профессиональная сборка (к поз. 1)');
      for (const renamed of ['NEW', 'Переименованный цвет', 'Переименованная сборка']) expect(flat).not.toContain(renamed);
      expect(flat).toContain(`${priced.configuration.quantity} компл.`);
      expect(flat).toContain(fmt(b.unitNet));
      expect(flat).toContain(fmt(b.itemsNet));
      expect(flat).toContain(`Скидка −${fmt(b.discount)} ₸`);
      expect(flat).toContain(`Итого без НДС ${fmt(b.net)} ₸`);
      expect(flat).toContain(`НДС 16% ${fmt(b.vat)} ₸`);
      expect(flat).toContain(`${fmt(b.total)} ₸`);
      for (const today of [repriced.breakdown.unitNet, repriced.breakdown.net, repriced.breakdown.total]) {
        expect(flat).not.toContain(fmt(today));
      }
    }

    // The persisted order itself was not touched either.
    expect(serialise()).toBe(rowBefore);
  });
});
