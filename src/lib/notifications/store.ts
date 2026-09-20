import { hasDatabase } from '@/lib/env';
import type { OrderEventPayload } from './events';

/**
 * Delivery outbox: one row per (event, channel) attempt that was actually
 * made. Mirrors the db/memory split of the order and payment stores. Only
 * short codes and the redacted payload are ever written here.
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
}

const memoryDeliveries: DeliveryRecord[] = [];

export async function recordDelivery(input: Omit<DeliveryRecord, 'id' | 'attempts'>): Promise<void> {
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
      },
    });
    return;
  }
  memoryDeliveries.push({ ...input, id: crypto.randomUUID(), attempts: 1 });
}

export async function listFailedDeliveries(limit = 50): Promise<DeliveryRecord[]> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const rows = await prisma.notificationDelivery.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'asc' },
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
    }));
  }
  return memoryDeliveries.filter((d) => d.status === 'FAILED').slice(0, limit);
}

export async function markDeliveryResult(
  id: string,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    await prisma.notificationDelivery.update({
      where: { id },
      data: {
        status: result.ok ? 'SENT' : 'FAILED',
        lastError: result.ok ? null : result.error,
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
}

/** Test-only helpers, mirroring clearMemoryOrders / clearMemoryPayments. */
export function getMemoryDeliveries(): readonly DeliveryRecord[] {
  return memoryDeliveries;
}

export function clearMemoryDeliveries(): void {
  memoryDeliveries.length = 0;
}
