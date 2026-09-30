import type { Prisma } from '@prisma/client';
import { hasDatabase } from '@/lib/env';
import type { NotificationEventPayload, NotificationSubject } from './events';

/**
 * Delivery outbox: one row per (event, channel) delivery. Mirrors the db/memory
 * split of the order and payment stores. Only short codes and the redacted
 * payload are ever written here.
 *
 * Lifecycle (./service.ts):
 *  - PENDING is written BEFORE the send, with `nextAttemptAt` as a lease. For
 *    a new order or contact lead it is written in the SAME database
 *    transaction as the record itself, so a committed order/lead always has
 *    its notification rows. If the process dies before or during the send,
 *    the row becomes due when the lease runs out and the notifications worker
 *    sends it — the alert is not lost.
 *  - the send's outcome turns it into SENT (final, never listed again) or
 *    FAILED. A FAILED row with a `nextAttemptAt` is due for an automatic retry
 *    at that time (./retry-policy.ts); a FAILED row without one is final.
 *
 * Every row has exactly one subject: `orderNumber` (order events) or
 * `contactLeadId` (contact.created).
 */

export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

/** Rows the worker may pick up once `nextAttemptAt` is due. */
const RETRYABLE_STATUSES: DeliveryStatus[] = ['PENDING', 'FAILED'];

export interface DeliveryRecord {
  id: string;
  event: string;
  channel: string;
  status: DeliveryStatus;
  orderNumber?: string;
  contactLeadId?: string;
  payload: NotificationEventPayload;
  attempts: number;
  lastError?: string;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

const memoryDeliveries: DeliveryRecord[] = [];

function subjectColumns(subject: NotificationSubject): { orderNumber?: string; contactLeadId?: string } {
  return 'orderNumber' in subject ? { orderNumber: subject.orderNumber } : { contactLeadId: subject.contactLeadId };
}

function matchesSubject(record: DeliveryRecord, subject: NotificationSubject): boolean {
  return 'orderNumber' in subject
    ? record.orderNumber === subject.orderNumber
    : record.contactLeadId === subject.contactLeadId;
}

/**
 * A delivery about to be attempted: PENDING, zero attempts, leased until
 * `leaseUntil`. The id is chosen up front so a business transaction can write
 * the row and the caller can still address it after commit.
 */
export interface PendingDeliveryRow {
  id: string;
  event: string;
  channel: string;
  subject: NotificationSubject;
  payload: NotificationEventPayload;
  leaseUntil: Date;
  createdAt: Date;
}

/** Prisma data for PENDING rows — written by the order / contact-lead stores
 * INSIDE their own transaction, so a committed record always has its outbox. */
export function pendingDeliveryData(rows: readonly PendingDeliveryRow[]): Prisma.NotificationDeliveryCreateManyInput[] {
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    channel: row.channel,
    status: 'PENDING',
    ...subjectColumns(row.subject),
    payload: row.payload as unknown as Prisma.InputJsonValue,
    attempts: 0,
    nextAttemptAt: row.leaseUntil,
    createdAt: row.createdAt,
  }));
}

/** The memory-store (no DATABASE_URL, development only) counterpart of
 * writing pendingDeliveryData in a transaction: synchronous, so it lands in the
 * same tick as the in-memory business record. */
export function recordPendingDeliveriesInMemory(rows: readonly PendingDeliveryRow[]): void {
  for (const row of rows) {
    memoryDeliveries.push({
      id: row.id,
      event: row.event,
      channel: row.channel,
      status: 'PENDING',
      ...subjectColumns(row.subject),
      payload: row.payload,
      attempts: 0,
      nextAttemptAt: row.leaseUntil,
      createdAt: row.createdAt,
    });
  }
}

/** Writes PENDING rows on their own (events with no business write of their
 * own to join, e.g. order.status_changed emitted after the admin update). */
export async function insertPendingDeliveries(rows: readonly PendingDeliveryRow[]): Promise<void> {
  if (rows.length === 0) return;
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    await prisma.notificationDelivery.createMany({ data: pendingDeliveryData(rows) });
    return;
  }
  recordPendingDeliveriesInMemory(rows);
}

