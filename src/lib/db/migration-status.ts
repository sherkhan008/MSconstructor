import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

/**
 * Is the connected database's schema compatible with this build?
 *
 * The image ships its migration history in prisma/migrations (Dockerfile
 * copies it next to server.js). The build is compatible when every one of
 * those migrations is recorded as finished in `_prisma_migrations`, and no
 * migration is stuck half-applied. Extra migrations in the database that
 * this build does not know are allowed: that is exactly the state after an
 * application-only rollback to an older image (see docs/production-deployment.md).
 *
 * Migrations are applied only by `prisma migrate deploy` in the separate
 * `migrate` service — never by the application.
 */

export type SchemaStatus = 'ok' | 'pending' | 'failed' | 'unverified';

export interface AppliedMigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export function evaluateSchemaStatus(expected: readonly string[], rows: readonly AppliedMigrationRow[]): SchemaStatus {
  // Started but never finished and not marked rolled back = a failed
  // migration. `prisma migrate deploy` refuses to continue until it is resolved.
  if (rows.some((row) => row.finished_at === null && row.rolled_back_at === null)) return 'failed';
  const applied = new Set(rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null).map((row) => row.migration_name));
  return expected.every((name) => applied.has(name)) ? 'ok' : 'pending';
}

export const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

let expectedMigrationsCache: string[] | null = null;

/** Migration directory names bundled with this build (each holds a migration.sql). */
export async function listExpectedMigrations(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  if (dir === MIGRATIONS_DIR && expectedMigrationsCache) return expectedMigrationsCache;
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await stat(path.join(dir, entry.name, 'migration.sql'));
      names.push(entry.name);
    } catch {
      // Not a migration directory.
    }
  }
  names.sort();
  if (dir === MIGRATIONS_DIR) expectedMigrationsCache = names;
  return names;
}

/**
 * `unverified` when the bundled migrations cannot be read (a broken image) —
 * treated as unhealthy by /api/health, fail closed. A failing database query
 * rejects, exactly like the connectivity ping.
 */
export async function getSchemaStatus(prisma: Pick<PrismaClient, '$queryRaw'>): Promise<SchemaStatus> {
  let expected: string[];
  try {
    expected = await listExpectedMigrations();
  } catch {
    return 'unverified';
  }
  if (expected.length === 0) return 'unverified';

  const [table] = await prisma.$queryRaw<{ exists: boolean }[]>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"`;
  if (!table?.exists) return 'pending';

  const rows = await prisma.$queryRaw<AppliedMigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  return evaluateSchemaStatus(expected, rows);
}
