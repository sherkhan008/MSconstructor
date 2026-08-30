import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TTL_SECONDS } from '@/lib/auth/session';

const USER = { id: 'user-1', email: 'admin@example.com', name: 'Тест Админ', role: 'SUPER_ADMIN' as const };

// src/lib/env.ts reads process.env once at module import time, so every
// test needs a fresh module graph after stubbing AUTH_SECRET/NODE_ENV,
// rather than relying on an already-imported `env` reacting to a later
// vi.stubEnv call (see tests/integration/production-database.test.ts for
// the same pattern used elsewhere in this project).
async function freshSession() {
  vi.resetModules();
  return import('@/lib/auth/session');
}

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'test-secret-do-not-use-in-production-please');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('admin session tokens', () => {
  it('round-trips a valid token back to the original payload', async () => {
    const { createSessionToken, verifySessionToken } = await freshSession();
    const token = await createSessionToken(USER);
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(USER.id);
    expect(payload?.email).toBe(USER.email);
    expect(payload?.name).toBe(USER.name);
    expect(payload?.role).toBe(USER.role);
  });

  it('rejects a missing token', async () => {
    const { verifySessionToken } = await freshSession();
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken(null)).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const { verifySessionToken } = await freshSession();
    expect(await verifySessionToken('not-a-real-token')).toBeNull();
    expect(await verifySessionToken('only.one.part.too.many')).toBeNull();
  });

  it('rejects a token whose payload was tampered with', async () => {
    const { createSessionToken, verifySessionToken } = await freshSession();
    const token = await createSessionToken(USER);
    const [payloadPart, signaturePart] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ ...USER, sub: 'attacker', role: 'SUPER_ADMIN' })).toString('base64url');
    expect(payloadPart).not.toBe(tamperedPayload);
    const tampered = `${tamperedPayload}.${signaturePart}`;
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const { createSessionToken } = await freshSession();
    const token = await createSessionToken(USER);

    vi.stubEnv('AUTH_SECRET', 'a-completely-different-secret-value');
    const { verifySessionToken } = await freshSession();
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    const { createSessionToken, verifySessionToken } = await freshSession();
    const token = await createSessionToken(USER);
    vi.advanceTimersByTime((SESSION_TTL_SECONDS + 60) * 1000);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('accepts a token just before expiry', async () => {
    vi.useFakeTimers();
    const { createSessionToken, verifySessionToken } = await freshSession();
    const token = await createSessionToken(USER);
    vi.advanceTimersByTime((SESSION_TTL_SECONDS - 60) * 1000);
    expect(await verifySessionToken(token)).not.toBeNull();
  });

  it('sets httpOnly, sameSite=lax cookie options', async () => {
    const { sessionCookieOptions } = await freshSession();
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });

  it('marks the cookie secure in production but not in development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const prod = await freshSession();
    expect(prod.sessionCookieOptions().secure).toBe(true);

    vi.stubEnv('NODE_ENV', 'development');
    const dev = await freshSession();
    expect(dev.sessionCookieOptions().secure).toBe(false);
  });
});
