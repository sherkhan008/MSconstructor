import { randomBytes } from 'node:crypto';
import { assertDatabaseConfigured, hasDatabase } from '@/lib/env';
import type { OrderRecord } from './types';

/**
 * Order persistence. Mirrors src/lib/data/repository.ts's db/mock split:
 * without DATABASE_URL, orders live in an in-memory array for the lifetime
 * of the dev server process — enough to exercise the full checkout flow
 * (including the success page re-fetching the order by number) with zero
 * infrastructure. With DATABASE_URL set, everything routes through Prisma.
 */

/**
 * Crockford-style alphabet: no I/O/0/1, so a number read off a screen and
 * typed back into a support chat cannot be mistyped into a different valid
 * order. Exactly 32 symbols — which is what lets the suffix be drawn from
 * raw random bytes with a 5-bit mask below, with no modulo bias.
 */
const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SUFFIX_LENGTH = 5;

/**
 * Node's CSPRNG (`node:crypto`), never Math.random: an order number is shown
 * to the customer as the reference for their order and is looked up by number
 * alone on the success page, so a predictable suffix would let anyone
 * enumerate other people's orders. Importing `node:crypto` also keeps
 * generation structurally server-only — this module cannot be pulled into a
 * browser bundle.
 *
 * 256 / 32 = 8 exactly, so masking each byte with 0b11111 keeps every symbol
 * equally likely; a `% alphabet.length` over a non-power-of-two alphabet
 * would not.
 */
function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SUFFIX_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

/**
 * `MS-YYYYMMDD-XXXXX` — unchanged from the first release: same prefix, same
 * local-date segment, same 5-symbol suffix length and alphabet. Only the
 * source of randomness changed. Carries no database id, no counter and no
 * customer data.
 */
export function generateOrderNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `MS-${date}-${randomSuffix(SUFFIX_LENGTH)}`;
}

/** Order.orderNumber is `@unique` in the schema; a duplicate surfaces as a Prisma P2002. */
function isOrderNumberConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes('orderNumber');
  return typeof target === 'string' && target.includes('orderNumber');
}

/**
 * 32^5 ≈ 33.5M suffixes per calendar day, so a collision is already
 * improbable — but "improbable" is not "impossible", and losing a real
 * customer's order to one would be unacceptable. The database's unique
 * constraint stays the authority; this just retries behind it with a fresh
 * number. Five attempts make an unlucky-but-genuine collision effectively
 * impossible to observe, while a persistent P2002 (i.e. a real bug) still
 * surfaces instead of looping.
 */
const MAX_ORDER_NUMBER_ATTEMPTS = 5;

const memoryOrders: OrderRecord[] = [];

/**
 * Persists the order, regenerating its number if that number is already
 * taken. Returns the record as actually stored — callers must read the order
 * number back off the return value (the API route does), never off the object
 * they passed in.
 */
export async function saveOrder(order: OrderRecord): Promise<OrderRecord> {
  assertDatabaseConfigured('order');
  if (hasDatabase) {
    const { saveOrderToDb } = await import('./db-store');
    let candidate = order;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await saveOrderToDb(candidate);
      } catch (error) {
        if (attempt >= MAX_ORDER_NUMBER_ATTEMPTS || !isOrderNumberConflict(error)) throw error;
        candidate = { ...candidate, orderNumber: generateOrderNumber() };
      }
    }
  }

  let stored = order;
  for (let attempt = 1; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    if (!memoryOrders.some((existing) => existing.orderNumber === stored.orderNumber)) break;
    stored = { ...stored, orderNumber: generateOrderNumber() };
  }
  memoryOrders.unshift(stored);
  return stored;
}

export async function getOrderByNumber(orderNumber: string): Promise<OrderRecord | undefined> {
  assertDatabaseConfigured('order');
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

/** Test-only: lets a rejected-request test assert zero orders were created,
 * rather than only inferring it from the HTTP status. */
export function countMemoryOrders(): number {
  return memoryOrders.length;
}
