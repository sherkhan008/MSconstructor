import { afterEach, describe, expect, it, vi } from 'vitest';
/** vi.fn() mocks declared without argument types give `.mock.calls` an empty
 * tuple type; this reads the first argument of the first call with the shape
 * the assertion actually needs. */
function firstArg<T>(fn: { mock: { calls: unknown[][] } }): T {
  return fn.mock.calls[0][0] as T;
}


function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'MS-20260827-00001',
    status: 'NEW',
    customerId: 'cust-1',
    customer: {
      fullName: 'Тест Тестов',
      phone: '+77001234567',
      whatsapp: null,
      email: null,
      city: 'Алматы',
      companyName: null,
      binIin: null,
      type: 'INDIVIDUAL',
    },
    managerId: null,
    deliveryMethodId: null,
    deliveryAddress: null,
    deliveryCity: null,
    deliveryFloor: null,
    deliveryHasLift: null,
    deliveryDate: null,
    deliveryComment: null,
    paymentPreference: 'BANK_TRANSFER',
    netTotal: 100_000,
    vatTotal: 12_000,
    discountTotal: 0,
    grandTotal: 112_000,
    comment: null,
    internalNotes: null,
    createdAt: new Date('2026-08-27T10:00:00.000Z'),
    updatedAt: new Date('2026-08-27T10:00:00.000Z'),
    items: [
      {
        id: 'item-1',
        orderId: 'order-1',
        configuration: { modelSlug: 'ms-standard', height: 2000, depth: 400, sections: [{ id: 's1', width: 1000, rearWall: false, leftWall: false, rightWall: false }] },
        bomSnapshot: [{ componentId: 'c1', sku: 'MS-SHELF-1000-400', type: 'SHELF', name: 'Полка 1000×400', quantity: 5, unitPrice: 8500, totalPrice: 42500, weightKg: 4 }],
        quantity: 1,
        unitNetPrice: 100_000,
        totalNetPrice: 100_000,
        createdAt: new Date('2026-08-27T10:00:00.000Z'),
      },
    ],
    statusHistory: [{ id: 'h1', orderId: 'order-1', status: 'NEW', note: null, changedBy: null, createdAt: new Date('2026-08-27T10:00:00.000Z') }],
    ...overrides,
  };
}

async function setupAdminOrders(opts: { databaseUrl?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', opts.databaseUrl ?? 'postgresql://user:pass@localhost:5432/db');

  const findMany = vi.fn(async () => [orderRow()]);
  const count = vi.fn(async () => 1);
  const findUnique = vi.fn(async (): Promise<ReturnType<typeof orderRow> | null> => orderRow());
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb({}));
  const auditFindMany = vi.fn(async () => [] as unknown[]);
  const userFindMany = vi.fn(async () => [] as unknown[]);

  vi.doMock('@/lib/db/client', () => ({
    prisma: {
      order: { findMany, count, findUnique },
      auditLog: { findMany: auditFindMany },
      user: { findMany: userFindMany },
      $transaction: transaction,
    },
  }));

  const mod = await import('@/lib/admin/orders');
  return { ...mod, findMany, count, findUnique, auditFindMany, userFindMany };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('@/lib/db/client');
});

