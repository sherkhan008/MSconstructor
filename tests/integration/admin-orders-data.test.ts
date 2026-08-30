import { afterEach, describe, expect, it, vi } from 'vitest';

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

  vi.doMock('@/lib/db/client', () => ({
    prisma: { order: { findMany, count, findUnique }, $transaction: transaction },
  }));

  const mod = await import('@/lib/admin/orders');
  return { ...mod, findMany, count, findUnique };
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
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PAID' } }));
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
      updateOrderStatus({ orderId: 'order-1', newStatus: 'CONTACTED', actor: { id: 'a1', name: 'A' } }),
    ).rejects.toThrow(/PostgreSQL/);
  });
});
