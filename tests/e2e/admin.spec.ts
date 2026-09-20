import { test, expect } from './helpers/test';
import type { PrismaClient } from '@prisma/client';
import {
  createOrderFixtures,
  createPrismaClient,
  orderFixturePrefix,
  readOrder,
  removeOrderFixtures,
  sessionCookieFor,
  type OrderFixtures,
} from './helpers/admin-order-fixtures';
import { clickWhenHydrated, waitForHydration } from './helpers/hydration';

/**
 * Full-flow admin coverage. Admin is PostgreSQL-only (no in-memory dev
 * fallback — see docs/production-database.md), so these tests need a real
 * DATABASE_URL with a seeded admin user (ADMIN_EMAIL/ADMIN_INITIAL_PASSWORD,
 * see prisma/seed.ts) to run at all. They skip cleanly wherever that isn't
 * available, and are the real, executable proof of the click-through flow
 * once it is (e.g. CI with docker-compose, or a developer's own machine).
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@ms-stellazh.kz';
const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';

test.skip(!hasDatabase, 'requires a real PostgreSQL DATABASE_URL with a seeded admin — see docs/production-database.md');

test('an unauthenticated visitor is redirected to /admin/login', async ({ page }) => {
  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('logging in with valid credentials reaches /admin/orders, and logging out locks it again', async ({ page }) => {
  await page.goto('/admin/login');
  // LoginForm's inputs are controlled and its submit is JavaScript-only, and
  // both are already present and enabled in the server HTML — see
  // helpers/hydration.ts for why filling or clicking before React attaches is
  // silently lost rather than reported.
  await waitForHydration(page.getByLabel('Email'));
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Пароль').fill(adminPassword);
  await clickWhenHydrated(page.getByRole('button', { name: 'Войти' }));

  await expect(page).toHaveURL(/\/admin\/orders/);
  await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();

  // Already-authenticated visitor bounces off /admin/login back to /admin/orders.
  await page.goto('/admin/login');
  await expect(page).toHaveURL(/\/admin\/orders/);

  // LogoutButton is SSR-rendered enabled with a JavaScript-only onClick.
  await clickWhenHydrated(page.getByRole('button', { name: 'Выйти' }));
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('an invalid password shows an error and does not log in', async ({ page }) => {
  await page.goto('/admin/login');
  await waitForHydration(page.getByLabel('Email'));
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Пароль').fill('definitely-wrong-password');
  await clickWhenHydrated(page.getByRole('button', { name: 'Войти' }));

  await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
});

/**
 * The order-detail walkthrough deliberately does NOT open "the newest order
 * in the table": that row belongs to a real customer, and the desktop and
 * mobile projects would race each other for it. It creates its own order
 * instead (see helpers/admin-order-fixtures.ts) and deletes it afterwards.
 *
 * It also does not sign in through the form — the three tests above already
 * cover that, and the login route is rate-limited on purpose; this one mints
 * a session for its own fixture account through the same signing path the
 * server verifies.
 */
test.describe('order detail', () => {
  let prisma: PrismaClient;
  let fixtures: OrderFixtures;

  test.beforeAll(async ({}, testInfo) => {
    prisma = createPrismaClient();
    fixtures = await createOrderFixtures(
      prisma,
      orderFixturePrefix(`DETAIL${testInfo.project.name}`, testInfo.repeatEachIndex),
    );
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await removeOrderFixtures(prisma, fixtures.prefix);
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.clearCookies();
    await context.addCookies([await sessionCookieFor(fixtures.users.ADMIN, baseURL!)]);
  });

  test('shows customer, configuration, BOM and totals, and a status change is recorded', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);

    await expect(page.getByRole('heading', { name: `Заказ ${fixtures.unassigned.orderNumber}` })).toBeVisible();
    await expect(page.getByText('ФИО / контактное лицо')).toBeVisible();
    await expect(page.getByText(fixtures.unassigned.customerName)).toBeVisible();
    await expect(page.getByTestId('order-grand-total')).toBeVisible();
    // The internal BOM — component-level detail a customer never sees.
    await expect(page.getByText('MS-SHELF-1000-500')).toBeVisible();

    // A NEW order offers exactly two steps: confirm it, or cancel it. There
    // is no control for jumping straight to PAID.
    await expect(page.getByTestId('order-status-value')).toHaveText('Новый');
    await expect(page.getByTestId('order-status-to-PAID')).toHaveCount(0);

    // OrderStatusForm renders its step buttons `disabled={pending !== null}`,
    // i.e. enabled in the server HTML with a JavaScript-only onClick, so a
    // click that lands before hydration is dropped without a trace and the
    // status assertion below would fail with no explanation.
    await clickWhenHydrated(page.getByTestId('order-status-to-CONFIRMED'));

    await expect(page.getByTestId('order-status-value')).toHaveText('Подтверждён');
    expect((await readOrder(prisma, fixtures.unassigned.id)).status).toBe('CONFIRMED');
  });
});
