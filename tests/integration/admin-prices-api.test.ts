import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

/**
 * /api/admin/prices — authorization matrix, money validation, transactional
 * write (entity + PriceHistory + AuditLog), optimistic concurrency and cache
 * invalidation.
 *
 * Prisma is replaced with a small in-memory fake rather than a stub that
 * always succeeds: `updateMany` implements the real compare-and-swap on
 * `updatedAt`, so the lost-update tests exercise the actual guard instead of
 * a mock that agrees with whatever the code does.
 */

const AUTH_SECRET = 'test-secret-do-not-use-in-production-please';

function fakeCookieStore(token?: string) {
  return {
    get: vi.fn(() => (token ? { value: token } : undefined)),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

interface EntityState {
  id: string;
  sku: string;
  nameRu: string;
  selling: Prisma.Decimal;
  purchase: Prisma.Decimal;
  updatedAt: Date;
}

const COMPONENT_UPDATED_AT = new Date('2026-09-01T10:00:00.000Z');
const ACCESSORY_UPDATED_AT = new Date('2026-09-02T11:30:00.000Z');

function componentState(): EntityState {
  return {
    id: 'component-1',
    sku: 'SHELF-1000-400',
    nameRu: 'Полка Стандартная 1000×400',
    selling: new Prisma.Decimal('12000.00'),
    purchase: new Prisma.Decimal('7500.00'),
    updatedAt: COMPONENT_UPDATED_AT,
  };
}

function accessoryState(): EntityState {
  return {
    id: 'acc-cross-brace',
    sku: 'ACC-CROSS-BRACE',
    nameRu: 'Раскос',
    selling: new Prisma.Decimal('3400.00'),
    purchase: new Prisma.Decimal('1900.00'),
    updatedAt: ACCESSORY_UPDATED_AT,
  };
}

interface FakeOptions {
  component?: EntityState | null;
  accessory?: EntityState | null;
  /** Simulates another admin committing between our read and our write. */
  concurrentWrite?: boolean;
  listRows?: unknown[];
  listCount?: number;
  historyRows?: unknown[];
}

function buildPrismaFake(options: FakeOptions) {
  const component = options.component === undefined ? componentState() : options.component;
  const accessory = options.accessory === undefined ? accessoryState() : options.accessory;

  function table(state: EntityState | null, sellingColumn: 'sellingPrice' | 'unitPrice') {
    return {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!state || state.id !== where.id) return null;
        return {
          id: state.id,
          sku: state.sku,
          nameRu: state.nameRu,
          [sellingColumn]: state.selling,
          purchasePrice: state.purchase,
          updatedAt: state.updatedAt,
        };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; updatedAt?: Date };
          data: Record<string, Prisma.Decimal>;
        }) => {
          if (!state || state.id !== where.id) return { count: 0 };
          // The real lost-update guard: the row must still carry the exact
          // timestamp that was read a moment ago.
          if (where.updatedAt && where.updatedAt.getTime() !== state.updatedAt.getTime()) {
            return { count: 0 };
          }
          if (options.concurrentWrite) {
            state.updatedAt = new Date(state.updatedAt.getTime() + 5_000);
            return { count: 0 };
          }
          if (data[sellingColumn]) state.selling = data[sellingColumn];
          if (data.purchasePrice) state.purchase = data.purchasePrice;
          state.updatedAt = new Date(state.updatedAt.getTime() + 1_000);
          return { count: 1 };
        },
      ),
    };
  }

  const componentTable = table(component, 'sellingPrice');
  const accessoryTable = table(accessory, 'unitPrice');
  const priceHistory = {
    createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    findMany: vi.fn(async () => options.historyRows ?? []),
  };
  const auditLog = {
    create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
  };

  const tx = { component: componentTable, accessory: accessoryTable, priceHistory, auditLog };

  const $transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
  const $queryRaw = vi.fn(async (sql: Prisma.Sql) => {
    const text = sql.strings.join(' ');
    if (text.includes('count(')) return [{ count: BigInt(options.listCount ?? 0) }];
    return options.listRows ?? [];
  });

  return {
    prisma: { $transaction, $queryRaw, priceHistory, component: componentTable, accessory: accessoryTable },
    tx,
    state: { component, accessory },
    $transaction,
    $queryRaw,
  };
}

