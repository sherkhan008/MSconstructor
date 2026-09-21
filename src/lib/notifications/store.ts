import { hasDatabase } from '@/lib/env';
import type { OrderEventPayload } from './events';

/**
 * Delivery outbox: one row per (event, channel) attempt that was actually
 * made. Mirrors the db/memory split of the order and payment stores. Only
 * short codes and the redacted payload are ever written here.
 *
 * Retry scheduling (./retry-policy.ts): a FAILED row with a `nextAttemptAt`
 * is due for an automatic retry at that time; a FAILED row without one is
 * final. A SENT row never has one and is never listed for retry.
 */

export type DeliveryStatus = 'SENT' | 'FAILED';

export interface DeliveryRecord {
  id: string;
  event: string;
  channel: string;
  status: DeliveryStatus;
  orderNumber: string;
  payload: OrderEventPayload;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

const memoryDeliveries: DeliveryRecord[] = [];

export async function recordDelivery(
  input: Omit<DeliveryRecord, 'id' | 'attempts' | 'createdAt'> & { createdAt?: Date },
): Promise<void> {
  const nextAttemptAt = input.status === 'FAILED' ? input.nextAttemptAt : null;
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    await prisma.notificationDelivery.create({
      data: {
        event: input.event,
        channel: input.channel,
        status: input.status,
        orderNumber: input.orderNumber,
        payload: input.payload as unknown as object,
        lastError: input.lastError,
        nextAttemptAt,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
    return;
  }
  memoryDeliveries.push({
    ...input,
    nextAttemptAt,
    id: crypto.randomUUID(),
    attempts: 1,
    createdAt: input.createdAt ?? new Date(),
  });
}

/** Whether this (event, channel, order) was already delivered — the
 * idempotency check behind NotificationChannel.oncePerOrder. */
export async function hasSentDelivery(event: string, channel: string, orderNumber: string): Promise<boolean> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const row = await prisma.notificationDelivery.findFirst({
      where: { event, channel, orderNumber, status: 'SENT' },
      select: { id: true },
    });
    return row !== null;
  }
  return memoryDeliveries.some(
    (d) => d.event === event && d.channel === channel && d.orderNumber === orderNumber && d.status === 'SENT',
  );
}

/** FAILED rows whose next attempt is due, soonest first. */
export async function listDueDeliveries(now: Date, limit = 50): Promise<DeliveryRecord[]> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const rows = await prisma.notificationDelivery.findMany({
      where: { status: 'FAILED', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      channel: r.channel,
      status: 'FAILED' as const,
      orderNumber: r.orderNumber,
      payload: r.payload as unknown as OrderEventPayload,
      attempts: r.attempts,
      lastError: r.lastError ?? undefined,
      nextAttemptAt: r.nextAttemptAt,
      createdAt: r.createdAt,
    }));
  }
  // Snapshots, like the rows a database query returns: claimDelivery must
  // compare against the schedule as it was listed, not the live row.
  return memoryDeliveries
    .filter((d) => d.status === 'FAILED' && d.nextAttemptAt !== null && d.nextAttemptAt <= now)
    .sort((a, b) => a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime())
    .slice(0, limit)
    .map((d) => ({ ...d }));
}

/**
 * Takes a due row for one retry: moves its `nextAttemptAt` to `leaseUntil`
 * only if it is still FAILED and still scheduled exactly as listed. Returns
 * false when another worker already took it (or it was sent meanwhile).
 */
export async function claimDelivery(id: string, listedNextAttemptAt: Date, leaseUntil: Date): Promise<boolean> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const { count } = await prisma.notificationDelivery.updateMany({
      where: { id, status: 'FAILED', nextAttemptAt: listedNextAttemptAt },
      data: { nextAttemptAt: leaseUntil },
    });
    return count === 1;
  }
  const row = memoryDeliveries.find((d) => d.id === id);
  if (!row || row.status !== 'FAILED' || row.nextAttemptAt?.getTime() !== listedNextAttemptAt.getTime()) return false;
  row.nextAttemptAt = leaseUntil;
  return true;
}

/** Changes when (or, with null, whether) a FAILED row is retried, without counting an attempt. */
export async function rescheduleDelivery(id: string, nextAttemptAt: Date | null): Promise<void> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    await prisma.notificationDelivery.updateMany({ where: { id, status: 'FAILED' }, data: { nextAttemptAt } });
    return;
  }
  const row = memoryDeliveries.find((d) => d.id === id);
  if (row && row.status === 'FAILED') row.nextAttemptAt = nextAttemptAt;
}

/** Records one more attempt. `nextAttemptAt` applies only to a failure; SENT is final. */
export async function markDeliveryResult(
  id: string,
  result: { ok: true } | { ok: false; error: string },
  nextAttemptAt: Date | null,
): Promise<void> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    await prisma.notificationDelivery.update({
      where: { id },
      data: {
        status: result.ok ? 'SENT' : 'FAILED',
        lastError: result.ok ? null : result.error,
        nextAttemptAt: result.ok ? null : nextAttemptAt,
        attempts: { increment: 1 },
      },
    });
    return;
  }
  const row = memoryDeliveries.find((d) => d.id === id);
  if (!row) return;
  row.attempts += 1;
  row.status = result.ok ? 'SENT' : 'FAILED';
  row.lastError = result.ok ? undefined : result.error;
  row.nextAttemptAt = result.ok ? null : nextAttemptAt;
}

/** Test-only helpers, mirroring clearMemoryOrders / clearMemoryPayments. */
export function getMemoryDeliveries(): readonly DeliveryRecord[] {
  return memoryDeliveries;
}

export function clearMemoryDeliveries(): void {
  memoryDeliveries.length = 0;
}
