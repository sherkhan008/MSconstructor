import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/client';

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

/** Best-effort client IP/user-agent extraction for audit rows — mirrors
 * src/lib/rate-limit.ts's clientKeyFromHeaders, kept separate since audit
 * rows want the raw values, not a single rate-limit key. */
export function requestMeta(headers: Headers): { ipAddress?: string; userAgent?: string } {
  const forwarded = headers.get('x-forwarded-for');
  const ipAddress = forwarded ? forwarded.split(',')[0].trim() : (headers.get('x-real-ip') ?? undefined);
  return { ipAddress, userAgent: headers.get('user-agent') ?? undefined };
}