const invalidateCatalogCache = vi.fn();

async function setup(options: FakeOptions & { token?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', AUTH_SECRET);
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');

  invalidateCatalogCache.mockClear();
  const cookieStore = fakeCookieStore(options.token);
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

  const fake = buildPrismaFake(options);
  vi.doMock('@/lib/db/client', () => ({ prisma: fake.prisma }));
  vi.doMock('@/lib/data/repository', () => ({ invalidateCatalogCache }));

  const listRoute = await import('@/app/api/admin/prices/route');
  const patchRoute = await import('@/app/api/admin/prices/[entityType]/[id]/route');
  const historyRoute = await import('@/app/api/admin/prices/[entityType]/[id]/history/route');

  return { ...fake, listRoute, patchRoute, historyRoute };
}

async function sessionTokenFor(role: string) {
  vi.stubEnv('AUTH_SECRET', AUTH_SECRET);
  const { createSessionToken } = await import('@/lib/auth/session');
  return createSessionToken({ id: 'admin-1', email: 'a@b.com', name: 'Иван Админов', role: role as never });
}

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/prices${query}`, { method: 'GET' });
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/prices/COMPONENT/component-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Vitest' },
    body: JSON.stringify(body),
  });
}

const componentParams = (id = 'component-1') =>
  ({ params: Promise.resolve({ entityType: 'COMPONENT', id }) });
const accessoryParams = (id = 'acc-cross-brace') =>
  ({ params: Promise.resolve({ entityType: 'ACCESSORY', id }) });

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', AUTH_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
  vi.doUnmock('@/lib/data/repository');
});

/* -------------------------------------------------------------------------- */

describe('authorization matrix', () => {
  it('GET /api/admin/prices rejects an unauthenticated request with 401', async () => {
    const { listRoute, $queryRaw } = await setup();
    const response = await listRoute.GET(listRequest());
    expect(response.status).toBe(401);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller receives no purchase prices at all', async () => {
    const { listRoute } = await setup();
    const response = await listRoute.GET(listRequest());
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('purchasePrice');
    expect(body).not.toContain('7500');
  });

  it.each(['MANAGER', 'CONTENT_MANAGER'])('GET rejects %s with 403 and runs no query', async (role) => {
    const token = await sessionTokenFor(role);
    const { listRoute, $queryRaw } = await setup({ token });
    const response = await listRoute.GET(listRequest());
    expect(response.status).toBe(403);
    expect($queryRaw).not.toHaveBeenCalled();
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('purchasePrice');
  });

  it.each(['SUPER_ADMIN', 'ADMIN'])('GET allows %s', async (role) => {
    const token = await sessionTokenFor(role);
    const { listRoute } = await setup({ token, listRows: [], listCount: 0 });
    const response = await listRoute.GET(listRequest());
    expect(response.status).toBe(200);
  });

  it('PATCH rejects an unauthenticated request with 401 and writes nothing', async () => {
    const { patchRoute, $transaction } = await setup();
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '1.00' }), componentParams());
    expect(response.status).toBe(401);
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each(['MANAGER', 'CONTENT_MANAGER'])('PATCH rejects %s with 403 and writes nothing', async (role) => {
    const token = await sessionTokenFor(role);
    const { patchRoute, $transaction } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '1.00' }), componentParams());
    expect(response.status).toBe(403);
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN'])('PATCH allows %s', async (role) => {
    const token = await sessionTokenFor(role);
    const { patchRoute } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '13000.00' }), componentParams());
    expect(response.status).toBe(200);
  });

  it('history rejects an unauthenticated request with 401', async () => {
    const { historyRoute, prisma } = await setup();
    const response = await historyRoute.GET(new Request('http://localhost'), componentParams());
    expect(response.status).toBe(401);
    expect(prisma.priceHistory.findMany).not.toHaveBeenCalled();
  });

  it.each(['MANAGER', 'CONTENT_MANAGER'])('history rejects %s with 403', async (role) => {
    const token = await sessionTokenFor(role);
    const { historyRoute, prisma } = await setup({ token });
    const response = await historyRoute.GET(new Request('http://localhost'), componentParams());
    expect(response.status).toBe(403);
    expect(prisma.priceHistory.findMany).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe('GET /api/admin/prices — admin list', () => {
  const rawRow = {
    entityType: 'COMPONENT',
    id: 'component-1',
    sku: 'SHELF-1000-400',
    name: 'Полка Стандартная 1000×400',
    componentType: 'SHELF',
    height: null,
    width: 1000,
    depth: 400,
    loadCapacity: 150,
    shelfType: 'STANDARD',
    variant: null,
    models: ['ms-standard'],
    active: true,
    inStock: true,
    sellingPrice: new Prisma.Decimal('12000.00'),
    purchasePrice: new Prisma.Decimal('7500.00'),
    updatedAt: COMPONENT_UPDATED_AT,
  };

  it('returns admin fields including the purchase price, as decimal strings', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute } = await setup({ token, listRows: [rawRow], listCount: 1 });
    const response = await listRoute.GET(listRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]).toMatchObject({
      entityType: 'COMPONENT',
      id: 'component-1',
      sku: 'SHELF-1000-400',
      name: 'Полка Стандартная 1000×400',
      componentType: 'SHELF',
      width: 1000,
      depth: 400,
      models: ['ms-standard'],
      active: true,
      inStock: true,
      sellingPrice: '12000.00',
      purchasePrice: '7500.00',
      updatedAt: COMPONENT_UPDATED_AT.toISOString(),
    });
  });

  it('paginates in the database, not in the browser', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute, $queryRaw } = await setup({ token, listRows: [rawRow], listCount: 137 });
    const response = await listRoute.GET(listRequest('?page=3'));
    const json = await response.json();

    expect(json.page).toBe(3);
    expect(json.pageSize).toBe(40);
    expect(json.total).toBe(137);
    expect(json.totalPages).toBe(4);

    const pageQuery = $queryRaw.mock.calls
      .map(([sql]) => sql as Prisma.Sql)
      .find((sql) => sql.strings.join(' ').includes('LIMIT'));
    expect(pageQuery).toBeDefined();
    expect(pageQuery!.values).toContain(40);
    expect(pageQuery!.values).toContain(80);
  });

  it('pushes the search term into SQL as a bound parameter', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute, $queryRaw } = await setup({ token, listRows: [], listCount: 0 });
    await listRoute.GET(listRequest('?q=SHELF'));

    const sql = $queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.strings.join(' ')).toContain('ILIKE');
    expect(sql.values).toContain('%SHELF%');
  });

  it('escapes ILIKE wildcards so "%" is searched literally', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute, $queryRaw } = await setup({ token, listRows: [], listCount: 0 });
    await listRoute.GET(listRequest('?q=%25'));

    const sql = $queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toContain('%\\%%');
  });

  it('filters by entity type, component type and model in SQL', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute, $queryRaw } = await setup({ token, listRows: [], listCount: 0 });
    await listRoute.GET(listRequest('?entityType=COMPONENT&componentType=SHELF&model=ms-standard'));

    const sql = $queryRaw.mock.calls[0][0] as Prisma.Sql;
    const text = sql.strings.join(' ');
    expect(text).toContain('"Component"');
    expect(text).not.toContain('"Accessory"');
    expect(sql.values).toContain('SHELF');
    expect(sql.values).toContain('ms-standard');
  });

  it('queries both tables as one paginated UNION when entityType is ALL', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute, $queryRaw } = await setup({ token, listRows: [], listCount: 0 });
    await listRoute.GET(listRequest('?entityType=ALL'));

    const text = ($queryRaw.mock.calls[0][0] as Prisma.Sql).strings.join(' ');
    expect(text).toContain('UNION ALL');
    expect(text).toContain('"Component"');
    expect(text).toContain('"Accessory"');
  });

  it('rejects a malformed query parameter with 400', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { listRoute } = await setup({ token });
    const response = await listRoute.GET(listRequest('?entityType=EVERYTHING'));
    expect(response.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */

describe('PATCH — component price changes', () => {
  it('changes the selling price only, and records exactly one history row', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx, state, $transaction } = await setup({ token });

    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '13500.50' }), componentParams());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(true);
    expect(json.changes).toEqual([
      { field: 'SELLING_PRICE', oldValue: '12000.00', newValue: '13500.50' },
    ]);
    expect(json.sellingPrice).toBe('13500.50');
    expect(json.purchasePrice).toBe('7500.00');
    expect(state.component!.selling.toFixed(2)).toBe('13500.50');
    expect(state.component!.purchase.toFixed(2)).toBe('7500.00');

    expect($transaction).toHaveBeenCalledTimes(1);
    const historyRows = tx.priceHistory.createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0]).toMatchObject({
      entityType: 'COMPONENT',
      entityId: 'component-1',
      entitySku: 'SHELF-1000-400',
      field: 'SELLING_PRICE',
      adminId: 'admin-1',
      adminName: 'Иван Админов',
    });
    expect((historyRows[0].oldValue as Prisma.Decimal).toFixed(2)).toBe('12000.00');
    expect((historyRows[0].newValue as Prisma.Decimal).toFixed(2)).toBe('13500.50');
  });

  it('changes the purchase price only', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx, state } = await setup({ token });

    const response = await patchRoute.PATCH(patchRequest({ purchasePrice: '8000.00' }), componentParams());
    const json = await response.json();

    expect(json.changes).toEqual([
      { field: 'PURCHASE_PRICE', oldValue: '7500.00', newValue: '8000.00' },
    ]);
    expect(state.component!.selling.toFixed(2)).toBe('12000.00');
    expect(state.component!.purchase.toFixed(2)).toBe('8000.00');
    const rows = tx.priceHistory.createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('PURCHASE_PRICE');
  });

  it('changes both prices and writes a distinct history row per field', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token });

    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '13000.00', purchasePrice: '8100.25', reason: 'Новый прайс поставщика' }),
      componentParams(),
    );
    const json = await response.json();

    expect(json.changes).toEqual([
      { field: 'SELLING_PRICE', oldValue: '12000.00', newValue: '13000.00' },
      { field: 'PURCHASE_PRICE', oldValue: '7500.00', newValue: '8100.25' },
    ]);

    const rows = tx.priceHistory.createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.field)).toEqual(['SELLING_PRICE', 'PURCHASE_PRICE']);
    expect(rows.every((row) => row.reason === 'Новый прайс поставщика')).toBe(true);
  });

  it('writes the audit row inside the same transaction, with actor and request metadata', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token });

    await patchRoute.PATCH(patchRequest({ sellingPrice: '13000.00' }), componentParams());

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = tx.auditLog.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(audit).toMatchObject({
      userId: 'admin-1',
      action: 'CATALOG_PRICE_CHANGED',
      entityType: 'COMPONENT',
      entityId: 'component-1',
      ipAddress: '203.0.113.7',
      userAgent: 'Vitest',
    });
    expect(audit.previousData).toMatchObject({ sellingPrice: '12000.00', purchasePrice: '7500.00' });
    expect(audit.newData).toMatchObject({
      sku: 'SHELF-1000-400',
      sellingPrice: '13000.00',
      purchasePrice: '7500.00',
      changedFields: ['SELLING_PRICE'],
    });
    // No session/cookie material may ever reach the audit trail.
    expect(JSON.stringify(audit)).not.toContain(AUTH_SECRET);
    expect(JSON.stringify(audit)).not.toContain('admin_session');
  });

  it('is a complete no-op when the submitted prices equal the stored ones', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token });

    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '12000.00', purchasePrice: '7500.00' }),
      componentParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(false);
    expect(json.changes).toEqual([]);
    expect(tx.component.updateMany).not.toHaveBeenCalled();
    expect(tx.priceHistory.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(invalidateCatalogCache).not.toHaveBeenCalled();
  });

  it('treats a differently-spelled but equal decimal as unchanged', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token });

    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '12000' }), componentParams());
    const json = await response.json();

    expect(json.changed).toBe(false);
    expect(tx.priceHistory.createMany).not.toHaveBeenCalled();
  });

  it('invalidates the catalog cache once, only after a real change', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute } = await setup({ token });

    await patchRoute.PATCH(patchRequest({ sellingPrice: '13000.00' }), componentParams());
    expect(invalidateCatalogCache).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('PATCH — accessory price changes', () => {
  const accessoryRequest = (body: unknown) =>
    new NextRequest('http://localhost/api/admin/prices/ACCESSORY/acc-cross-brace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('maps sellingPrice onto Accessory.unitPrice without exposing the column name', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx, state } = await setup({ token });

    const response = await patchRoute.PATCH(accessoryRequest({ sellingPrice: '3900.00' }), accessoryParams());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changes).toEqual([
      { field: 'SELLING_PRICE', oldValue: '3400.00', newValue: '3900.00' },
    ]);
    expect(JSON.stringify(json)).not.toContain('unitPrice');
    expect(state.accessory!.selling.toFixed(2)).toBe('3900.00');
    expect(tx.accessory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unitPrice: expect.anything() }) }),
    );
  });

  it('changes the accessory purchase price only', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, state } = await setup({ token });

    const response = await patchRoute.PATCH(accessoryRequest({ purchasePrice: '2100.00' }), accessoryParams());
    const json = await response.json();

    expect(json.changes).toEqual([
      { field: 'PURCHASE_PRICE', oldValue: '1900.00', newValue: '2100.00' },
    ]);
    expect(state.accessory!.selling.toFixed(2)).toBe('3400.00');
    expect(state.accessory!.purchase.toFixed(2)).toBe('2100.00');
  });

  it('changes both accessory prices with two history rows', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token });

    await patchRoute.PATCH(
      accessoryRequest({ sellingPrice: '3900.00', purchasePrice: '2100.00' }),
      accessoryParams(),
    );

    const rows = tx.priceHistory.createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.entityType === 'ACCESSORY')).toBe(true);
  });

  it('is a no-op for an unchanged accessory', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token });

    const response = await patchRoute.PATCH(
      accessoryRequest({ sellingPrice: '3400.00', purchasePrice: '1900.00' }),
      accessoryParams(),
    );
    const json = await response.json();

    expect(json.changed).toBe(false);
    expect(tx.accessory.updateMany).not.toHaveBeenCalled();
    expect(tx.priceHistory.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe('PATCH — validation', () => {
  it.each([
    ['-1.00', 'negative'],
    ['12000.123', 'more than two decimals'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['abc', 'malformed'],
    ['12 000', 'thousands separator'],
    ['99999999999.99', 'out of Decimal(12,2) range'],
  ])('rejects %j (%s) with 400 and writes nothing', async (value) => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, $transaction } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: value }), componentParams());
    expect(response.status).toBe(400);
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([[12000], [null], [true]])('rejects the non-string price %j with 400', async (value) => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, $transaction } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: value }), componentParams());
    expect(response.status).toBe(400);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('rejects a body that changes no price at all', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, $transaction } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ reason: 'просто так' }), componentParams());
    expect(response.status).toBe(400);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('rejects a reason longer than 500 characters', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute } = await setup({ token });
    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '13000.00', reason: 'я'.repeat(501) }),
      componentParams(),
    );
    expect(response.status).toBe(400);
  });

  it('rejects an unknown entity type with 400', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '1.00' }), {
      params: Promise.resolve({ entityType: 'ORDER', id: 'component-1' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing entity, without writing history or audit rows', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token, component: null });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '13000.00' }), componentParams('nope'));
    expect(response.status).toBe(404);
    expect(tx.priceHistory.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(invalidateCatalogCache).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe('PATCH — optimistic concurrency', () => {
  it('applies the change when the expected updatedAt matches', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, state } = await setup({ token });

    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '13000.00', expectedUpdatedAt: COMPONENT_UPDATED_AT.toISOString() }),
      componentParams(),
    );

    expect(response.status).toBe(200);
    expect(state.component!.selling.toFixed(2)).toBe('13000.00');
  });

  it('returns 409 for a stale updatedAt and leaves the newer price untouched', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx, state } = await setup({ token });

    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '999.00', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' }),
      componentParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe('CONFLICT');
    expect(json.message).toBe('Цена уже была изменена другим пользователем. Обновите данные.');
    expect(json.details).toEqual([COMPONENT_UPDATED_AT.toISOString()]);
    // The newer value survives — nothing was overwritten.
    expect(state.component!.selling.toFixed(2)).toBe('12000.00');
    expect(tx.component.updateMany).not.toHaveBeenCalled();
    expect(tx.priceHistory.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(invalidateCatalogCache).not.toHaveBeenCalled();
  });

  it('returns 409 when another admin commits between the read and the write', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, tx } = await setup({ token, concurrentWrite: true });

    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '13000.00', expectedUpdatedAt: COMPONENT_UPDATED_AT.toISOString() }),
      componentParams(),
    );

    expect(response.status).toBe(409);
    expect(tx.priceHistory.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(invalidateCatalogCache).not.toHaveBeenCalled();
  });

  it('rejects a malformed expectedUpdatedAt rather than ignoring it', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute, $transaction } = await setup({ token });
    const response = await patchRoute.PATCH(
      patchRequest({ sellingPrice: '13000.00', expectedUpdatedAt: 'yesterday' }),
      componentParams(),
    );
    expect(response.status).toBe(400);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('returns the new updatedAt so the next edit can send a fresh token', async () => {
    const token = await sessionTokenFor('ADMIN');
    const { patchRoute } = await setup({ token });
    const response = await patchRoute.PATCH(patchRequest({ sellingPrice: '13000.00' }), componentParams());
    const json = await response.json();
    expect(new Date(json.updatedAt).getTime()).toBeGreaterThan(COMPONENT_UPDATED_AT.getTime());
  });
});

/* -------------------------------------------------------------------------- */

describe('GET history', () => {
  it('returns entries newest first with field, old/new value, actor and reason', async () => {
    const token = await sessionTokenFor('ADMIN');
    const rows = [
      {
        id: 'ph-2',
        entityType: 'COMPONENT',
        entityId: 'component-1',
        entitySku: 'SHELF-1000-400',
        entityName: 'Полка Стандартная 1000×400',
        field: 'PURCHASE_PRICE',
        oldValue: new Prisma.Decimal('7500.00'),
        newValue: new Prisma.Decimal('8100.25'),
        adminId: 'admin-1',
        adminName: 'Иван Админов',
        reason: 'Новый прайс поставщика',
        createdAt: new Date('2026-09-10T09:00:00.000Z'),
        admin: { id: 'admin-1', name: 'Иван Админов' },
      },
      {
        id: 'ph-1',
        entityType: 'COMPONENT',
        entityId: 'component-1',
        entitySku: 'SHELF-1000-400',
        entityName: 'Полка Стандартная 1000×400',
        field: 'SELLING_PRICE',
        oldValue: null,
        newValue: new Prisma.Decimal('12000.00'),
        adminId: null,
        adminName: null,
        reason: null,
        createdAt: new Date('2026-09-09T09:00:00.000Z'),
        admin: null,
      },
    ];
    const { historyRoute, prisma } = await setup({ token, historyRows: rows });

    const response = await historyRoute.GET(new Request('http://localhost'), componentParams());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.priceHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: 'COMPONENT', entityId: 'component-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(json.entries[0]).toMatchObject({
      field: 'PURCHASE_PRICE',
      oldValue: '7500.00',
      newValue: '8100.25',
      adminName: 'Иван Админов',
      reason: 'Новый прайс поставщика',
      sku: 'SHELF-1000-400',
    });
    expect(json.entries[1]).toMatchObject({ field: 'SELLING_PRICE', oldValue: null, newValue: '12000.00' });
  });
});
