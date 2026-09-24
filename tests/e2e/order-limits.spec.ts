import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

/**
 * V2.1 limits in the browser: at most 5 sections per configuration and at
 * most 5 physical kits (sum of quantities) per order. The server enforces
 * both (tests/integration/order-kit-limit.test.ts); these check that the UI
 * mirrors them, explains why an action is refused, and never deletes or
 * trims a cart / configuration saved before the limits existed. No test here
 * submits an order.
 */

const LIMIT_TEXT = 'В одном заказе можно оформить не более 5 стеллажей.';

function configuration(quantity: number) {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
    sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity,
  };
}

/** Seeds the persisted cart (as an older session would have left it) before any page script runs. */
async function seedCart(page: Page, quantities: number[]) {
  const items = quantities.map((quantity, i) => ({
    id: `seed-${i}`,
    modelSlug: 'ms-standard',
    modelName: 'MS Стандарт',
    configuration: configuration(quantity),
    priceSnapshot: null,
    addedAt: '2026-09-24T00:00:00.000Z',
  }));
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ms-shelving-cart', value);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify({ state: { items }, version: 1 }));
}

const storedQuantities = (page: Page) =>
  page.evaluate(() =>
    (JSON.parse(localStorage.getItem('ms-shelving-cart') ?? '{"state":{"items":[]}}').state.items as { configuration: { quantity: number } }[]).map(
      (i) => i.configuration.quantity,
    ),
  );

test('an over-limit persisted cart is kept intact, explained, and cannot go to checkout', async ({ page }) => {
  await seedCart(page, [4, 3]);
  await page.goto('/ru/cart');

  const summary = page.locator('aside').filter({ hasText: 'Итого по корзине' });
  await expect(summary.getByRole('alert')).toContainText(LIMIT_TEXT);
  await expect(summary.getByRole('button', { name: 'Оформить заказ' })).toBeDisabled();
  await expect(page.getByLabel('Кол-во:')).toHaveCount(2);
  expect(await storedQuantities(page)).toEqual([4, 3]);

  // Increasing is not offered; decreasing is, and brings the cart back under the limit.
  const plusButtons = page.getByRole('button', { name: 'Увеличить' });
  await expect(plusButtons.first()).toBeDisabled();
  await page.getByRole('button', { name: 'Уменьшить' }).nth(1).click();
  await page.getByRole('button', { name: 'Уменьшить' }).nth(1).click();
  await expect(page.getByLabel('Кол-во:').nth(1)).toHaveValue('1');
  expect(await storedQuantities(page)).toEqual([4, 1]);
  await expect(summary.getByRole('alert')).toHaveCount(0);
  await expect(summary.getByRole('button', { name: 'Оформить заказ' })).toBeEnabled({ timeout: 15_000 });
});

test('checkout with an over-limit persisted cart shows the notice and cannot submit', async ({ page }) => {
  await seedCart(page, [3, 3]);
  await page.goto('/ru/order');
  await expect(page.getByTestId('checkout-kit-limit')).toContainText(LIMIT_TEXT);
  await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeDisabled();
  expect(await storedQuantities(page)).toEqual([3, 3]);
});

test('cart quantity controls stop at the remaining capacity and a refused duplicate is explained', async ({ page }) => {
  await seedCart(page, [3, 1]);
  await page.goto('/ru/cart');
  const quantities = page.getByLabel('Кол-во:');
  await expect(quantities).toHaveCount(2);

  const plus = page.getByRole('button', { name: 'Увеличить' });
  await expect(plus.nth(1)).toBeEnabled();
  await plus.nth(1).click();
  await expect(quantities.nth(1)).toHaveValue('2');
  await expect(plus.nth(0)).toBeDisabled();
  await expect(plus.nth(1)).toBeDisabled();
  await expect(page.locator('aside').getByTestId('cart-kit-limit')).toHaveText(LIMIT_TEXT);

  await page.getByRole('button', { name: 'Дублировать' }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: LIMIT_TEXT })).toBeVisible();
  await expect(quantities).toHaveCount(2);
  expect(await storedQuantities(page)).toEqual([3, 2]);
});

test('the configurator refuses an add that would make 6 kits and says why', async ({ page }) => {
  await seedCart(page, [5]);
  await page.goto('/ru/configurator?model=ms-standard&height=2000&depth=400&shelves=5&sections=1000:0:0:0');
  await expect(page.getByTestId('configurator-kit-limit')).toHaveText(LIMIT_TEXT, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Оформить заказ' })).toBeDisabled();
  expect(await storedQuantities(page)).toEqual([5]);
});

test('an older 7-section link opens intact, is explained, and cannot be ordered until reduced to 5', async ({ page }) => {
  const sections = Array.from({ length: 7 }, () => '700:0:0:0').join(',');
  await page.goto(`/ru/configurator?model=ms-standard&height=2000&depth=400&shelves=5&sections=${sections}`);

  const widths = page.locator('select[aria-label^="Ширина секции"]');
  await expect(widths).toHaveCount(7);
  await expect(page.getByTestId('sections-over-limit')).toHaveText('В одном стеллаже не более 5 секций. Удалите лишние секции.');
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Добавить секцию', exact: true })).toBeDisabled();

  const remove = page.getByRole('button', { name: 'Удалить секцию', exact: true });
  await remove.first().click();
  await remove.first().click();
  await expect(widths).toHaveCount(5);
  await expect(page.getByTestId('sections-over-limit')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeEnabled({ timeout: 15_000 });
});