/** One PENDING row on its own; returns its id. */
export async function createPendingDelivery(input: Omit<PendingDeliveryRow, 'id' | 'createdAt'> & { createdAt?: Date }): Promise<string> {
  const id = crypto.randomUUID();
  await insertPendingDeliveries([{ ...input, id, createdAt: input.createdAt ?? new Date() }]);
  return id;
}

/** Whether this (event, channel, subject) was already delivered — the
 * idempotency check behind NotificationChannel.oncePerSubject. */
export async function hasSentDelivery(event: string, channel: string, subject: NotificationSubject): Promise<boolean> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const row = await prisma.notificationDelivery.findFirst({
      where: { event, channel, status: 'SENT', ...subjectColumns(subject) },
      select: { id: true },
    });
    return row !== null;
  }
  return memoryDeliveries.some(
    (d) => d.event === event && d.channel === channel && d.status === 'SENT' && matchesSubject(d, subject),
  );
}

/** PENDING (lease expired) and FAILED rows whose next attempt is due, soonest first. */
export async function listDueDeliveries(now: Date, limit = 50): Promise<DeliveryRecord[]> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const rows = await prisma.notificationDelivery.findMany({
      where: { status: { in: RETRYABLE_STATUSES }, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      channel: r.channel,
      status: r.status as DeliveryStatus,
      ...(r.orderNumber !== null ? { orderNumber: r.orderNumber } : {}),
      ...(r.contactLeadId !== null ? { contactLeadId: r.contactLeadId } : {}),
      payload: r.payload as unknown as NotificationEventPayload,
      attempts: r.attempts,
      lastError: r.lastError ?? undefined,
      nextAttemptAt: r.nextAttemptAt,
      createdAt: r.createdAt,
    }));
  }
  // Snapshots, like the rows a database query returns: claimDelivery must
  // compare against the schedule as it was listed, not the live row.
  return memoryDeliveries
    .filter((d) => RETRYABLE_STATUSES.includes(d.status) && d.nextAttemptAt !== null && d.nextAttemptAt <= now)
    .sort((a, b) => a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime())
    .slice(0, limit)
    .map((d) => ({ ...d }));
}

/**
 * Takes a due row for one retry: moves its `nextAttemptAt` to `leaseUntil`
 * only if it is still PENDING/FAILED and still scheduled exactly as listed.
 * Returns false when another worker already took it (or it was sent meanwhile).
 */
export async function claimDelivery(id: string, listedNextAttemptAt: Date, leaseUntil: Date): Promise<boolean> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const { count } = await prisma.notificationDelivery.updateMany({
      where: { id, status: { in: RETRYABLE_STATUSES }, nextAttemptAt: listedNextAttemptAt },
      data: { nextAttemptAt: leaseUntil },
    });
    return count === 1;
  }
  const row = memoryDeliveries.find((d) => d.id === id);
  if (!row || !RETRYABLE_STATUSES.includes(row.status) || row.nextAttemptAt?.getTime() !== listedNextAttemptAt.getTime()) {
    return false;
  }
  row.nextAttemptAt = leaseUntil;
  return true;
}

/**
 * Changes when (or, with null, whether) a PENDING/FAILED row is retried,
 * without counting an attempt. A PENDING row that is closed without a send
 * (null) becomes FAILED with `finalError`, so it is never left looking in flight.
 */
export async function rescheduleDelivery(id: string, nextAttemptAt: Date | null, finalError = 'NOT_SENT'): Promise<void> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    await prisma.notificationDelivery.updateMany({ where: { id, status: 'FAILED' }, data: { nextAttemptAt } });
    await prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: nextAttemptAt ? { nextAttemptAt } : { status: 'FAILED', lastError: finalError, nextAttemptAt: null },
    });
    return;
  }
  const row = memoryDeliveries.find((d) => d.id === id);
  if (!row || !RETRYABLE_STATUSES.includes(row.status)) return;
  row.nextAttemptAt = nextAttemptAt;
  if (row.status === 'PENDING' && !nextAttemptAt) {
    row.status = 'FAILED';
    row.lastError = finalError;
  }
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
