import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { SELLER_BANKING_SENTINELS } from './tests/fixtures/seller-banking-sentinels';

/**
 * Next.js loads `.env` itself, so the app under test already sees
 * DATABASE_URL/ADMIN_EMAIL — but the Playwright process does not, and the
 * admin specs read those to decide whether they can run at all (and, for
 * /admin/prices, to create and delete their own isolated catalog fixtures).
 * Loading the same file here is what keeps the runner and the server looking
 * at one environment instead of two. Missing `.env` is not an error: the
 * public-site specs need nothing from it and the admin ones skip cleanly.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env — admin specs will skip, everything else runs unchanged.
}

/**
 * One id per `playwright test` invocation. Evaluated first in the runner,
 * whose environment every worker inherits, so all workers share it; it
 * namespaces the simulated client IPs (tests/e2e/helpers/client-identity.ts)
 * so no run can inherit rate-limit counters from an earlier one.
 */
process.env.E2E_RUN_ID ??= randomUUID();

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    locale: 'ru-RU',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: baseURL,
        // Always a server started with the env below. A reused one (e.g. a
        // `next dev` left running) would have its own trust mode, banking
        // values and rate-limit counters, and the same commit could pass or
        // fail depending on it. A busy port fails loudly instead; to test an
        // already running server on purpose, set E2E_BASE_URL.
        reuseExistingServer: false,
        timeout: 180_000,
        // These tests run the real production build against no database —
        // NODE_ENV=development keeps src/lib/env.ts's production-requires-
        // DATABASE_URL guard (see docs/production-database.md) from firing,
        // so the app serves from the in-memory sample catalog exactly like
        // local dev, without weakening that guard for an actual deployment
        // (which sets NODE_ENV=production itself and never touches this file).
        // The seller's banking variables are synthetic sentinels, so
        // tests/e2e/public-legal-identity.spec.ts always has known banking
        // values to prove absent from every public page and bundle.
        //
        // TRUSTED_PROXY_CLIENT_IP_HEADER puts the server under the production
        // client-IP trust model (the header deploy/nginx/app-proxy.conf
        // overwrites), stated here so it never depends on whether a
        // developer's .env sets it: explicit values win over .env for both
        // Playwright and Next.js. The tests then act as that proxy — see
        // tests/e2e/helpers/client-identity.ts.
        env: {
          NODE_ENV: 'development',
          TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-real-ip',
          ...SELLER_BANKING_SENTINELS,
        },
      },
});
