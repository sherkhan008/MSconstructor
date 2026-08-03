import { hasDatabase } from '@/lib/env';
import type { OrderRecord } from './types';

/**
 * Order persistence. Mirrors src/lib/data/repository.ts's db/mock split:
 * without DATABASE_URL, orders live in an in-memory array for the lifetime
 * of the dev server process — enough to exercise the full checkout flow
 * (including the success page re-fetching the order by number) with zero
 * infrastructure. With DATABASE_URL set, everything routes through Prisma.
 */

function randomSuffix(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function generateOrderNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `MS-${date}-${randomSuffix(5)}`;
}

const memoryOrders: OrderRecord[] = [];

export async function saveOrder(order: OrderRecord): Promise<OrderRecord> {
  if (hasDatabase) {
    const { saveOrderToDb } = await import('./db-store');
    return saveOrderToDb(order);
  }
  memoryOrders.unshift(order);
  return order;
}

export async function getOrderByNumber(orderNumber: string): Promise<OrderRecord | undefined> {
  if (hasDatabase) {
    const { getOrderByNumberFromDb } = await import('./db-store');
    return getOrderByNumberFromDb(orderNumber);
  }
  return memoryOrders.find((o) => o.orderNumber === orderNumber);
}

/** Test/dev-only escape hatch. */
export function clearMemoryOrders(): void {
  memoryOrders.length = 0;
}
