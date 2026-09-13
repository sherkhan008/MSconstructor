import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { resolveClientIp } from '@/lib/security/client-ip';

/**
 * Thin, consistent wrapper around `prisma.auditLog.create` — every admin
 * mutation logs through here (login, status changes, and later admin
 * actions) instead of constructing the row inline at each call site.
 * Accepts either the top-level client or a `$transaction` callback's `tx`
 * so a status change's audit row can be written atomically with the order
 * update it describes.
 */
export interface AuditLogEntry {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  previousData?: Prisma.InputJsonValue;
  newData?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function recordAuditLog(entry: AuditLogEntry, client: PrismaLike = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousData: entry.previousData,
      newData: entry.newData,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    },
  });
}

/** Client IP/user-agent for audit rows. The IP comes from the same trusted
 * resolver rate limiting uses (src/lib/security/client-ip.ts), so an audit
 * row never records a client-forged forwarding header; when no trusted IP
 * can be established the row records none rather than a spoofable one. */
export function requestMeta(headers: Headers): { ipAddress?: string; userAgent?: string } {
  return { ipAddress: resolveClientIp(headers) ?? undefined, userAgent: headers.get('user-agent') ?? undefined };
}
