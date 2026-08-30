import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('reports healthy when postgres is reachable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    vi.doMock('@/lib/db/client', () => ({ prisma: { $queryRaw: vi.fn(async () => [{ '?column?': 1 }]) } }));
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.database).toBe('postgres');
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
