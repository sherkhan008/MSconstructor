import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards tests/setup/test-environment.ts: the suite must behave the same
 * whether or not the developer has a local `.env`. On a machine with one,
 * these fail if Prisma ever starts injecting it again; in a clean checkout
 * they hold trivially, which is exactly the behaviour being pinned.
 */

describe('Vitest test environment', () => {
  it('neither requiring Prisma nor constructing a client adds variables to process.env', async () => {
    const before = new Set(Object.keys(process.env));
    const { PrismaClient } = await import('@prisma/client');
    const client = new PrismaClient();
    await client.$disconnect();
    expect(Object.keys(process.env).filter((name) => !before.has(name))).toEqual([]);
  });

  it('a variable a test deletes stays deleted after a new PrismaClient is built', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const client = new PrismaClient();
      await client.$disconnect();
      expect(process.env.DATABASE_URL).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it('deployment-only trust/storage switches are never inherited', () => {
    expect(process.env.TRUSTED_PROXY_CLIENT_IP_HEADER).toBeUndefined();
    expect(process.env.REDIS_URL).toBeUndefined();
  });

  it('the client-IP resolver runs in the documented test mode', async () => {
    const { clientIpPolicy } = await import('@/lib/security/client-ip');
    expect(clientIpPolicy).toEqual({ mode: 'development-forwarded-for', productionRuntime: false });
  });

  it('only the project-root .env is hidden; every other path resolves normally', () => {
    const root = path.resolve(__dirname, '..', '..');
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.env.example'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
  });
});