describe('listOrders', () => {
  it('sorts newest first', async () => {
    const { listOrders, findMany } = await setupAdminOrders();
    await listOrders({});
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });

  it('filters by status when provided', async () => {
    const { listOrders, findMany } = await setupAdminOrders();
    await listOrders({ status: 'PAID' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ status: 'PAID' }] } }),
    );
  });

  it('paginates with a fixed page size', async () => {
    const { listOrders, findMany } = await setupAdminOrders();
    await listOrders({ page: 3 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it('maps rows to the admin summary shape', async () => {
    const { listOrders } = await setupAdminOrders();
    const result = await listOrders({});
    expect(result.orders[0]).toMatchObject({
      id: 'order-1',
      orderNumber: 'MS-20260827-00001',
      customerName: 'Тест Тестов',
      customerPhone: '+77001234567',
      grandTotal: 112_000,
    });
  });

  it('throws a clear error when no database is configured, in any environment', async () => {
    const { listOrders } = await setupAdminOrders({ databaseUrl: '' });
    await expect(listOrders({})).rejects.toThrow(/PostgreSQL/);
  });
});

describe('getOrderById', () => {
  it('returns configuration/BOM/prices exactly as persisted — never recalculated', async () => {
    const { getOrderById } = await setupAdminOrders();
    const detail = await getOrderById('order-1');
    expect(detail).not.toBeNull();
    expect(detail?.grandTotal).toBe(112_000);
    expect(detail?.netTotal).toBe(100_000);
    expect(detail?.items[0].unitNetPrice).toBe(100_000);
    expect(detail?.items[0].totalNetPrice).toBe(100_000);
    expect(detail?.items[0].configuration).toEqual(orderRow().items[0].configuration);
    expect(detail?.items[0].bom).toEqual(orderRow().items[0].bomSnapshot);
  });

  it('returns null for a non-existent order rather than throwing', async () => {
    const { getOrderById, findUnique } = await setupAdminOrders();
    findUnique.mockResolvedValueOnce(null);
    expect(await getOrderById('missing')).toBeNull();
  });

  it('never queries the catalog/pricing engine', async () => {
    const calculatePriceSpy = vi.fn();
    vi.doMock('@/lib/pricing', () => ({ calculatePrice: calculatePriceSpy }));
    const { getOrderById } = await setupAdminOrders();
    await getOrderById('order-1');
    expect(calculatePriceSpy).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/pricing');
  });
});

describe('updateOrderStatus — DB requirement', () => {
  it('refuses to run when no database is configured', async () => {
    const { updateOrderStatus } = await setupAdminOrders({ databaseUrl: '' });
    await expect(
      updateOrderStatus({
        orderId: 'order-1',
        newStatus: 'CONFIRMED',
        channel: 'ADMIN',
        actor: { id: 'a1', name: 'A' },
      }),
    ).rejects.toThrow(/PostgreSQL/);
  });
});

/**
 * The list screen's filters must be SQL, not post-processing: what these
 * assert is that every filter reaches Prisma's `where`, because that is what
 * makes `total`, the paging and the counters correct for a filtered view.
 */
describe('listOrders — server-side filtering', () => {
  const NOW = new Date('2026-09-12T15:00:00.000Z');

  async function whereFor(params: Record<string, unknown>) {
    const { listOrders, findMany } = await setupAdminOrders();
    await listOrders({ now: NOW, ...params });
    return firstArg<{ where: { AND?: unknown[] } }>(findMany).where;
  }

  it('searches order number, name, email, company and BIN/IIN in one OR', async () => {
    const where = await whereFor({ search: 'Айгуль' });
    const or = (where.AND?.[0] as { OR: Record<string, unknown>[] }).OR;
    expect(or).toEqual(
      expect.arrayContaining([
        { orderNumber: { contains: 'Айгуль', mode: 'insensitive' } },
        { customer: { fullName: { contains: 'Айгуль', mode: 'insensitive' } } },
        { customer: { email: { contains: 'Айгуль', mode: 'insensitive' } } },
        { customer: { companyName: { contains: 'Айгуль', mode: 'insensitive' } } },
        { customer: { binIin: { contains: 'Айгуль', mode: 'insensitive' } } },
      ]),
    );
  });

  it('adds a phone probe on the subscriber digits for a phone-shaped term', async () => {
    const where = await whereFor({ search: '8 707 123 45 67' });
    const or = (where.AND?.[0] as { OR: Record<string, unknown>[] }).OR;
    expect(or).toContainEqual({ customer: { phone: { contains: '7071234567' } } });
  });

  it('does not add a phone probe for a short numeric term', async () => {
    const where = await whereFor({ search: '12' });
    const or = (where.AND?.[0] as { OR: Record<string, unknown>[] }).OR;
    expect(or.some((clause) => 'customer' in clause && JSON.stringify(clause).includes('phone'))).toBe(false);
  });

  it('escapes LIKE wildcards so "%" matches literally', async () => {
    const where = await whereFor({ search: '50%' });
    const or = (where.AND?.[0] as { OR: Record<string, unknown>[] }).OR;
    expect(or[0]).toEqual({ orderNumber: { contains: String.raw`50\%`, mode: 'insensitive' } });
  });

  it('turns a date range into a createdAt window', async () => {
    const where = await whereFor({ dateRange: 'LAST_7_DAYS' });
    const clause = where.AND?.[0] as { createdAt: { gte: Date } };
    expect(clause.createdAt.gte.getTime()).toBe(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
  });

  it('filters unassigned orders with managerId: null, not with a magic string', async () => {
    const where = await whereFor({ managerId: 'UNASSIGNED' });
    expect(where.AND).toContainEqual({ managerId: null });
  });

  it('filters by a specific manager', async () => {
    const where = await whereFor({ managerId: 'user-7' });
    expect(where.AND).toContainEqual({ managerId: 'user-7' });
  });

  it('filters by customer type, and ignores the ALL sentinel', async () => {
    expect(await whereFor({ customerType: 'LEGAL_ENTITY' })).toEqual({
      AND: [{ customer: { type: 'LEGAL_ENTITY' } }],
    });
    expect(await whereFor({ customerType: 'ALL' })).toEqual({});
  });

  it('combines every filter with AND', async () => {
    const where = await whereFor({
      status: 'NEW',
      managerId: 'UNASSIGNED',
      customerType: 'INDIVIDUAL',
      search: 'MS-2026',
    });
    expect(where.AND).toHaveLength(4);
  });

  it('returns counters that ignore the current filter', async () => {
    const { listOrders, count } = await setupAdminOrders();
    count.mockResolvedValueOnce(3).mockResolvedValueOnce(11).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    const result = await listOrders({ status: 'PAID', now: NOW });
    expect(result.counters).toEqual({ newOrders: 11, unassigned: 4, today: 2 });
    expect(count).toHaveBeenCalledWith({ where: { status: 'NEW' } });
    expect(count).toHaveBeenCalledWith({ where: { managerId: null } });
  });

  it('reads customer columns through one join — no per-row follow-up query', async () => {
    const { listOrders, findMany, findUnique } = await setupAdminOrders();
    await listOrders({});
    const call = firstArg<{ select: { customer: unknown; manager: unknown } }>(findMany);
    expect(call.select.customer).toBeDefined();
    expect(call.select.manager).toBeDefined();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('getOrderById — internal fields', () => {
  it('exposes the responsible manager, internal notes and the CAS token', async () => {
    const { getOrderById, findUnique } = await setupAdminOrders();
    findUnique.mockResolvedValueOnce(
      orderRow({
        managerId: 'user-7',
        manager: { id: 'user-7', name: 'Пётр Менеджеров' },
        internalNotes: 'Перезвонить после 18:00',
        updatedAt: new Date('2026-09-01T08:00:00.000Z'),
      }) as ReturnType<typeof orderRow>,
    );
    const detail = await getOrderById('order-1');
    expect(detail?.manager).toEqual({ id: 'user-7', name: 'Пётр Менеджеров' });
    expect(detail?.internalNotes).toBe('Перезвонить после 18:00');
    expect(detail?.updatedAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('reports an unassigned order as manager: null and empty notes', async () => {
    const { getOrderById } = await setupAdminOrders();
    const detail = await getOrderById('order-1');
    expect(detail?.manager).toBeNull();
    expect(detail?.internalNotes).toBe('');
  });

  it('reads only assignment/notes events for the activity timeline', async () => {
    const { getOrderById, auditFindMany } = await setupAdminOrders();
    await getOrderById('order-1');
    const call = firstArg<{
      where: { entityType: string; entityId: string; action: { in: string[] } };
    }>(auditFindMany);
    expect(call.where.entityType).toBe('ORDER');
    expect(call.where.entityId).toBe('order-1');
    expect(call.where.action.in).toEqual(['ORDER_MANAGER_ASSIGNED', 'ORDER_INTERNAL_NOTES_UPDATED']);
  });
});

describe('listAssignableManagers', () => {
  it('asks only for active users in an operational role, and never for credentials', async () => {
    const { listAssignableManagers, userFindMany } = await setupAdminOrders();
    await listAssignableManagers();
    const call = firstArg<{
      where: { active: boolean; role: { in: string[] } };
      select: Record<string, boolean>;
    }>(userFindMany);
    expect(call.where.active).toBe(true);
    expect(call.where.role.in).toEqual(['SUPER_ADMIN', 'ADMIN', 'MANAGER']);
    expect(call.where.role.in).not.toContain('CONTENT_MANAGER');
    expect(Object.keys(call.select).sort()).toEqual(['id', 'name', 'role']);
  });
});
