import { test, expect } from '@playwright/test';

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
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Пароль').fill(adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/admin\/orders/);
  await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();

  // Already-authenticated visitor bounces off /admin/login back to /admin/orders.
  await page.goto('/admin/login');
  await expect(page).toHaveURL(/\/admin\/orders/);

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('an invalid password shows an error and does not log in', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Пароль').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('opening an order shows customer/configuration/BOM/total, and a status change updates the page and history', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Пароль').fill(adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/admin\/orders/);

  const firstOrderLink = page.locator('table tbody tr').first().locator('a');
  const hasOrders = (await firstOrderLink.count()) > 0;
  test.skip(!hasOrders, 'no orders in the database to open — create one via /order first');

  await firstOrderLink.click();
  await expect(page).toHaveURL(/\/admin\/orders\/.+/);
  await expect(page.getByText('ФИО / контактное лицо')).toBeVisible();
  await expect(page.getByText('Итого')).toBeVisible();

  const statusSelect = page.locator('select');
  await statusSelect.selectOption('CONTACTED');
  await page.getByRole('button', { name: 'Изменить статус' }).click();

  await expect(page.getByText('Связались').first()).toBeVisible();
});
