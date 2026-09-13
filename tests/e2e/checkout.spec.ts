import { test, expect } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './helpers/admin-order-fixtures';
import {
  checkoutFixturePrefix,
  checkoutIdentity,
  isolateOrderRequests,
  removeCheckoutFixtures,
} from './helpers/checkout-order-fixtures';

/**
 * Checkout/payment-foundation coverage (production-readiness task): an
 * individual customer completing checkout with bank transfer, a legal
 * entity blocked by an invalid BIN, a legal entity completing checkout with
 * an invoice, the success page rendering order number/total/status/payment
 * method, and double-submit prevention.
 *
 * Every test here submits its own deterministic, isolated customer identity
 * (see helpers/checkout-order-fixtures.ts) instead of one hardcoded phone
 * shared by every test/file/project — that is what previously funneled
 * every order-creating request from this suite into one shared rate-limit
 * bucket and left permanent rows in the local database. Rows created here
 * are deleted in afterAll by their deterministic prefix; the production
 * rate limiter is untouched.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);

let prisma: PrismaClient | undefined;
let prefix: string;

test.beforeAll(({}, testInfo) => {
  prefix = checkoutFixturePrefix('CHECKOUT', testInfo.project.name);
  if (hasDatabase) prisma = createPrismaClient();
});

test.afterAll(async () => {
  if (!prisma) return;
  await removeCheckoutFixtures(prisma, prefix);
  await prisma.$disconnect();
});

async function addRackToCart(page: import('@playwright/test').Page) {
  await page.goto('/configurator');
  await page.waitForSelector('text=Оформить заказ', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.goto('/order');
}

test('individual customer completes checkout with bank transfer', async ({ page }, testInfo) => {
  await isolateOrderRequests(page, prefix, testInfo);
  await addRackToCart(page);

  const identity = checkoutIdentity(prefix, testInfo);
  await page.getByLabel('ФИО / Контактное лицо').fill(identity.fullName);
  await page.getByLabel('Телефон *', { exact: true }).fill(identity.phone);
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Город').fill('Алматы');

  const paymentSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Безналичный расчёт' }) });
  await paymentSelect.selectOption('BANK_TRANSFER');

  // Kaspi methods must not be offered as options at all.
  const options = await paymentSelect.locator('option').allTextContents();
  expect(options.some((o) => /Kaspi/i.test(o))).toBe(false);

  const submitButton = page.getByRole('button', { name: /Подтвердить заказ/ });
  await submitButton.click();

  await expect(page).toHaveURL(/\/order\/success/, { timeout: 15_000 });
  await expect(page.getByText(/Номер вашего заказа/)).toBeVisible();
  await expect(page.getByText('Заказ принят', { exact: true })).toBeVisible();
  await expect(page.getByText('Безналичный расчёт')).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Написать в WhatsApp' })).toBeVisible();
});

test('legal entity checkout is blocked by a missing/invalid BIN', async ({ page }, testInfo) => {
  await isolateOrderRequests(page, prefix, testInfo);
  await addRackToCart(page);

  const identity = checkoutIdentity(prefix, testInfo);
  await page.getByLabel('ФИО / Контактное лицо').fill(identity.fullName);
  await page.getByLabel('Телефон *', { exact: true }).fill(identity.phone);
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Город').fill('Алматы');
  await page.getByText('Юридическое лицо').click();
  await page.getByLabel('Название компании *').fill('ТОО Ромашка');
  await page.getByLabel('БИН *').fill('123');

  await page.getByRole('button', { name: /Подтвердить заказ/ }).click();

  // Rejected client-side (react-hook-form/zod) before any network call, or
  // by the server if it somehow reached it — either way the customer stays
  // on /order and sees a readable error, never a silent success redirect.
  await expect(page).toHaveURL(/\/order$/);
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/\/order\/success/);
});

test('legal entity completes checkout with a valid BIN and invoice payment', async ({ page }, testInfo) => {
  await isolateOrderRequests(page, prefix, testInfo);
  await addRackToCart(page);

  const identity = checkoutIdentity(prefix, testInfo);
  await page.getByLabel('ФИО / Контактное лицо').fill(identity.fullName);
  await page.getByLabel('Телефон *', { exact: true }).fill(identity.phone);
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Город').fill('Алматы');
  await page.getByText('Юридическое лицо').click();
  await page.getByLabel('Название компании *').fill('ТОО Ромашка');
  await page.getByLabel('БИН *').fill('123456789012');

  const paymentSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Безналичный расчёт' }) });
  await paymentSelect.selectOption('BANK_INVOICE');

  await page.getByRole('button', { name: /Подтвердить заказ/ }).click();

  await expect(page).toHaveURL(/\/order\/success/, { timeout: 15_000 });
  await expect(page.getByText('Оплата по счёту')).toBeVisible();
});

test('the submit button disables immediately to prevent a duplicate submission', async ({ page }, testInfo) => {
  // Slow the order request down just enough to observe the transient
  // disabled state — the in-memory dev backend otherwise resolves and
  // navigates away before an assertion could ever catch it. Folded into the
  // same isolateOrderRequests call (rather than a second page.route) since
  // Playwright route handlers are LIFO and a second registration would just
  // shadow the rate-limit isolation header instead of layering with it.
  await isolateOrderRequests(page, prefix, testInfo, 800);
  await addRackToCart(page);

  const identity = checkoutIdentity(prefix, testInfo);
  await page.getByLabel('ФИО / Контактное лицо').fill(identity.fullName);
  await page.getByLabel('Телефон *', { exact: true }).fill(identity.phone);
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Город').fill('Алматы');

  const submitButton = page.getByRole('button', { name: /Подтвердить заказ|Оформляем/ });
  const orderResponse = page.waitForResponse(
    (res) => res.url().includes('/api/orders') && res.request().method() === 'POST',
  );
  await submitButton.click();
  await expect(submitButton).toBeDisabled();

  // Let the deliberately-delayed request actually land before the test ends
  // — otherwise its write can complete after afterAll has already started
  // deleting this test's fixture rows, racing the FK constraint.
  await orderResponse;
});
