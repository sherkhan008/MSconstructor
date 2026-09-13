import type { Page, TestInfo } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';

/**
 * Isolated identity + cleanup for E2E specs that drive the real checkout
 * flow (checkout.spec.ts, configurator-sections.spec.ts).
 *
 * Why this exists: those specs used to submit the same hardcoded customer
 * (phone +77001234567, email test@example.com) from every test, in every
 * file, on both the desktop and mobile Playwright projects. Two problems
 * followed. First, every one of those requests hit POST /api/orders from the
 * same untagged client, so they all landed in the *same* production rate
 * limit bucket (orders: 5/min, keyed by the resolved client IP — see
 * src/lib/rate-limit.ts and src/lib/security/client-ip.ts) even though the tests themselves never intended to
 * exercise that limiter; checkout.spec.ts and configurator-sections.spec.ts
 * together submit more than 5 real orders across both projects, so whichever
 * test ran fifth-or-later inside the shared 60s window failed with 429.
 * Second, every successful submission against a real DATABASE_URL wrote a
 * permanent Customer/Order row that nothing ever cleaned up.
 *
 * The fix mirrors admin-order-fixtures.ts: give every test its own
 * deterministic identity (so desktop and mobile, and every test in both
 * files, never share a database row) and its own simulated client IP (so
 * they never share a rate-limit bucket either), then delete exactly the rows
 * a file+project created once its tests are done. The production limiter
 * itself is untouched. The Playwright server runs with NODE_ENV=development
 * and no TRUSTED_PROXY_CLIENT_IP_HEADER, where the client-IP resolver's
 * development-only fallback reads the leftmost x-forwarded-for. That
 * fallback is never selected in production runtime, where only the header
 * the trusted reverse proxy overwrites is read — so this tagging cannot
 * rotate identities against a real deployment.
 *
 * The customer phone range (+7909...) is disjoint from both real Kazakh
 * mobile prefixes and the +7900... range admin-order-fixtures.ts reserves
 * for itself, so the two fixture sets can never collide.
 */

export function checkoutFixturePrefix(scope: string, projectName: string): string {
  return `E2E${scope}${projectName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

function stableHash(input: string, mod: number): number {
  let hash = 0;
  for (const char of input) hash = (hash * 31 + char.charCodeAt(0)) % mod;
  return hash;
}

export interface CheckoutIdentity {
  fullName: string;
  phone: string;
  email: string;
}

/** One deterministic customer per (prefix, test title) — stable across runs,
 * unique across every test in every file/project.
 *
 * The phone must satisfy kzPhoneRegex (src/lib/pricing/schema.ts): "+7"
 * followed by exactly 10 digits, no more, no less — the reserved area code
 * "909" plus a 7-digit seed hits that length exactly. */
export function checkoutIdentity(prefix: string, testInfo: TestInfo): CheckoutIdentity {
  const seed = stableHash(`${prefix}::${testInfo.title}`, 9000);
  return {
    fullName: `${prefix} Тест ${seed}`,
    phone: `+7909${String(seed).padStart(7, '0')}`,
    email: `${prefix.toLowerCase()}-${seed}@e2e.invalid`,
  };
}

/** One deterministic simulated client IP per (prefix, test title), so no two
 * tests anywhere in the suite ever share a rate-limit bucket. */
function simulatedClientIp(prefix: string, testInfo: TestInfo): string {
  const seed = stableHash(`${prefix}::ip::${testInfo.title}`, 255 * 255 * 254);
  const b = 1 + (Math.floor(seed / (255 * 255)) % 254);
  const c = Math.floor(seed / 255) % 255;
  const d = 1 + (seed % 254);
  return `10.${b}.${c}.${d}`;
}

/**
 * Tags every POST /api/orders this page makes with a simulated
 * per-test x-forwarded-for so it lands in its own rate-limit bucket, never
 * one shared with another test, file or project. Optionally delays the
 * request — the seam checkout.spec.ts's duplicate-submit test needs to
 * observe the button's transient disabled state.
 */
export async function isolateOrderRequests(
  page: Page,
  prefix: string,
  testInfo: TestInfo,
  delayMs = 0,
): Promise<void> {
  const ip = simulatedClientIp(prefix, testInfo);
  await page.route('**/api/orders', async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } });
  });
}

/** Deletes exactly the Customer/Order rows a (scope, project) fixture run
 * created — found by the deterministic fullName prefix, never by position or
 * recency. Real customers (no such prefix) are never matched. */
export async function removeCheckoutFixtures(
  prisma: PrismaClient,
  prefix: string,
): Promise<{ orders: number; customers: number }> {
  const customers = await prisma.customer.findMany({
    where: { fullName: { startsWith: prefix } },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length === 0) return { orders: 0, customers: 0 };

  const orders = await prisma.order.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  let ordersDeleted = 0;
  if (orderIds.length > 0) {
    // Audit rows have no FK to Order, so they must go explicitly (mirrors
    // admin-order-fixtures.ts). Checkout-created orders normally have none —
    // audit entries come from admin actions — but this stays safe if that
    // ever changes.
    await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
    const deleted = await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    ordersDeleted = deleted.count;
  }

  const deletedCustomers = await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  return { orders: ordersDeleted, customers: deletedCustomers.count };
}
