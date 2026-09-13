import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
/** vi.fn() mocks declared without argument types give `.mock.calls` an empty
 * tuple type; this reads the first argument of the first call with the shape
 * the assertion actually needs. */
function firstArg<T>(fn: { mock: { calls: unknown[][] } }): T {
  return fn.mock.calls[0][0] as T;
}


/**
 * PATCH /api/admin/orders/[id]/manager and …/notes.
 *
 * These drive the real route handlers and the real service against a small
 * stateful fake of the two tables they touch, so the rules under test are the
 * ones that actually run in production: who may assign what, what a stale tab
 * is allowed to do, and what gets written to the audit trail.
 *
 * The fake bumps `updatedAt` on every successful write, exactly as Prisma's
 * `@updatedAt` does — that timestamp is the compare-and-swap token the whole
 * concurrency story rests on.
 */

const ORDER_ID = 'order-1';
const INITIAL_UPDATED_AT = new Date('2026-09-10T10:00:00.000Z');

interface FakeUser {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

const USERS: Record<string, FakeUser> = {
  'admin-1': { id: 'admin-1', name: 'Иван Админов', role: 'ADMIN', active: true },
  'manager-1': { id: 'manager-1', name: 'Пётр Менеджеров', role: 'MANAGER', active: true },
  'manager-2': { id: 'manager-2', name: 'Анна Менеджерова', role: 'MANAGER', active: true },
  'content-1': { id: 'content-1', name: 'Контент Контентов', role: 'CONTENT_MANAGER', active: true },
  'retired-1': { id: 'retired-1', name: 'Бывший Сотрудник', role: 'MANAGER', active: false },
};

interface OrderState {
  id: string;
  managerId: string | null;
  internalNotes: string | null;
  updatedAt: Date;
  exists: boolean;
}

function fakeCookieStore(token?: string) {
  return {
    get: vi.fn(() => (token ? { value: token } : undefined)),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

function patchRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildTx(state: OrderState) {
  const auditCreate = vi.fn(async () => ({}));

  const order = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (!state.exists || where.id !== state.id) return null;
      const manager = state.managerId ? USERS[state.managerId] : null;
      return {
        id: state.id,
        updatedAt: state.updatedAt,
        managerId: state.managerId,
        internalNotes: state.internalNotes,
        manager: manager ? { name: manager.name } : null,
      };
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; updatedAt?: Date; managerId?: string | null };
        data: Record<string, unknown>;
      }) => {
        if (!state.exists || where.id !== state.id) return { count: 0 };
        if (where.updatedAt && where.updatedAt.getTime() !== state.updatedAt.getTime()) {
          return { count: 0 };
        }
        if ('managerId' in where && where.managerId !== state.managerId) return { count: 0 };
        if ('managerId' in data) state.managerId = data.managerId as string | null;
        if ('internalNotes' in data) state.internalNotes = data.internalNotes as string | null;
        // Prisma's @updatedAt — the whole point of the CAS token.
        state.updatedAt = new Date(state.updatedAt.getTime() + 1000);
        return { count: 1 };
      },
    ),
  };

  const user = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => USERS[where.id] ?? null),
  };

  return { tx: { order, user, auditLog: { create: auditCreate } }, auditCreate, order, user };
}

async function setupRoutes(opts: { token?: string; state?: Partial<OrderState> } = {}) {
  vi.resetModules();
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');

  const cookieStore = fakeCookieStore(opts.token);
  vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

  const state: OrderState = {
    id: ORDER_ID,
    managerId: null,
    internalNotes: null,
    updatedAt: INITIAL_UPDATED_AT,
    exists: true,
    ...opts.state,
  };
  const fake = buildTx(state);
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx));
  vi.doMock('@/lib/db/client', () => ({ prisma: { $transaction: transaction } }));

  const { PATCH: assignManager } = await import('@/app/api/admin/orders/[id]/manager/route');
  const { PATCH: saveNotes } = await import('@/app/api/admin/orders/[id]/notes/route');
  return { assignManager, saveNotes, state, ...fake };
}

async function sessionTokenFor(user: FakeUser) {
  const { createSessionToken } = await import('@/lib/auth/session');
  return createSessionToken({
    id: user.id,
    email: `${user.id}@example.com`,
    name: user.name,
    role: user.role as never,
  });
}

const params = { params: Promise.resolve({ id: ORDER_ID }) };

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('next/headers');
  vi.doUnmock('@/lib/db/client');
});

