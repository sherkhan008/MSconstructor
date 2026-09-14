import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProductionConfig, type ProductionConfigInput } from '@/lib/startup/production-config';

/**
 * Production startup configuration (src/lib/startup/production-config.ts):
 * security-critical problems are `errors` (the server refuses to start),
 * everything else is a `warning`. Messages never contain the values.
 */

const VALID: ProductionConfigInput = {
  DATABASE_URL: 'postgresql://ms_shelving:0123456789abcdef@postgres:5432/ms_shelving?schema=public',
  AUTH_SECRET: 'q3Xv1mZ8pL2sT9wK4yB7nC6dF0gH5jR2uE8iO1aS3zQ=',
  APP_URL: 'https://ms-stellazh.kz',
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-real-ip',
  REDIS_URL: 'redis://:0123456789abcdef@redis:6379/0',
  NEXT_PUBLIC_WHATSAPP_NUMBER: '77071234567',
};

const check = (overrides: Partial<ProductionConfigInput>) => checkProductionConfig({ ...VALID, ...overrides });

describe('checkProductionConfig', () => {
  it('accepts a complete, safe configuration with no errors or warnings', () => {
    expect(checkProductionConfig(VALID)).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: undefined }, /DATABASE_URL is required/],
    ['non-postgres DATABASE_URL', { DATABASE_URL: 'mysql://a:b@c/d' }, /postgresql:\/\//],
    ['example DATABASE_URL', { DATABASE_URL: 'postgresql://user:password@host:5432/ms_shelving' }, /placeholder/],
    ['AUTH_SECRET', { AUTH_SECRET: undefined }, /AUTH_SECRET is required/],
    ['short AUTH_SECRET', { AUTH_SECRET: 'too-short-secret' }, /at least 32/],
    ['old compose default AUTH_SECRET', { AUTH_SECRET: 'change-me-in-production' }, /placeholder/],
    ['.env.example AUTH_SECRET', { AUTH_SECRET: 'replace-with-a-random-32-byte-string' }, /placeholder/],
    ['.env.production.example AUTH_SECRET', { AUTH_SECRET: 'CHANGE_ME' }, /./],
    ['APP_URL', { APP_URL: undefined }, /APP_URL is required/],
    ['relative APP_URL', { APP_URL: 'ms-stellazh.kz' }, /absolute http/],
    ['placeholder APP_URL', { APP_URL: 'https://your-domain.kz' }, /placeholder/],
    ['TRUSTED_PROXY_CLIENT_IP_HEADER', { TRUSTED_PROXY_CLIENT_IP_HEADER: undefined }, /TRUSTED_PROXY_CLIENT_IP_HEADER is required/],
    ['invalid header name', { TRUSTED_PROXY_CLIENT_IP_HEADER: 'x real ip!' }, /not a valid HTTP header name/],
    ['invalid REDIS_URL', { REDIS_URL: 'http://redis:6379' }, /REDIS_URL/],
  ])('refuses to start without a safe %s', (_label, overrides, message) => {
    const { errors } = check(overrides);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(message);
  });

  it('treats any schema-invalid variable (e.g. an empty assignment) as fatal, naming only the variable', () => {
    const { errors } = check({ invalidVariables: ['SMTP_PASSWORD', 'SELLER_BIN'] });
    expect(errors.join('\n')).toMatch(/Invalid environment variables: SMTP_PASSWORD, SELLER_BIN/);
  });

  it('warns (without blocking) about non-critical gaps', () => {
    const { errors, warnings } = check({
      APP_URL: 'http://localhost:8080',
      REDIS_URL: undefined,
      ADMIN_INITIAL_PASSWORD: 'Str0ng-and-long-enough',
      NEXT_PUBLIC_WHATSAPP_NUMBER: undefined,
    });
    expect(errors).toEqual([]);
    expect(warnings.join('\n')).toMatch(/not https/);
    expect(warnings.join('\n')).toMatch(/REDIS_URL is not set/);
    expect(warnings.join('\n')).toMatch(/ADMIN_INITIAL_PASSWORD/);
    expect(warnings.join('\n')).toMatch(/NEXT_PUBLIC_WHATSAPP_NUMBER/);
  });

  it('never echoes a secret value in any message', () => {
    const secret = 'super-secret-value-that-is-long-enough-000';
    const report = checkProductionConfig({
      DATABASE_URL: `mysql://admin:${secret}@db/x`,
      AUTH_SECRET: 'short',
      APP_URL: `not a url ${secret}`,
      REDIS_URL: `http://:${secret}@redis`,
      ADMIN_INITIAL_PASSWORD: secret,
    });
    expect([...report.errors, ...report.warnings].join('\n')).not.toContain(secret);
    expect([...report.errors, ...report.warnings].join('\n')).not.toContain('short');
  });
});

describe('src/lib/env.ts with an invalid variable', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in ORIGINAL_ENV)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps a production process in production mode instead of silently downgrading to development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_PASSWORD', '');
    delete process.env.NEXT_PHASE;
    vi.resetModules();
    const envModule = await import('@/lib/env');
    expect(envModule.isProduction).toBe(true);
    expect(envModule.isProductionRuntime).toBe(true);
    expect(envModule.invalidEnvVariables).toContain('SMTP_PASSWORD');

    const { clientIpPolicy } = await import('@/lib/security/client-ip');
    expect(clientIpPolicy.mode).toBe('untrusted');
  });

  it('reports no invalid variables for a valid environment', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();
    const envModule = await import('@/lib/env');
    expect(envModule.invalidEnvVariables).toEqual([]);
  });
});

describe('runProductionPreflight', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in ORIGINAL_ENV)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('exits the process with code 1 in production runtime when AUTH_SECRET is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.NEXT_PHASE;
    delete process.env.AUTH_SECRET;
    vi.resetModules();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runProductionPreflight } = await import('@/lib/startup/preflight');
    runProductionPreflight();
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(/AUTH_SECRET is required/);
  });

  it('does nothing outside production runtime (local dev, tests, Playwright server)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { runProductionPreflight } = await import('@/lib/startup/preflight');
    runProductionPreflight();
    expect(exit).not.toHaveBeenCalled();
  });

  it('does nothing during `next build` (NEXT_PHASE=phase-production-build)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    delete process.env.AUTH_SECRET;
    vi.resetModules();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { runProductionPreflight } = await import('@/lib/startup/preflight');
    runProductionPreflight();
    expect(exit).not.toHaveBeenCalled();
  });
});
