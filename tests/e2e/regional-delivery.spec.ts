import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

/**
 * Owner rule, end to end: delivery is free only for CITY delivery in
 * Алматы/Астана/Караганда/Шымкент. Regional delivery (here: hand-off to a
 * transport company) is calculated individually, so the customer never sees
 * it as 0 ₸ or "free" — the configurator, cart and checkout show the server's
 * note instead of a delivery amount.
 *
 * And the public validation contract: checkout shows the server's message
 * for a failed field without a raw "city:" / "deliveryAddress:" prefix, while
 * the API still names the field in fieldErrors.
 */

const REGIONAL_NOTE = 'Стоимость доставки рассчитывается индивидуально.';
const RAW_PREFIX = /\b(city|deliveryAddress|email|phone|items)\s*:/;

const configuration = (deliveryId: string) => ({
  modelSlug: 'ms-standard',
  depth: 500,
  sections: [{ id: 'sec-1', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false }],
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId,
  quantity: 1,
});

/** Opens the configurator on a persisted configuration with the given delivery. */
async function openConfiguratorWithDelivery(page: Page, deliveryId: string) {
  await page.goto('/ru/configurator');
  await page.evaluate((config) => {
    localStorage.setItem(
      'ms-shelving-configurator',
      JSON.stringify({ state: { config, activeSectionId: config.sections[0].id }, version: 3 }),
    );
  }, configuration(deliveryId));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeEnabled({ timeout: 15_000 });
}

test('transport-company delivery is shown as individually calculated in configurator, cart and checkout — never 0 ₸ or free', async ({ page }) => {
  await openConfiguratorWithDelivery(page, 'delivery-transport-company');

  await page.getByRole('button', { name: /Детали стоимости/ }).click();
  const breakdown = page.locator('dl').filter({ hasText: 'Комплектующие' });
  await expect(breakdown).toBeVisible();
  await expect(breakdown).not.toContainText('Доставка');
  await expect(page.getByText(REGIONAL_NOTE)).toBeVisible();

  await page.getByRole('button', { name: 'Добавить в корзину' }).click();

  await page.goto('/ru/cart');
  const cartSummary = page.locator('aside').filter({ hasText: 'Итого по корзине' });
  await expect(cartSummary.getByText(REGIONAL_NOTE)).toBeVisible();
  await expect(cartSummary).not.toContainText(/бесплатно/i);

  await page.goto('/ru/order');
  const orderSummary = page.locator('aside').filter({ hasText: 'Ваш заказ' });
  await expect(orderSummary.getByText(REGIONAL_NOTE)).toBeVisible();
  await expect(orderSummary).not.toContainText(/бесплатно/i);
});

test('/delivery never labels the transport-company method as free', async ({ page }) => {
  await page.goto('/ru/delivery');
  const card = page.locator('div.border').filter({ has: page.getByRole('heading', { name: 'Передача транспортной компании' }) });
  await expect(card).toContainText('Стоимость доставки рассчитывается индивидуально');
  await expect(card).not.toContainText('Бесплатно');
});

test('checkout shows the city-eligibility error without a raw "city:" prefix', async ({ page }) => {
  await openConfiguratorWithDelivery(page, 'delivery-city');
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.goto('/ru/order');

  await page.getByLabel('ФИО / Контактное лицо').fill('Тест Регион');
  await page.getByLabel('Телефон *', { exact: true }).fill('+77001234567');
  await page.getByLabel('Email').fill('region@example.com');
  await page.getByLabel('Город').fill('Тараз');
  await page.getByLabel(/Адрес доставки/).fill('ул. Абая, 10');

  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/orders'));
  await page.getByRole('button', { name: /Подтвердить заказ/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(400);
  const json = await response.json();
  expect(json.fieldErrors).toEqual([expect.objectContaining({ field: 'city' })]);

  const errorBox = page.locator('.text-danger').filter({ hasText: 'Проверьте правильность заполнения формы' });
  await expect(errorBox).toContainText('Бесплатная доставка по городу доступна только в Алматы, Астане, Караганде и Шымкенте');
  expect(await errorBox.textContent()).not.toMatch(RAW_PREFIX);
  await expect(page).toHaveURL(/\/order$/);
});

test('the order API names a missing address structurally, with a clean message', async ({ page }) => {
  const response = await page.request.post('/api/orders', {
    data: {
      fullName: 'Тест Адрес',
      phone: '+77001234567',
      email: 'address@example.com',
      city: 'Алматы',
      deliveryAddress: '',
      customerType: 'INDIVIDUAL',
      paymentPreference: 'BANK_TRANSFER',
      items: [{ configuration: configuration('delivery-city') }],
    },
  });
  expect(response.status()).toBe(400);
  const json = await response.json();
  expect(json.fieldErrors).toEqual([{ field: 'deliveryAddress', message: 'Укажите адрес доставки' }]);
  expect(json.details).toEqual(['Укажите адрес доставки']);
  expect(JSON.stringify(json.details)).not.toMatch(RAW_PREFIX);
});
