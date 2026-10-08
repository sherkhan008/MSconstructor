import { createHash } from 'node:crypto';

/**
 * Simulated client identities for e2e requests — the single place that
 * decides which client IP a test presents to the server.
 *
 * The test server runs under the production trust model:
 * playwright.config.ts starts it with TRUSTED_PROXY_CLIENT_IP_HEADER=x-real-ip,
 * so src/lib/security/client-ip.ts reads exactly X-Real-IP, as it does
 * behind deploy/nginx/app-proxy.conf. In production nginx OVERWRITES both
 * X-Real-IP and X-Forwarded-For with the TCP peer address, so nothing a
 * visitor sends survives; here the test plays the part of that proxy and
 * writes both headers with one address of its own. (Both, so a server
 * reached through E2E_BASE_URL in development-forwarded-for mode isolates
 * tests the same way.)
 *
 * Addresses are IPv6 unique-local (fd00::/8 — never a real visitor), one
 * /64 per identity, because the rate limiter keys IPv6 clients by /64.
 * Each address is a hash of E2E_RUN_ID (one random value per `playwright
 * test` invocation, set in playwright.config.ts) plus the caller's parts:
 * every identity is distinct within a run, and no run can ever land in a
 * bucket a previous run filled — even when the server keeps its counters
 * across runs in a shared Redis.
 */

/** Set by playwright.config.ts in the runner and inherited by every worker. */
function runId(): string {
  const id = process.env.E2E_RUN_ID;
  if (!id) throw new Error('E2E_RUN_ID is not set — run e2e tests through playwright.config.ts.');
  return id;
}

/** One deterministic-per-run client IP for `parts`. */
export function e2eClientIp(...parts: (string | number)[]): string {
  const hex = createHash('sha256').update([runId(), ...parts].join('\u0000')).digest('hex');
  // fd + 56 hash bits = the /64 prefix the limiter keys on.
  const prefix = `fd${hex.slice(0, 14)}`;
  return `${prefix.slice(0, 4)}:${prefix.slice(4, 8)}:${prefix.slice(8, 12)}:${prefix.slice(12, 16)}::1`;
}

/** The headers the trusted reverse proxy would write for `ip`. */
export function trustedProxyHeaders(ip: string): Record<string, string> {
  return { 'x-real-ip': ip, 'x-forwarded-for': ip };
}
