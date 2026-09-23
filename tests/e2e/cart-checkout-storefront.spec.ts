import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

/**
 * Phase 4 storefront cart/checkout: the redesign's interaction and layout
 * risks. No test here creates an order — the one submission that reaches
 * /api/orders is answered by a stubbed validation failure, so nothing is
 * written and no rate-limit budget is spent.
 */

async function addRack(page: Page, delivery = 'delivery-city') {
  await page.goto(`/ru/configurator?model=ms-standard&height=2000&depth=400&shelves=5&sections=1000:0:0:0&delivery=${delivery}`);
  const add = page.getByRole('button', { name: 'Добавить в корзину' });
  await expect(add).toBeEnabled({ timeout: 15_000 });
  await add.click();
  await expect(page.getByText('Добавлено в корзину').first()).toBeVisible();
}

const digits = (text: string) => Number(text.replace(/\D/g, ''));

test('the quantity stepper re-prices on the server and the total never shows a stale amount', async ({ page }) => {
  await addRack(page);
  await page.goto('/ru/cart');
  const summary = page.locator('aside').filter({ hasText: 'Итого по корзине' });
  const checkout = summary.getByRole('button', { name: 'Оформить заказ' });
  await expect(checkout).toBeEnabled();
  const unitTotal = digits(await summary.locator('.mono').first().innerText());

  // Three quick steps: every intermediate answer is superseded by the last.
  const plus = page.getByRole('button', { name: 'Увеличить' });
  await plus.click();
  await plus.click();
  await plus.click();
  await expect(page.getByLabel('Кол-во:')).toHaveValue('4');
  await expect(checkout).toBeEnabled();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items[0]);
  expect(stored.configuration.quantity).toBe(4);
  expect(stored.priceSnapshot.breakdown.quantity).toBe(4);
  await expect.poll(async () => digits(await summary.locator('.mono').first().innerText())).toBe(stored.priceSnapshot.breakdown.total);
  expect(stored.priceSnapshot.breakdown.total).toBeGreaterThan(unitTotal);

  await page.getByRole('button', { name: 'Уменьшить' }).click();
  await expect(page.getByLabel('Кол-во:')).toHaveValue('3');
});

test('removing the last line shows the empty cart with routes back to the configurator and catalogue', async ({ page }) => {
  await addRack(page);
  await page.goto('/ru/cart');
  await page.getByRole('button', { name: 'Удалить' }).click();
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Ваша корзина пуста' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Открыть конфигуратор' })).toHaveAttribute('href', '/ru/configurator');
  await expect(main.getByRole('link', { name: 'Каталог', exact: true })).toHaveAttribute('href', '/ru/catalog');
});

test('checkout errors sit on their fields, and a half-typed BIN hidden by switching back to an individual does not block the order', async ({ page }) => {
  await addRack(page);
  await page.goto('/ru/order');

  // Client validation: the error is announced for, and focus moves to, the field.
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  const fullName = page.getByLabel('ФИО / Контактное лицо');
  await expect(fullName).toBeFocused();
  await expect(fullName).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await fullName.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/\S/);

  await page.getByText('Юридическое лицо').click();
  await page.getByLabel('Название компании *').fill('ТОО Тест');
  await page.getByLabel('БИН *').fill('123');
  await page.getByText('Физическое лицо').click();
  await expect(page.getByLabel('БИН *')).toHaveCount(0);

  await fullName.fill('Тест Витрина');
  await page.getByLabel('Телефон *', { exact: true }).fill('+77001234567');
  await page.getByLabel('Email').fill('storefront@example.com');
  await page.getByLabel('Город').fill('Тараз');
  await page.getByLabel(/Адрес доставки/).fill('ул. Абая, 1');

  // The server's field verdict, stubbed: shown on the field it names and in
  // the summary message, with focus taken to the field.
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/orders', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Проверьте правильность заполнения формы',
        details: ['Город не подходит'],
        fieldErrors: [{ field: 'city', message: 'Город не подходит' }],
      }),
    });
  });
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();

  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted).toMatchObject({ customerType: 'INDIVIDUAL' });
  expect(submitted).not.toHaveProperty('binIin');
  const city = page.getByLabel('Город');
  await expect(city).toBeFocused();
  await expect(city).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').filter({ hasText: 'Проверьте правильность заполнения формы' })).toBeVisible();
  await expect(page).toHaveURL(/\/ru\/order$/);
});

test('checkout names the delivery chosen in the configurator, and regional delivery never reads as free', async ({ page }) => {
  await addRack(page, 'delivery-transport-company');
  await page.goto('/ru/order');
  const delivery = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Доставка' }) });
  await expect(delivery.getByText('Передача транспортной компании')).toBeVisible();
  const summary = page.locator('aside').filter({ hasText: 'Ваш заказ' });
  await expect(summary.getByText('Стоимость доставки рассчитывается индивидуально.')).toBeVisible();
  await expect(summary).not.toContainText(/0 ₸|бесплатно/i);
});

test('the empty checkout offers the same way back as the empty cart', async ({ page }) => {
  await page.goto('/order');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Себетте бірде-бір конфигурация жоқ.' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Конфигураторды ашу' })).toHaveAttribute('href', '/configurator');
});

for (const width of [320, 375, 390, 430]) {
  test(`cart and checkout fit ${width}px with the primary action unobstructed`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await addRack(page);
    for (const [path, action] of [['/cart', 'Тапсырыс беру'], ['/order', 'Тапсырысты растау']] as const) {
      await page.goto(path);
      const button = page.getByRole('button', { name: action });
      await expect(button).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await button.scrollIntoViewIfNeeded();
      // The floating WhatsApp link steps aside from any [data-fab-avoid] action.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const fab = document.querySelector('a.fixed[aria-label]') as HTMLElement | null;
            const action = document.querySelector('[data-fab-avoid] button') as HTMLElement;
            if (!fab || getComputedStyle(fab).pointerEvents === 'none') return false;
            const a = fab.getBoundingClientRect();
            const b = action.getBoundingClientRect();
            return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          }),
        )
        .toBe(false);
    }
  });
}