describe('PATCH /api/admin/orders/[id]/manager — permissions', () => {
  it('rejects an unauthenticated request', async () => {
    const { assignManager } = await setupRoutes();
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    expect(response.status).toBe(401);
  });

  it('rejects CONTENT_MANAGER before reading anything', async () => {
    const token = await sessionTokenFor(USERS['content-1']);
    const { assignManager, order } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    expect(response.status).toBe(403);
    expect(order.findUnique).not.toHaveBeenCalled();
  });

  it.each(['admin-1'])('lets %s assign any manager', async (actorId) => {
    const token = await sessionTokenFor(USERS[actorId]);
    const { assignManager, state, auditCreate } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-2' }),
      params,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, changed: true, managerId: 'manager-2' });
    expect(state.managerId).toBe('manager-2');
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('lets ADMIN reassign an order that already has a manager', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, state } = await setupRoutes({ token, state: { managerId: 'manager-1' } });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-2' }),
      params,
    );
    expect(response.status).toBe(200);
    expect(state.managerId).toBe('manager-2');
  });

  it('lets ADMIN unassign with an explicit null', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, state } = await setupRoutes({ token, state: { managerId: 'manager-1' } });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: null }),
      params,
    );
    expect(response.status).toBe(200);
    expect(state.managerId).toBeNull();
  });
});

describe('PATCH …/manager — a manager may only claim a free order for themselves', () => {
  it('lets MANAGER claim an unassigned order', async () => {
    const token = await sessionTokenFor(USERS['manager-1']);
    const { assignManager, state, auditCreate } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    expect(response.status).toBe(200);
    expect(state.managerId).toBe('manager-1');
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses to let MANAGER take an order someone else already holds', async () => {
    const token = await sessionTokenFor(USERS['manager-1']);
    const { assignManager, state, auditCreate } = await setupRoutes({
      token,
      state: { managerId: 'manager-2' },
    });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    expect(response.status).toBe(403);
    expect(state.managerId).toBe('manager-2');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('refuses to let MANAGER assign a colleague', async () => {
    const token = await sessionTokenFor(USERS['manager-1']);
    const { assignManager, state, auditCreate } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-2' }),
      params,
    );
    expect(response.status).toBe(403);
    expect(state.managerId).toBeNull();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('refuses to let MANAGER release an order after claiming it', async () => {
    const token = await sessionTokenFor(USERS['manager-1']);
    const { assignManager, state } = await setupRoutes({ token, state: { managerId: 'manager-1' } });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: null }),
      params,
    );
    expect(response.status).toBe(403);
    expect(state.managerId).toBe('manager-1');
  });
});

describe('PATCH …/manager — assignee validity', () => {
  it('refuses a CONTENT_MANAGER as the responsible person', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, state } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'content-1' }),
      params,
    );
    expect(response.status).toBe(400);
    expect(state.managerId).toBeNull();
  });

  it('refuses a deactivated account', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'retired-1' }),
      params,
    );
    expect(response.status).toBe(400);
  });

  it('404s for an order that does not exist', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager } = await setupRoutes({ token, state: { exists: false } });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    expect(response.status).toBe(404);
  });
});

