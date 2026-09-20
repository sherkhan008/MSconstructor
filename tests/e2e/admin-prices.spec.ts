import { test, expect } from './helpers/test';
import type { BrowserContext, Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import {
  changeSellingPriceBehindTheUi,
  createPriceFixtures,
  createPrismaClient,
  fixturePrefix,
  readPrices,
  removePriceFixtures,
  sessionCookieFor,
  type FixtureRole,
  type PriceFixtures,
} from './helpers/admin-price-fixtures';

/**
 * /admin/prices — the internal price-management screen.
 *
 * Like the rest of the admin area this is PostgreSQL-only (see
 * docs/production-database.md), so the whole file skips cleanly without a real
 * DATABASE_URL.
 *
 * The tests never edit a real catalog price. `beforeAll` creates its own
 * inactive Component/Accessory rows — invisible to customers, because the
 * customer catalog query filters on `active` — plus one account per admin
 * role, and `afterAll` deletes all of it together with the price history and
 * audit rows the run produced.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);

test.skip(
  !hasDatabase,
  'requires a real PostgreSQL DATABASE_URL — see docs/production-database.md',
);

test.describe.configure({ mode: 'serial' });

let prisma: PrismaClient;
let fixtures: PriceFixtures;

test.beforeAll(async ({}, testInfo) => {
  prisma = createPrismaClient();
  fixtures = await createPriceFixtures(prisma, fixturePrefix(testInfo.project.name, testInfo.repeatEachIndex));
});

test.afterAll(async () => {
  if (!prisma) return;
  await removePriceFixtures(prisma, fixtures.prefix);
  await prisma.$disconnect();
});

async function signIn(context: BrowserContext, role: FixtureRole, baseURL: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([await sessionCookieFor(fixtures.users[role], baseURL)]);
}

/** Every test but the permission ones runs as a plain ADMIN. */
test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
});

/** The rows currently rendered, whichever layout (table or cards) is visible. */
function visibleRows(page: Page) {
  return page.locator('[data-testid="price-row"]:visible, [data-testid="price-card"]:visible');
}

function rowFor(page: Page, sku: string) {
  return page.locator(
    `[data-testid="price-row"][data-sku="${sku}"]:visible, [data-testid="price-card"][data-sku="${sku}"]:visible`,
  );
}

/** Runs `action` and waits for the list request it triggers to come back. */
async function withListReload(page: Page, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'GET' && /\/api\/admin\/prices(\?|$)/.test(candidate.url()),
    { timeout: 20_000 },
  );
  await action();
  await response;
  await expect(page.getByText('Загружаем цены…')).toBeHidden({ timeout: 20_000 });
}

async function openPrices(page: Page): Promise<void> {
  await withListReload(page, async () => {
    await page.goto('/admin/prices');
  });
  await expect(page.getByRole('heading', { name: 'Цены' })).toBeVisible();
}

async function search(page: Page, term: string): Promise<void> {
  await withListReload(page, async () => {
    await page.getByPlaceholder('Поиск по SKU или названию').fill(term);
  });
}

test('SUPER_ADMIN and ADMIN see the "Цены" section and can open the list', async ({
  page,
  context,
  baseURL,
}) => {
  for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
    await signIn(context, role, baseURL!);
    await page.goto('/admin/orders');

    const pricesLink = page.getByRole('link', { name: 'Цены' });
    await expect(pricesLink).toBeVisible();

    await withListReload(page, async () => {
      await pricesLink.click();
    });
    await expect(page).toHaveURL(/\/admin\/prices/);
    await expect(page.getByRole('heading', { name: 'Цены' })).toBeVisible();
    await expect(visibleRows(page).first()).toBeVisible();
  }
});

test('search finds a position by SKU and shows both prices with ₸ formatting', async ({ page }) => {
  await openPrices(page);
  await search(page, fixtures.shelf.sku);

  await expect(visibleRows(page)).toHaveCount(1);
  const row = rowFor(page, fixtures.shelf.sku);
  // 9500.50 must stay distinguishable from 9500 — no float rounding anywhere.
  await expect(row.getByTestId('selling-price')).toHaveText('9 500.50 ₸');
  await expect(row.getByTestId('purchase-price')).toHaveText('6 000.25 ₸');

  await expect(page).toHaveURL(new RegExp(`q=${fixtures.shelf.sku}`));
});

test('an empty search result shows the empty state', async ({ page }) => {
  await openPrices(page);
  await search(page, `${fixtures.prefix}-NO-SUCH-SKU`);
  await expect(page.getByText('Ничего не найдено')).toBeVisible();
  await expect(visibleRows(page)).toHaveCount(0);
});

