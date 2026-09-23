import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { adminUserLookupFor } from './helpers/admin-session-user';

/**
 * POST /api/admin/orders/[id]/status — the only route that can move an order
 * through the workflow. What is asserted here is the whole contract of that
 * route: who may call it, which steps it accepts, that PAID is unreachable
 * without an admin session, that a stale page cannot apply a second change,
 * and that every accepted change leaves an audit trail.
 */

const LOADED_AT = new Date('2026-09-20T10:00:00.000Z');
const SAVED_AT = new Date('2026-09-20T10:05:00.000Z');

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

function params(id = 'order-1') {
  return { params: Promise.resolve({ id }) };
}

function txMock(currentStatus: string, opts: { casMatches?: boolean } = {}) {
  let reads = 0;
  const order = {
    // Call 1: the order as the transaction finds it. Later calls read the
    // post-update `updatedAt` the route hands back as the next CAS token.
    findUnique: vi.fn(async (): Promise<{ status?: string; updatedAt: Date } | null> => {
      reads += 1;
      return reads === 1 ? { status: currentStatus, updatedAt: LOADED_AT } : { updatedAt: SAVED_AT };
    }),
    // count: 0 is a row that moved between the read and the write.
    updateMany: vi.fn(async () => ({ count: opts.casMatches === false ? 0 : 1 })),
  };
  const orderStatusHistory = { create: vi.fn(async () => ({})) };
  const auditLog = { create: vi.fn(async () => ({})) };
  return { order, orderStatusHistory, auditLog };
}

async function setupStatusRoute(
  opts: { token?: string; currentStatus?: string; casMatches?: boolean } = {},
) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');

  const cookieStore = fakeCookieStore(opts.token);
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

  const tx = txMock(opts.currentStatus ?? 'NEW', { casMatches: opts.casMatches });
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx));
  vi.doMock('@/lib/db/client', () => ({ prisma: { $transaction: transaction, user: adminUserLookupFor(opts.token) } }));

  const { POST } = await import('@/app/api/admin/orders/[id]/status/route');
  return { POST, tx, transaction };
}

async function sessionTokenFor(role: string) {
  const { createSessionToken } = await import('@/lib/auth/session');
  return createSessionToken({ id: 'admin-1', email: 'a@b.com', name: 'Иван Админов', role: role as never });
}

/** Sets AUTH_SECRET before minting a token, then wires the route. */
async function setupAs(
  role: string,
  opts: { currentStatus?: string; casMatches?: boolean } = {},
) {
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  const token = await sessionTokenFor(role);
  return setupStatusRoute({ token, ...opts });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

describe('POST /api/admin/orders/[id]/status — authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const { POST, transaction } = await setupStatusRoute();
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());
    expect(response.status).toBe(401);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects CONTENT_MANAGER — only SUPER_ADMIN/ADMIN/MANAGER may change status', async () => {
    const { POST, transaction } = await setupAs('CONTENT_MANAGER');
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());
    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])('allows %s to perform an allowed transition', async (role) => {
    const { POST } = await setupAs(role, { currentStatus: 'NEW' });
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(true);
  });

  it('rejects an invalid/unknown status value', async () => {
    const { POST, transaction } = await setupAs('ADMIN');
    const response = await POST(statusRequest({ status: 'NOT_A_REAL_STATUS' }), params());
    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-existent order', async () => {
    const { POST, tx } = await setupAs('ADMIN');
    tx.order.findUnique.mockResolvedValueOnce(null);
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params('missing'));
    expect(response.status).toBe(404);
  });
});

/**
 * The PAID boundary. There is no public route that can move an order at all —
 * these assert the same thing from the only route that exists: without an
 * authenticated admin session, no request shape reaches the database.
 */
