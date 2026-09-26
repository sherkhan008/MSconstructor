import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateOrderNumber } from '@/lib/orders/store';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * Order numbers are the customer-facing reference for an order and the only
 * key the success page looks one up by, so they must be unguessable — not
 * merely unique. These tests pin the two properties that matter: the source
 * of randomness is Node's CSPRNG, and the human-readable format did not
 * change when it was swapped in.
 */

const ORDER_NUMBER = /^MS-\d{8}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

const STORE_SOURCE = path.join(process.cwd(), 'src', 'lib', 'orders', 'store.ts');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('@/lib/orders/db-store');
});

describe('generateOrderNumber', () => {
  it('never uses Math.random', () => {
    const mathRandom = vi.spyOn(Math, 'random');
    for (let i = 0; i < 100; i += 1) generateOrderNumber();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('draws its randomness from node:crypto, not the global Math/Web fallback', () => {
    const source = readFileSync(STORE_SOURCE, 'utf8');
    expect(source).toContain("from 'node:crypto'");
    // A stray Math.random CALL anywhere in this module would be a regression
    // even if generateOrderNumber itself stopped making one. (The module's
    // own comments name Math.random to explain why it is not used, so this
    // matches the call syntax rather than the bare name.)
    expect(source).not.toMatch(/Math\.random\s*\(/);
  });

  it('keeps the MS-YYYYMMDD-XXXXX format', () => {
    expect(generateOrderNumber()).toMatch(ORDER_NUMBER);
  });

  it('uses today, in the same date encoding as before', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    expect(generateOrderNumber().split('-')[1]).toBe(expected);
  });

  it('uses only unambiguous suffix symbols (no I, O, 0 or 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const suffix = generateOrderNumber().split('-')[2];
      expect(suffix).not.toMatch(/[IO01]/);
    }
  });

  it('exposes no database id, counter or customer data', () => {
    // Nothing beyond the fixed prefix, the date and the random suffix: three
    // segments, the last of a fixed length.
    const parts = generateOrderNumber().split('-');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('MS');
    expect(parts[2]).toHaveLength(5);
  });

  it('produces distinct values across many calls', () => {
    const draws = 2000;
    const generated = new Set<string>();
    for (let i = 0; i < draws; i += 1) generated.add(generateOrderNumber());
    // Birthday bound, not a per-draw chance: 2000 draws form C(2000, 2) ≈
    // 2.0M pairs over 32^5 ≈ 33.5M suffixes, so the expected number of
    // colliding pairs is λ ≈ 0.06 — about 1 run in 17 sees at least one
    // duplicate by pure chance, which is why demanding exactly 2000 was
    // flaky. Real uniqueness is the database's unique index plus saveOrder's
    // retry (tested below), not this sample. What this does catch is a
    // low-entropy or stuck generator: with a Poisson(0.06) count, more than
    // 5 duplicates happens with probability ~6e-11 for the real generator,
    // while a generator with even 2^16 distinct values would produce ~30.
    expect(draws - generated.size).toBeLessThanOrEqual(5);
  });

  it('spreads suffix symbols across the whole alphabet (no masked-off range)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      for (const char of generateOrderNumber().split('-')[2]) seen.add(char);
    }
    expect(seen.size).toBe(32);
  });

  it('is deterministic ONLY when crypto itself is mocked', async () => {
    vi.resetModules();
    vi.doMock('node:crypto', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:crypto')>();
      return { ...actual, randomBytes: (size: number) => Buffer.alloc(size, 0) };
    });

    const { generateOrderNumber: mocked } = await import('@/lib/orders/store');
    // Every byte 0 maps to index 0, i.e. the first alphabet symbol, five times over.
    expect(mocked().split('-')[2]).toBe('AAAAA');
    expect(mocked()).toBe(mocked());

    vi.doUnmock('node:crypto');
    vi.resetModules();
    const { generateOrderNumber: real } = await import('@/lib/orders/store');
    expect(real()).not.toBe(real());
  });
});

function orderFixture(orderNumber: string): OrderRecord {
  return {
    id: 'order-1',
    orderNumber,
    status: 'NEW',
    customer: {
      fullName: 'Тест Клиент',
      phone: '+77071234567',
      city: 'Алматы',
      type: 'INDIVIDUAL',
    },
    paymentPreference: 'BANK_TRANSFER',
    items: [],
    netTotal: 0,
    vatTotal: 0,
    discountTotal: 0,
    grandTotal: 0,
    createdAt: new Date().toISOString(),
  } as OrderRecord;
}

/** What Prisma raises when Order.orderNumber's unique index rejects a write. */
function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['orderNumber'] } });
}

