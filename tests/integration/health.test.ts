import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Migration directories bundled with this checkout — what the image ships. */
const BUNDLED_MIGRATIONS = readdirSync(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };

/** A Prisma `$queryRaw` stand-in that answers the ping and the two schema-status queries. */
function fakeQueryRaw(options: { migrationsTable?: boolean; rows?: MigrationRow[] } = {}) {
  const rows = options.rows ?? BUNDLED_MIGRATIONS.map((name) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null }));
  return vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('to_regclass')) return [{ exists: options.migrationsTable ?? true }];
    if (sql.includes('_prisma_migrations')) return rows;
    return [{ '?column?': 1 }];
  });
}

async function importHealthWithDatabase(queryRaw: ReturnType<typeof fakeQueryRaw>) {
  vi.stubEnv('NODE_ENV', 'production');
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  delete process.env.NEXT_PHASE;
  vi.resetModules();
  vi.doMock('@/lib/db/client', () => ({ prisma: { $queryRaw: queryRaw } }));
  return import('@/app/api/health/route');
}

const ORIGINAL_ENV = { ...process.env };
function resetProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  resetProcessEnv();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('@/lib/db/client');
});

describe('GET /api/health', () => {
  it('reports healthy with the documented mock-mode label when no database is configured (dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.database).toBe('in-memory-sample-catalog');
  });

  it('reports unhealthy (non-2xx) in production with no DATABASE_URL configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.ok).toBe(false);
  });

  it('reports healthy when postgres is reachable and every bundled migration is applied', async () => {
    const { GET } = await importHealthWithDatabase(fakeQueryRaw());
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.database).toBe('postgres');
    expect(json.schema).toBe('ok');
  });

  it('stays healthy when the database has newer migrations than this build (application-only rollback)', async () => {
    const rows = [
      ...BUNDLED_MIGRATIONS.map((name) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null })),
      { migration_name: '29990101000000_from_a_newer_release', finished_at: new Date(), rolled_back_at: null },
    ];
    const { GET } = await importHealthWithDatabase(fakeQueryRaw({ rows }));
    expect((await GET()).status).toBe(200);
  });

  it('reports unhealthy when a bundled migration has not been applied, without naming it', async () => {
    const rows = BUNDLED_MIGRATIONS.slice(0, -1).map((name) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null }));
    const { GET } = await importHealthWithDatabase(fakeQueryRaw({ rows }));
    const response = await GET();
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json).toMatchObject({ ok: false, database: 'postgres', schema: 'pending' });
    expect(JSON.stringify(json)).not.toContain(BUNDLED_MIGRATIONS.at(-1)!);
  });

  it('reports unhealthy against an empty database (no _prisma_migrations table)', async () => {
    const { GET } = await importHealthWithDatabase(fakeQueryRaw({ migrationsTable: false }));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).schema).toBe('pending');
  });

  it('reports unhealthy while a migration is failed / half-applied', async () => {
    const rows = BUNDLED_MIGRATIONS.map((name, index) => ({
      migration_name: name,
      finished_at: index === BUNDLED_MIGRATIONS.length - 1 ? null : new Date(),
      rolled_back_at: null,
    }));
    const { GET } = await importHealthWithDatabase(fakeQueryRaw({ rows }));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).schema).toBe('failed');
  });

  it('reports unhealthy (non-2xx) when postgres is configured but unreachable, without leaking the driver error', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://secret-user:secret-pass@localhost:5432/db';
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    vi.doMock('@/lib/db/client', () => ({
      prisma: {
        $queryRaw: vi.fn(async () => {
          throw new Error('connect ECONNREFUSED secret-user:secret-pass@localhost:5432');
        }),
      },
    }));
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.ok).toBe(false);
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('secret-pass');
    expect(serialized).not.toContain('ECONNREFUSED');
  });
});
