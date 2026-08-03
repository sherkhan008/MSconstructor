import { PrismaClient } from '@prisma/client';

/**
 * Standard Next.js Prisma singleton: reuses one client across hot reloads in
 * development so each edit doesn't open a fresh pool of database connections.
 * Only imported when hasDatabase is true — see src/lib/data/repository.ts.
 */

declare global {
   
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
