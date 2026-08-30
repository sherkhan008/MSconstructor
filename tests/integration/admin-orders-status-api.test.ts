import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

function fakeCookieStore(token?: string) {
  return {
    get: vi.fn(() => (token ? { value: token } : undefined)),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

function statusRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/orders/order-1/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function txMock(currentStatus: string) {
  const order = {
    findUnique: vi.fn(async (): Promise<{ status: string } | null> => ({ status: currentStatus })),
    update: vi.fn(async () => ({})),
  };
  const orderStatusHistory = { create: vi.fn(async () => ({})) };
  const auditLog = { create: vi.fn(async () => ({})) };
  return { order, orderStatusHistory, auditLog };
}

async function setupStatusRoute(opts: { token?: string; currentStatus?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');

  const cookieStore = fakeCookieStore(opts.token);
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

  const tx = txMock(opts.currentStatus ?? 'NEW');
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx));
  vi.doMock('@/lib/db/client', () => ({ prisma: { $transaction: transaction } }));

  const { POST } = await import('@/app/api/admin/orders/[id]/status/route');
  return { POST, tx, transaction };
}

async function sessionTokenFor(role: string) {
  const { createSessionToken } = await import('@/lib/auth/session');
  return createSessionToken({ id: 'admin-1', email: 'a@b.com', name: 'Иван Админов', role: role as never });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

describe('POST /api/admin/orders/[id]/status', () => {
  it('rejects an unauthenticated request', async () => {
    const { POST } = await setupStatusRoute();
    const response = await POST(statusRequest({ status: 'CONTACTED' }), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(401);
  });

  it('rejects CONTENT_MANAGER — only SUPER_ADMIN/ADMIN/MANAGER may change status', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const token = await sessionTokenFor('CONTENT_MANAGER');
    const { POST, transaction } = await setupStatusRoute({ token });
    const response = await POST(statusRequest({ status: 'CONTACTED' }), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])('allows %s to change status', async (role) => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const token = await sessionTokenFor(role);
    const { POST } = await setupStatusRoute({ token });
    const response = await POST(statusRequest({ status: 'CONTACTED' }), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(200);
  });

  it('rejects an invalid/unknown status value', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const token = await sessionTokenFor('ADMIN');
    const { POST, transaction } = await setupStatusRoute({ token });
    const response = await POST(statusRequest({ status: 'NOT_A_REAL_STATUS' }), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('updates Order.status, appends OrderStatusHistory, and writes AuditLog inside one transaction', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const token = await sessionTokenFor('ADMIN');
    const { POST, tx, transaction } = await setupStatusRoute({ token, currentStatus: 'NEW' });

    const response = await POST(statusRequest({ status: 'CONTACTED' }), { params: Promise.resolve({ id: 'order-1' }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(true);
    expect(json.previousStatus).toBe('NEW');
    expect(json.newStatus).toBe('CONTACTED');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: 'CONTACTED' } });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'order-1', status: 'CONTACTED', changedBy: 'Иван Админов' }) }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'ORDER_STATUS_CHANGED',
          entityType: 'ORDER',
          entityId: 'order-1',
          previousData: { status: 'NEW' },
          newData: { status: 'CONTACTED' },
        }),
      }),
    );
  });

  it('is a no-op (no writes) when the requested status equals the current one', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const token = await sessionTokenFor('ADMIN');
    const { POST, tx } = await setupStatusRoute({ token, currentStatus: 'CONTACTED' });

    const response = await POST(statusRequest({ status: 'CONTACTED' }), { params: Promise.resolve({ id: 'order-1' }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(false);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-existent order', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
    const token = await sessionTokenFor('ADMIN');
    const { POST, tx } = await setupStatusRoute({ token });
    tx.order.findUnique.mockResolvedValueOnce(null);

    const response = await POST(statusRequest({ status: 'CONTACTED' }), { params: Promise.resolve({ id: 'missing' }) });
    expect(response.status).toBe(404);
  });
});