describe('POST /api/admin/orders/[id]/status — PAID is never public', () => {
  it('refuses an unauthenticated request that asks for PAID', async () => {
    const { POST, transaction } = await setupStatusRoute({ currentStatus: 'AWAITING_PAYMENT' });
    const response = await POST(statusRequest({ status: 'PAID' }), params());
    expect(response.status).toBe(401);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a signed-in CONTENT_MANAGER who asks for PAID', async () => {
    const { POST, transaction } = await setupAs('CONTENT_MANAGER', { currentStatus: 'AWAITING_PAYMENT' });
    const response = await POST(statusRequest({ status: 'PAID' }), params());
    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('ignores client-supplied totals and a claimed status on the order', async () => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'AWAITING_PAYMENT' });
    const response = await POST(
      statusRequest({
        status: 'PAID',
        grandTotal: 1,
        netTotal: 1,
        paid: true,
        currentStatus: 'DELIVERED',
      }),
      params(),
    );
    expect(response.status).toBe(200);
    // Only the status column is written — nothing the client sent about money
    // reaches the row.
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAID' } }),
    );
  });

  it('refuses PAID when the order has not reached AWAITING_PAYMENT', async () => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    const response = await POST(statusRequest({ status: 'PAID' }), params());
    expect(response.status).toBe(409);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/orders/[id]/status — the transition policy', () => {
  const FORWARD: ReadonlyArray<[string, string]> = [
    ['NEW', 'CONFIRMED'],
    ['CONFIRMED', 'AWAITING_PAYMENT'],
    ['AWAITING_PAYMENT', 'PAID'],
    ['PAID', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'READY'],
    ['READY', 'DELIVERED'],
  ];

  it.each(FORWARD)('accepts %s → %s', async (from, to) => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: from });
    const response = await POST(statusRequest({ status: to }), params());
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true, changed: true, previousStatus: from, newStatus: to });
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: to } }),
    );
  });

  it.each(['NEW', 'CONFIRMED', 'AWAITING_PAYMENT', 'PAID', 'IN_PROGRESS', 'READY'])(
    'accepts cancelling from %s',
    async (from) => {
      const { POST } = await setupAs('ADMIN', { currentStatus: from });
      const response = await POST(statusRequest({ status: 'CANCELLED' }), params());
      expect(response.status).toBe(200);
      expect((await response.json()).newStatus).toBe('CANCELLED');
    },
  );

  it.each([
    ['NEW', 'DELIVERED'],
    ['NEW', 'IN_PROGRESS'],
    ['CONFIRMED', 'PAID'],
    ['AWAITING_PAYMENT', 'IN_PROGRESS'],
    ['PAID', 'AWAITING_PAYMENT'],
    ['READY', 'IN_PROGRESS'],
  ])('rejects the invalid transition %s → %s and writes nothing', async (from, to) => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: from });
    const response = await POST(statusRequest({ status: to }), params());
    expect(response.status).toBe(409);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['DELIVERED', 'CANCELLED'])('refuses to move a finished (%s) order', async (from) => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: from });
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/завершён/);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op (no writes) when the requested status equals the current one', async () => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'CONFIRMED' });
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/orders/[id]/status — concurrency', () => {
  it('rejects a change sent against a stale expectedUpdatedAt', async () => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    const response = await POST(
      statusRequest({ status: 'CONFIRMED', expectedUpdatedAt: '2026-09-20T09:00:00.000Z' }),
      params(),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe('CONFLICT');
    // The client is handed the order's real current token to reload with.
    expect(json.details).toEqual([LOADED_AT.toISOString()]);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('accepts a change sent against the current expectedUpdatedAt', async () => {
    const { POST } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    const response = await POST(
      statusRequest({ status: 'CONFIRMED', expectedUpdatedAt: LOADED_AT.toISOString() }),
      params(),
    );
    expect(response.status).toBe(200);
  });

  it('rejects a malformed expectedUpdatedAt rather than ignoring the guard', async () => {
    const { POST, transaction } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    const response = await POST(
      statusRequest({ status: 'CONFIRMED', expectedUpdatedAt: 'not-a-date' }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('compare-and-swaps on both the token and the status being left', async () => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    await POST(statusRequest({ status: 'CONFIRMED' }), params());
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', updatedAt: LOADED_AT, status: 'NEW' },
      data: { status: 'CONFIRMED' },
    });
  });

  it('rejects the losing side of a concurrent change even without a token', async () => {
    // The row moved between the read and the write: the CAS matches 0 rows.
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'NEW', casMatches: false });
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());

    expect(response.status).toBe(409);
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns the new updatedAt so the next change has a fresh token', async () => {
    const { POST } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());
    expect((await response.json()).updatedAt).toBe(SAVED_AT.toISOString());
  });
});

describe('POST /api/admin/orders/[id]/status — audit trail', () => {
  it('updates the order, appends OrderStatusHistory and writes AuditLog in one transaction', async () => {
    const { POST, tx, transaction } = await setupAs('ADMIN', { currentStatus: 'NEW' });
    const response = await POST(statusRequest({ status: 'CONFIRMED' }), params());

    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          status: 'CONFIRMED',
          changedBy: 'Иван Админов',
        }),
      }),
    );
  });

  it('records the actor, the previous state and the new state', async () => {
    const { POST, tx } = await setupAs('ADMIN', { currentStatus: 'AWAITING_PAYMENT' });
    await POST(statusRequest({ status: 'PAID' }), params());

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'ORDER_STATUS_CHANGED',
          entityType: 'ORDER',
          entityId: 'order-1',
          previousData: { status: 'AWAITING_PAYMENT' },
          // actorName survives the account being deleted; channel records the
          // trusted path the change came through.
          newData: { status: 'PAID', actorName: 'Иван Админов', channel: 'ADMIN' },
        }),
      }),
    );
  });
});
