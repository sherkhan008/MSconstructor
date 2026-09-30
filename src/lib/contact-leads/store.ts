import { assertDatabaseConfigured, hasDatabase } from '@/lib/env';
import type { Locale } from '@/lib/i18n/locales';
import { pendingDeliveryData, recordPendingDeliveriesInMemory, type PendingDeliveryRow } from '@/lib/notifications/store';

/**
 * Contact-form lead persistence. Mirrors src/lib/orders/store.ts's db/memory
 * split: without DATABASE_URL (local development only) leads live in memory
 * for the lifetime of the process; in production runtime a missing database
 * throws instead (assertDatabaseConfigured), so a lead is never kept in RAM.
 *
 * A stored lead is the contact form's success condition. Its PENDING
 * notification outbox rows are written in the SAME transaction as the lead
 * (`options.outbox`), so a stored lead always has its manager notification
 * event; delivery happens after commit and never affects the lead
 * (src/app/api/contact/route.ts).
 */

export interface ContactLeadRecord {
  id: string;
  name: string;
  /** Normalised "+7XXXXXXXXXX" (the contact schema's phone transform). */
  phone: string;
  message: string;
  locale: Locale;
  createdAt: Date;
}

export type NewContactLead = Pick<ContactLeadRecord, 'name' | 'phone' | 'message' | 'locale'>;

/**
 * The same name + phone + message sent again within this window is the same
 * request (a double click, a resubmitted page, a retry after a slow network):
 * it is answered as stored without creating a second lead or a second
 * manager alert.
 */
export const CONTACT_LEAD_DUPLICATE_WINDOW_MS = 10 * 60_000;

export interface SaveContactLeadResult {
  lead: ContactLeadRecord;
  /** True when an identical recent lead already existed; nothing was written. */
  duplicate: boolean;
}

const memoryLeads: ContactLeadRecord[] = [];

function toRecord(row: { id: string; name: string; phone: string; message: string; locale: string; createdAt: Date }): ContactLeadRecord {
  return { ...row, locale: row.locale === 'kk' ? 'kk' : 'ru' };
}

export interface SaveContactLeadOptions {
  /** The new lead's outbox rows (src/lib/notifications/service.ts
   * createOutbox). Called only when a NEW lead is written — never for a
   * duplicate, which therefore gets no second notification. */
  outbox?: (lead: ContactLeadRecord) => PendingDeliveryRow[];
}

export async function saveContactLead(
  input: NewContactLead,
  now: Date = new Date(),
  options: SaveContactLeadOptions = {},
): Promise<SaveContactLeadResult> {
  assertDatabaseConfigured('contact lead');
  const since = new Date(now.getTime() - CONTACT_LEAD_DUPLICATE_WINDOW_MS);

  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    return prisma.$transaction(async (tx) => {
      // Serialises submissions from one phone number, so two identical
      // requests arriving together cannot both pass the duplicate check below.
      // Transaction-scoped: released on commit or rollback, never held.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contact-lead:${input.phone}`}))`;
      const existing = await tx.contactLead.findFirst({
        where: { phone: input.phone, name: input.name, message: input.message, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { lead: toRecord(existing), duplicate: true };
      const created = await tx.contactLead.create({
        data: { name: input.name, phone: input.phone, message: input.message, locale: input.locale, createdAt: now },
      });
      const lead = toRecord(created);
      const outbox = options.outbox?.(lead) ?? [];
      if (outbox.length > 0) await tx.notificationDelivery.createMany({ data: pendingDeliveryData(outbox) });
      return { lead, duplicate: false };
    });
  }

  const existing = memoryLeads.find(
    (lead) =>
      lead.phone === input.phone && lead.name === input.name && lead.message === input.message && lead.createdAt >= since,
  );
  if (existing) return { lead: { ...existing }, duplicate: true };
  const lead: ContactLeadRecord = { ...input, id: crypto.randomUUID(), createdAt: now };
  memoryLeads.push(lead);
  recordPendingDeliveriesInMemory(options.outbox?.({ ...lead }) ?? []);
  return { lead: { ...lead }, duplicate: false };
}

/** The stored lead, read by notification channels at send time. */
export async function getContactLeadById(id: string): Promise<ContactLeadRecord | undefined> {
  assertDatabaseConfigured('contact lead');
  if (hasDatabase) {
    const { prisma } = await import('@/lib/db/client');
    const row = await prisma.contactLead.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }
  const lead = memoryLeads.find((l) => l.id === id);
  return lead ? { ...lead } : undefined;
}

/** Test-only helpers, mirroring clearMemoryOrders / clearMemoryDeliveries. */
export function getMemoryContactLeads(): readonly ContactLeadRecord[] {
  return memoryLeads;
}

export function clearMemoryContactLeads(): void {
  memoryLeads.length = 0;
}
