import { test as base } from '@playwright/test';
import { e2eClientIp, trustedProxyHeaders } from './client-identity';

/**
 * The shared `test` for every e2e spec: identical to Playwright's own, plus
 * one thing — each test gets its own client IP.
 *
 * Why: the server rate-limits by client identity (src/lib/rate-limit.ts via
 * src/lib/security/client-ip.ts), and pricing allows 60 requests per minute
 * per identity. Every Playwright worker, in both projects, reaches the test
 * server from 127.0.0.1, so without this the WHOLE suite shared a single
 * bucket. A focused run stays far under 60/min and always passes; the full
 * suite goes over it, the server answers 429, and the configurator shows
 * "Слишком много запросов" instead of a total — which is exactly how
 * tests/e2e/ms-standard-matrix.spec.ts's "a real server price is shown at
 * height 1000" failed in full-suite runs only. The same shared bucket sat
 * under the much tighter orders (5/min) and adminLogin (10/min) limiters too.
 *
 * Giving each test its own identity is test-only isolation of exactly the
 * kind the fixtures beside this file already apply to database rows: the
 * limits themselves are untouched and still enforced per test, so a spec
 * that deliberately floods one endpoint would still see its 429.
 *
 * The identity is presented the way production receives it — as the
 * proxy-written X-Real-IP the server is configured to trust (see
 * helpers/client-identity.ts and playwright.config.ts). In production nginx
 * overwrites that header with the real peer address, so a visitor sending
 * it buys nothing against a real deployment.
 */

let testsStarted = 0;

export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, applyHeaders, testInfo) => {
    // The worker index keeps parallel workers apart, the per-worker counter
    // keeps consecutive tests in one worker apart.
    const ip = e2eClientIp('test', testInfo.workerIndex, testsStarted++);
    await applyHeaders({ ...extraHTTPHeaders, ...trustedProxyHeaders(ip) });
  },
});

export { expect } from '@playwright/test';