test('the entity filter narrows the list on the server', async ({ page }) => {
  await openPrices(page);
  await search(page, fixtures.prefix);
  await expect(visibleRows(page)).toHaveCount(4);

  await withListReload(page, async () => {
    await page.locator('select[name="entityType"]').selectOption('ACCESSORY');
  });
  await expect(visibleRows(page)).toHaveCount(1);
  await expect(rowFor(page, fixtures.accessory.sku)).toBeVisible();

  await withListReload(page, async () => {
    await page.locator('select[name="entityType"]').selectOption('COMPONENT');
  });
  await expect(visibleRows(page)).toHaveCount(3);
});

test('the component-type filter narrows the list further', async ({ page }) => {
  await openPrices(page);
  await search(page, fixtures.prefix);

  await withListReload(page, async () => {
    await page.locator('select[name="componentType"]').selectOption('UPRIGHT');
  });
  await expect(visibleRows(page)).toHaveCount(1);
  await expect(rowFor(page, fixtures.upright.sku)).toBeVisible();
});

test('pagination pages through the catalog and a new search resets to page 1', async ({ page }) => {
  await openPrices(page);

  const pageLabel = page.getByText(/^Стр\. \d+ из \d+$/);
  test.skip(!(await pageLabel.isVisible()), 'the catalog fits on a single page');

  await expect(pageLabel).toContainText('Стр. 1 из');
  await withListReload(page, async () => {
    await page.getByRole('button', { name: 'Вперёд →' }).click();
  });
  await expect(pageLabel).toContainText('Стр. 2 из');
  await expect(page).toHaveURL(/page=2/);

  await withListReload(page, async () => {
    await page.getByRole('button', { name: '← Назад' }).click();
  });
  await expect(pageLabel).toContainText('Стр. 1 из');

  await withListReload(page, async () => {
    await page.getByRole('button', { name: 'Вперёд →' }).click();
  });
  await expect(page).toHaveURL(/page=2/);

  // A different search term must not keep the old page number.
  await search(page, fixtures.prefix);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(visibleRows(page)).toHaveCount(4);
});

