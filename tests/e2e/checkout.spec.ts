import { test, expect } from '@playwright/test';

/**
 * Checkout/payment-foundation coverage (production-readiness task): an
 * individual customer completing checkout with bank transfer, a legal
 * entity blocked by an invalid BIN, a legal entity completing checkout with
 * an invoice, the success page rendering order number/total/status/payment
 * method, and double-submit prevention.
 */

async function addRackToCart(page: import('@playwright/test').Page) {
  await page.goto('/configurator');
  await page.waitForSelector('text=Оформить заказ', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.goto('/order');
}

test('individual customer completes checkout with bank transfer', async ({ page }) => {
  await addRackToCart(page);

  await page.getByLabel('ФИО / Контактное лицо').fill('Тест Тестов');
  await page.getByLabel('Телефон *', { exact: true }).fill('+77001234567');
  await page.getByLabel('Email').fill('test@example.com');
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

test('legal entity checkout is blocked by a missing/invalid BIN', async ({ page }) => {
  await addRackToCart(page);

  await page.getByLabel('ФИО / Контактное лицо').fill('Тест Тестов');
  await page.getByLabel('Телефон *', { exact: true }).fill('+77001234567');
  await page.getByLabel('Email').fill('test@example.com');
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

test('legal entity completes checkout with a valid BIN and invoice payment', async ({ page }) => {
  await addRackToCart(page);

  await page.getByLabel('ФИО / Контактное лицо').fill('ИП Тестов');
  await page.getByLabel('Телефон *', { exact: true }).fill('+77001234567');
  await page.getByLabel('Email').fill('test@example.com');
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

test('the submit button disables immediately to prevent a duplicate submission', async ({ page }) => {
  await addRackToCart(page);

  await page.getByLabel('ФИО / Контактное лицо').fill('Тест Тестов');
  await page.getByLabel('Телефон *', { exact: true }).fill('+77001234567');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Город').fill('Алматы');

  // Slow the order request down just enough to observe the transient
  // disabled state — the in-memory dev backend otherwise resolves and
  // navigates away before an assertion could ever catch it.
  await page.route('**/api/orders', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  const submitButton = page.getByRole('button', { name: /Подтвердить заказ|Оформляем/ });
  await submitButton.click();
  await expect(submitButton).toBeDisabled();
});
