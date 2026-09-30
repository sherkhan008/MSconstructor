import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';

/**
 * Admin contact-lead list — Prisma-only (see assertAdminDatabaseConfigured),
 * like src/lib/admin/orders.ts. Read-only: leads are never edited or deleted
 * from here, and nothing deletes them automatically.
 *
 * ADMIN-ONLY: names, phones and messages are personal data. Nothing here may
 * be imported by a customer-facing route or component.
 */

const PAGE_SIZE = 20;

/** State of the manager alert for one lead on one channel, from the outbox. */
export type LeadNotificationState = 'SENT' | 'PENDING' | 'RETRYING' | 'FAILED';

export interface AdminLeadNotification {
  channel: string;
  state: LeadNotificationState;
}

export interface AdminContactLead {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  message: string;
  locale: string;
  /** One entry per channel that attempted the alert; empty = none attempted
   * (every channel disabled or unconfigured when the lead arrived). */
  notifications: AdminLeadNotification[];
}

export interface AdminContactLeadListResult {
  leads: AdminContactLead[];
  total: number;
  page: number;
  totalPages: number;
}

function notificationState(row: { status: string; nextAttemptAt: Date | null }): LeadNotificationState {
  if (row.status === 'SENT') return 'SENT';
  if (row.status === 'PENDING') return 'PENDING';
  return row.nextAttemptAt ? 'RETRYING' : 'FAILED';
}

/** Newest first, 20 per page; notification states come from one extra query for the whole page. */
export async function listContactLeads(params: { page?: number } = {}): Promise<AdminContactLeadListResult> {
  assertAdminDatabaseConfigured();
  const total = await prisma.contactLead.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(params.page ?? 1)), totalPages);

  const rows = await prisma.contactLead.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const deliveries =
    rows.length === 0
      ? []
      : await prisma.notificationDelivery.findMany({
          where: { contactLeadId: { in: rows.map((r) => r.id) } },
          select: { contactLeadId: true, channel: true, status: true, nextAttemptAt: true },
          orderBy: { createdAt: 'asc' },
        });

  const byLead = new Map<string, Map<string, AdminLeadNotification>>();
  for (const delivery of deliveries) {
    if (!delivery.contactLeadId) continue;
    const channels = byLead.get(delivery.contactLeadId) ?? new Map<string, AdminLeadNotification>();
    const previous = channels.get(delivery.channel);
    // A SENT row wins over any later duplicate row for the same channel.
    if (previous?.state !== 'SENT') {
      channels.set(delivery.channel, { channel: delivery.channel, state: notificationState(delivery) });
    }
    byLead.set(delivery.contactLeadId, channels);
  }

  return {
    leads: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      name: row.name,
      phone: row.phone,
      message: row.message,
      locale: row.locale,
      notifications: [...(byLead.get(row.id)?.values() ?? [])],
    })),
    total,
    page,
    totalPages,
  };
}