test('invalid money is rejected before it reaches the server', async ({ page }) => {
  await openPrices(page);
  await search(page, fixtures.upright.sku);
  await rowFor(page, fixtures.upright.sku).getByRole('button', { name: 'Изменить' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const selling = dialog.locator('input[name="sellingPrice"]');
  // A text input with inputMode=decimal, never type=number: the browser must
  // not be able to hand back a float, an exponent or a locale comma.
  await expect(selling).toHaveAttribute('type', 'text');
  await expect(selling).toHaveAttribute('inputmode', 'decimal');

  for (const invalid of ['-1', '1.234', '1e5', '12,500']) {
    await selling.fill(invalid);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByRole('alert').first()).toBeVisible();
    await expect(dialog).toBeVisible();
  }

  // Nothing was written while the input was invalid.
  expect(await readPrices(prisma, fixtures.upright.id)).toEqual({
    selling: fixtures.upright.selling,
    purchase: fixtures.upright.purchase,
  });

  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
});

test('Сохранить stays disabled until a price really changes', async ({ page }) => {
  await openPrices(page);
  await search(page, fixtures.beam.sku);
  await rowFor(page, fixtures.beam.sku).getByRole('button', { name: 'Изменить' }).click();

  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Сохранить' });
  await expect(save).toBeDisabled();

  // "4300.00" and the stored "4300.00" are the same money — still no change,
  // so no pointless history row can be produced.
  await dialog.locator('input[name="sellingPrice"]').fill('4300.00');
  await expect(save).toBeDisabled();

  await dialog.locator('input[name="sellingPrice"]').fill('4301');
  await expect(save).toBeEnabled();

  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
});

test('a selling-price change saves, updates the row at once and shows up in history', async ({
  page,
}) => {
  await openPrices(page);
  await search(page, fixtures.upright.sku);

  const row = rowFor(page, fixtures.upright.sku);
  await row.getByRole('button', { name: 'Изменить' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="sellingPrice"]').fill('13250.50');
  await dialog.locator('textarea[name="reason"]').fill('Повышение цены поставщика');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Цена обновлена')).toBeVisible();
  // The row shows the new value without any page reload.
  await expect(row.getByTestId('selling-price')).toHaveText('13 250.50 ₸');

  expect(await readPrices(prisma, fixtures.upright.id)).toEqual({
    selling: '13250.50',
    purchase: fixtures.upright.purchase,
  });

  await row.getByRole('button', { name: 'История' }).click();
  const history = page.getByRole('dialog');
  await expect(history.getByRole('heading', { name: 'История изменений' })).toBeVisible();
  await expect(history.getByText('Цена продажи').first()).toBeVisible();
  await expect(history.getByTestId('history-change').first()).toHaveText('12 000 ₸ → 13 250.50 ₸');
  await expect(history.getByText('Повышение цены поставщика')).toBeVisible();
});

test('a purchase-price change saves on its own and is labelled as such in history', async ({
  page,
}) => {
  await openPrices(page);
  await search(page, fixtures.beam.sku);

  const row = rowFor(page, fixtures.beam.sku);
  await row.getByRole('button', { name: 'Изменить' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="purchasePrice"]').fill('2950');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  await expect(dialog).toBeHidden();
  await expect(row.getByTestId('purchase-price')).toHaveText('2 950 ₸');
  // The selling price was not sent and must not have moved.
  await expect(row.getByTestId('selling-price')).toHaveText('4 300 ₸');

  expect(await readPrices(prisma, fixtures.beam.id)).toEqual({
    selling: fixtures.beam.selling,
    purchase: '2950.00',
  });

  await row.getByRole('button', { name: 'История' }).click();
  const history = page.getByRole('dialog');
  await expect(history.getByText('Закупочная цена').first()).toBeVisible();
  await expect(history.getByTestId('history-change').first()).toHaveText('2 800 ₸ → 2 950 ₸');
});

test('a 409 conflict is shown and never overwrites the other admin’s price', async ({ page }) => {
  await openPrices(page);
  await search(page, fixtures.shelf.sku);

  const row = rowFor(page, fixtures.shelf.sku);
  await row.getByRole('button', { name: 'Изменить' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="sellingPrice"]').fill('11111');

  // Another admin commits a different price while this dialog is open.
  await changeSellingPriceBehindTheUi(prisma, fixtures.shelf.id, '10101.00');

  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByText('Цена уже была изменена другим пользователем.')).toBeVisible();

  // The stale value was NOT written — the other admin's price still stands.
  expect((await readPrices(prisma, fixtures.shelf.id)).selling).toBe('10101.00');

  await dialog.getByRole('button', { name: 'Обновить данные' }).click();
  await expect(dialog.locator('input[name="sellingPrice"]')).toHaveValue('10101');
  await expect(dialog.getByText('Цена уже была изменена другим пользователем.')).toBeHidden();

  // Still the other admin's value: nothing was silently retried.
  expect((await readPrices(prisma, fixtures.shelf.id)).selling).toBe('10101.00');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
});

test('history renders a legacy row with no field and no previous value', async ({ page }) => {
  // PriceHistory.field is nullable for rows written before that column
  // existed; the UI must stay readable instead of guessing or crashing.
  await prisma.priceHistory.create({
    data: {
      entityType: 'ACCESSORY',
      entityId: fixtures.accessory.id,
      entitySku: fixtures.accessory.sku,
      entityName: 'Legacy',
      field: null,
      oldValue: null,
      newValue: '4300.00',
      adminName: 'Старая система',
    },
  });

  await openPrices(page);
  await search(page, fixtures.accessory.sku);
  await rowFor(page, fixtures.accessory.sku).getByRole('button', { name: 'История' }).click();

  const history = page.getByRole('dialog');
  await expect(history.getByText('Ничего не найдено')).toHaveCount(0);
  await expect(history.getByText('Изменение цены')).toBeVisible();
  await expect(history.getByTestId('history-change').first()).toHaveText('— → 4 300 ₸');
});

for (const role of ['MANAGER', 'CONTENT_MANAGER'] as const) {
  test(`${role} sees no "Цены" section and gets no price data`, async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, role, baseURL!);

    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Цены' })).toHaveCount(0);

    await page.goto('/admin/prices');
    await expect(page.getByText('Доступ запрещён')).toBeVisible();
    // No price markup is produced for them at all.
    await expect(page.getByText('Закупочная цена')).toHaveCount(0);
    expect(await page.content()).not.toContain(fixtures.upright.sku);

    const list = await page.request.get('/api/admin/prices');
    expect(list.status()).toBe(403);
    expect(await list.text()).not.toContain('purchasePrice');

    const history = await page.request.get(
      `/api/admin/prices/COMPONENT/${fixtures.upright.id}/history`,
    );
    expect(history.status()).toBe(403);

    const patch = await page.request.patch(
      `/api/admin/prices/COMPONENT/${fixtures.upright.id}`,
      { data: { sellingPrice: '1.00' } },
    );
    expect(patch.status()).toBe(403);
  });
}

test('on a phone there is no horizontal overflow and both actions stay reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await openPrices(page);
  await search(page, fixtures.prefix);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const row = rowFor(page, fixtures.upright.sku);
  const edit = row.getByRole('button', { name: 'Изменить' });
  await expect(edit).toBeVisible();
  expect((await edit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(row.getByRole('button', { name: 'История' })).toBeVisible();

  await edit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  // The dialog stays inside the viewport instead of pushing the page sideways.
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(413);
  await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Отмена' }).click();
});
