import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { SELLER_E2E_ENV, SELLER_ENV_NAMES } from './tests/fixtures/seller-e2e-sentinels';

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

// Seller state is always the synthetic fixture below, never a developer's
// legal or banking data inherited through the local `.env`.
for (const name of SELLER_ENV_NAMES) delete process.env[name];

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
  // No retries anywhere: a test that only passes on a second attempt is a
  // failure to investigate, not a pass.
  retries: 0,
  // Locally Playwright's default (half the logical CPUs). In CI a fixed 2 on
  // GitHub's 4-vCPU ubuntu runner — the same one-worker-per-two-CPUs ratio,
  // leaving the rest for the `next start` server, and fixed so the run does
  // not depend on what the runner reports.
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // With no retries, CI keeps the trace of every failed test for the
    // uploaded report; locally traces stay opt-in (--retries=1).
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
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
        // These tests serve the real production build. Runtime launch values
        // that are not secrets are explicit synthetic E2E inputs; database
        // and auth credentials still come from the caller (the disposable CI
        // service or the developer's test environment).
        // Seller identity and banking are explicit synthetic sentinels. This
        // keeps document readiness independent of a developer's .env, gives
        // invoice scenarios their required beneficiary fields, and lets the
        // public-identity spec prove banking values stay out of public output.
        //
        // TRUSTED_PROXY_CLIENT_IP_HEADER puts the server under the production
        // client-IP trust model (the header deploy/nginx/app-proxy.conf
        // overwrites), stated here so it never depends on whether a
        // developer's .env sets it: explicit values win over .env for both
        // Playwright and Next.js. The tests then act as that proxy — see
        // tests/e2e/helpers/client-identity.ts.
        env: {
          NODE_ENV: 'production',
          APP_URL: baseURL,
          CATALOG_PRICING_APPROVAL: 'e2e-synthetic-catalog-v1',
          TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-real-ip',
          ...SELLER_E2E_ENV,
        },
      },
});