describe('saveOrder collision handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('retries with a fresh number when the unique constraint rejects one', async () => {
    const attempted: string[] = [];
    const saveOrderToDb = vi.fn(async (order: OrderRecord) => {
      attempted.push(order.orderNumber);
      if (attempted.length === 1) throw uniqueViolation();
      return order;
    });
    vi.doMock('@/lib/orders/db-store', () => ({ saveOrderToDb, getOrderByNumberFromDb: vi.fn() }));

    const { saveOrder } = await import('@/lib/orders/store');
    const saved = await saveOrder(orderFixture('MS-20260101-AAAAA'));

    expect(attempted).toHaveLength(2);
    expect(attempted[0]).toBe('MS-20260101-AAAAA');
    expect(attempted[1]).not.toBe(attempted[0]);
    // The caller must read the number back off the returned record.
    expect(saved.orderNumber).toBe(attempted[1]);
    expect(saved.orderNumber).toMatch(ORDER_NUMBER);
  });

  it('gives up after a bounded number of attempts instead of looping forever', async () => {
    const saveOrderToDb = vi.fn(async () => {
      throw uniqueViolation();
    });
    vi.doMock('@/lib/orders/db-store', () => ({ saveOrderToDb, getOrderByNumberFromDb: vi.fn() }));

    const { saveOrder } = await import('@/lib/orders/store');
    await expect(saveOrder(orderFixture('MS-20260101-AAAAA'))).rejects.toMatchObject({ code: 'P2002' });
    expect(saveOrderToDb).toHaveBeenCalledTimes(5);
  });

  it('never retries a failure that is not a collision', async () => {
    for (const failure of [
      Object.assign(new Error('foreign key'), { code: 'P2003', meta: { field_name: 'customerId' } }),
      Object.assign(new Error('database unreachable'), { code: 'P1001' }),
      new Error('unexpected'),
    ]) {
      vi.resetModules();
      const saveOrderToDb = vi.fn(async () => {
        throw failure;
      });
      vi.doMock('@/lib/orders/db-store', () => ({ saveOrderToDb, getOrderByNumberFromDb: vi.fn() }));

      const { saveOrder } = await import('@/lib/orders/store');
      await expect(saveOrder(orderFixture('MS-20260101-AAAAA'))).rejects.toBe(failure);
      expect(saveOrderToDb).toHaveBeenCalledTimes(1);
    }
  });

  it('re-runs the same order when a concurrent first order from that phone created the Customer row', async () => {
    // The whole nested write failed atomically, so nothing of this order was
    // stored: the retry keeps its number and connects to the winner's row.
    const attempted: string[] = [];
    const saveOrderToDb = vi.fn(async (order: OrderRecord) => {
      attempted.push(order.orderNumber);
      if (attempted.length === 1) {
        throw Object.assign(new Error('customer conflict'), { code: 'P2002', meta: { target: ['phone', 'type'] } });
      }
      return order;
    });
    vi.doMock('@/lib/orders/db-store', () => ({ saveOrderToDb, getOrderByNumberFromDb: vi.fn() }));

    const { saveOrder } = await import('@/lib/orders/store');
    const saved = await saveOrder(orderFixture('MS-20260101-AAAAA'));
    expect(attempted).toEqual(['MS-20260101-AAAAA', 'MS-20260101-AAAAA']);
    expect(saved.orderNumber).toBe('MS-20260101-AAAAA');
  });

  it('bounds the customer-conflict retry as well', async () => {
    const saveOrderToDb = vi.fn(async () => {
      throw Object.assign(new Error('customer conflict'), { code: 'P2002', meta: { target: ['phone', 'type'] } });
    });
    vi.doMock('@/lib/orders/db-store', () => ({ saveOrderToDb, getOrderByNumberFromDb: vi.fn() }));

    const { saveOrder } = await import('@/lib/orders/store');
    await expect(saveOrder(orderFixture('MS-20260101-AAAAA'))).rejects.toThrow('customer conflict');
    expect(saveOrderToDb).toHaveBeenCalledTimes(5);
  });

  it('does not reuse a number already held in the in-memory dev store', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.resetModules();
    const { saveOrder, clearMemoryOrders, getOrderByNumber } = await import('@/lib/orders/store');
    clearMemoryOrders();

    const first = await saveOrder(orderFixture('MS-20260101-AAAAA'));
    const second = await saveOrder(orderFixture('MS-20260101-AAAAA'));

    expect(first.orderNumber).toBe('MS-20260101-AAAAA');
    expect(second.orderNumber).not.toBe(first.orderNumber);
    expect(second.orderNumber).toMatch(ORDER_NUMBER);
    await expect(getOrderByNumber(first.orderNumber)).resolves.toBeDefined();
    await expect(getOrderByNumber(second.orderNumber)).resolves.toBeDefined();
    clearMemoryOrders();
  });
});