describe('PATCH …/manager — concurrency and no-ops', () => {
  it('409s a stale tab and leaves the order untouched', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, state, auditCreate } = await setupRoutes({
      token,
      state: { managerId: 'manager-2' },
    });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, {
        managerId: 'manager-1',
        expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
      }),
      params,
    );
    expect(response.status).toBe(409);
    expect(state.managerId).toBe('manager-2');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('lets the first of two simultaneous claims win and 409s the second', async () => {
    const token1 = await sessionTokenFor(USERS['manager-1']);
    const { assignManager, state } = await setupRoutes({ token: token1 });
    const loaded = state.updatedAt.toISOString();

    const first = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, {
        managerId: 'manager-1',
        expectedUpdatedAt: loaded,
      }),
      params,
    );
    expect(first.status).toBe(200);

    // The second manager's tab still holds the timestamp from before.
    const token2 = await sessionTokenFor(USERS['manager-2']);
    const cookieStore = fakeCookieStore(token2);
    vi.doMock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));
    const second = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, {
        managerId: 'manager-2',
        expectedUpdatedAt: loaded,
      }),
      params,
    );
    expect(second.status).toBe(409);
    expect(state.managerId).toBe('manager-1');
  });

  it('writes nothing when the manager is already the requested one', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, state, auditCreate, order } = await setupRoutes({
      token,
      state: { managerId: 'manager-1' },
    });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, changed: false });
    expect(order.updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(state.updatedAt).toEqual(INITIAL_UPDATED_AT);
  });

  it('treats an already-unassigned order asked to be unassigned as a no-op', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, auditCreate } = await setupRoutes({ token });
    const response = await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: null }),
      params,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: false });
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/orders/[id]/notes', () => {
  const notesPath = `/api/admin/orders/${ORDER_ID}/notes`;

  it('rejects an unauthenticated request', async () => {
    const { saveNotes } = await setupRoutes();
    const response = await saveNotes(patchRequest(notesPath, { internalNotes: 'x' }), params);
    expect(response.status).toBe(401);
  });

  it('keeps CONTENT_MANAGER read-only', async () => {
    const token = await sessionTokenFor(USERS['content-1']);
    const { saveNotes, state, order } = await setupRoutes({ token });
    const response = await saveNotes(
      patchRequest(notesPath, { internalNotes: 'правка' }),
      params,
    );
    expect(response.status).toBe(403);
    expect(state.internalNotes).toBeNull();
    expect(order.updateMany).not.toHaveBeenCalled();
  });

  it.each(['admin-1', 'manager-1'])('lets %s save a note', async (actorId) => {
    const token = await sessionTokenFor(USERS[actorId]);
    const { saveNotes, state, auditCreate } = await setupRoutes({ token });
    const response = await saveNotes(
      patchRequest(notesPath, { internalNotes: 'Перезвонить после 18:00' }),
      params,
    );
    expect(response.status).toBe(200);
    expect(state.internalNotes).toBe('Перезвонить после 18:00');
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('stores plain text — markup never reaches the database', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes, state } = await setupRoutes({ token });
    const response = await saveNotes(
      patchRequest(notesPath, { internalNotes: '<script>alert(1)</script><b>срочно</b>' }),
      params,
    );
    expect(response.status).toBe(200);
    expect(state.internalNotes).toBe('срочно');
  });

  it('rejects a note longer than 5000 characters instead of truncating it', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes, state } = await setupRoutes({ token });
    const response = await saveNotes(
      patchRequest(notesPath, { internalNotes: 'я'.repeat(5001) }),
      params,
    );
    expect(response.status).toBe(400);
    expect(state.internalNotes).toBeNull();
  });

  it('clears the note when an empty string is saved', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes, state } = await setupRoutes({ token, state: { internalNotes: 'старое' } });
    const response = await saveNotes(patchRequest(notesPath, { internalNotes: '' }), params);
    expect(response.status).toBe(200);
    expect(state.internalNotes).toBeNull();
  });

  it('409s a stale tab and keeps the colleague’s text', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes, state, auditCreate } = await setupRoutes({
      token,
      state: { internalNotes: 'чужая заметка' },
    });
    const response = await saveNotes(
      patchRequest(notesPath, {
        internalNotes: 'моя заметка',
        expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
      }),
      params,
    );
    expect(response.status).toBe(409);
    expect(state.internalNotes).toBe('чужая заметка');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('writes nothing when the note is unchanged', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes, auditCreate, order } = await setupRoutes({
      token,
      state: { internalNotes: 'без изменений' },
    });
    const response = await saveNotes(
      patchRequest(notesPath, { internalNotes: 'без изменений' }),
      params,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: false });
    expect(order.updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('treats a note that only differs by line endings as unchanged', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes, auditCreate } = await setupRoutes({
      token,
      state: { internalNotes: 'строка 1\nстрока 2' },
    });
    const response = await saveNotes(
      patchRequest(notesPath, { internalNotes: 'строка 1\r\nстрока 2' }),
      params,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: false });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('404s for an order that does not exist', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { saveNotes } = await setupRoutes({ token, state: { exists: false } });
    const response = await saveNotes(patchRequest(notesPath, { internalNotes: 'x' }), params);
    expect(response.status).toBe(404);
  });
});

describe('audit rows', () => {
  it('records who assigned whom, with a name snapshot that survives deletion', async () => {
    const token = await sessionTokenFor(USERS['admin-1']);
    const { assignManager, auditCreate } = await setupRoutes({ token });
    await assignManager(
      patchRequest(`/api/admin/orders/${ORDER_ID}/manager`, { managerId: 'manager-1' }),
      params,
    );
    const entry = firstArg<{ data: Record<string, unknown> }>(auditCreate);
    expect(entry.data).toMatchObject({
      action: 'ORDER_MANAGER_ASSIGNED',
      entityType: 'ORDER',
      entityId: ORDER_ID,
      userId: 'admin-1',
    });
    expect(entry.data.newData).toMatchObject({
      managerId: 'manager-1',
      managerName: 'Пётр Менеджеров',
      actorName: 'Иван Админов',
    });
  });

  it('records the note change under its own action', async () => {
    const token = await sessionTokenFor(USERS['manager-1']);
    const { saveNotes, auditCreate } = await setupRoutes({ token });
    await saveNotes(
      patchRequest(`/api/admin/orders/${ORDER_ID}/notes`, { internalNotes: 'новая заметка' }),
      params,
    );
    const entry = firstArg<{ data: Record<string, unknown> }>(auditCreate);
    expect(entry.data).toMatchObject({ action: 'ORDER_INTERNAL_NOTES_UPDATED', userId: 'manager-1' });
    expect(entry.data.newData).toMatchObject({ internalNotes: 'новая заметка' });
  });
});
