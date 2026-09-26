import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './helpers/admin-order-fixtures';
import {
  checkoutFixturePrefix,
  checkoutIdentity,
  isolateOrderRequests,
  removeCheckoutFixtures,
} from './helpers/checkout-order-fixtures';
import { sectionButton, sectionButtons, selectSection, storedWidths } from './helpers/sections';

/**
 * End-to-end coverage for the redesigned per-section configurator (spec
 * "Required Playwright test" §48): build a 4-section row with independent
 * widths, drag-resize only one section, confirm the row prices correctly
 * and the exact section layout survives cart persistence and checkout.
 *
 * The checkout at the end submits a deterministic, isolated customer
 * identity (see helpers/checkout-order-fixtures.ts) — its own simulated
 * client IP keeps it out of the same rate-limit bucket checkout.spec.ts's
 * orders land in, and its own fullName prefix keeps its database row out of
 * checkout.spec.ts's cleanup sweep and vice versa.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);

let prisma: PrismaClient | undefined;
let prefix: string;

test.beforeAll(({}, testInfo) => {
  prefix = checkoutFixturePrefix('SECTIONS', testInfo.project.name, testInfo.repeatEachIndex);
  if (hasDatabase) prisma = createPrismaClient();
});

test.afterAll(async () => {
  if (!prisma) return;
  await removeCheckoutFixtures(prisma, prefix);
  await prisma.$disconnect();
});

async function getVisiblePriceText(page: Page): Promise<string> {
  const candidates = page.locator('text=/[\\d\\s]+\\s?₸/');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible()) return (await candidate.textContent()) ?? '';
  }
  return '';
}

function addSectionButton(page: Page) {
  return page.getByRole('button', { name: 'Добавить секцию', exact: true });
}

test('multi-section row: independent widths, single-section drag, cart and checkout persistence', async ({ page }, testInfo) => {
  await isolateOrderRequests(page, prefix, testInfo);
  await page.goto('/ru/configurator');

  // 1–2. Starts with one section; add three more (total 4).
  await expect(sectionButtons(page)).toHaveCount(1);
  for (let i = 0; i < 3; i += 1) {
    await addSectionButton(page).click();
  }
  await expect(sectionButtons(page)).toHaveCount(4);

  // 3. Assign distinct, valid widths to each section — each through its own
  // controls, which expand when the section is selected (V2.4).
  const targetWidths = ['700', '1200', '1500', '1000'];
  for (let i = 0; i < 4; i += 1) {
    await selectSection(page, i + 1);
    await page.locator(`select[aria-label="Ширина секции ${i + 1}"]`).selectOption(targetWidths[i]);
  }
  await expect.poll(() => storedWidths(page)).toEqual(targetWidths.map(Number));

  // 4. Total row length reflects the sum of distinct widths (proves the
  // preview is not faking uniform sections while pricing one width).
  const total = targetWidths.reduce((sum, w) => sum + Number(w), 0);
  await expect(page.getByText(`${total} мм`, { exact: true })).toBeVisible();

  await expect.poll(() => getVisiblePriceText(page), { timeout: 10_000 }).not.toBe('');
  const priceBeforeDrag = await getVisiblePriceText(page);

  // 6. Activate section 2 via its row in the sections panel.
  await sectionButton(page, 2).click();
  await expect(sectionButton(page, 2)).toHaveAttribute('aria-pressed', 'true');

  // 7–9. Drag the (now section-2-scoped) width handle — the preview must
  // resize smoothly before release (no assertion on intermediate frames,
  // just that the drag completes without a snap mid-gesture).
  const widthHandle = page.locator('button[data-axis="width"]');
  await widthHandle.scrollIntoViewIfNeeded();
  const box = await widthHandle.boundingBox();
  if (!box) throw new Error('Width resize handle has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 90, startY, { steps: 10 });
  await page.mouse.up();

  // 10–11. Section 2 snapped to a supported value; sections 1, 3 and 4 are untouched.
  await expect(page.locator('select[aria-label="Ширина секции 2"]')).not.toHaveValue('1200');
  const section2After = await page.locator('select[aria-label="Ширина секции 2"]').inputValue();
  expect(['700', '1000', '1500']).toContain(section2After);
  const widthsAfter = await storedWidths(page);
  expect([widthsAfter[0], widthsAfter[2], widthsAfter[3]]).toEqual([700, 1500, 1000]);

  // 12. Total row length changed to match the new mix of widths.
  const newTotal = 700 + Number(section2After) + 1500 + 1000;
  await expect(page.getByText(`${newTotal} мм`, { exact: true })).toBeVisible();

  // 13. Price was recalculated server-side.
  await expect.poll(() => getVisiblePriceText(page), { timeout: 10_000 }).not.toBe(priceBeforeDrag);

  // 14. Add the configuration to the cart.
  const finalWidths = ['700', section2After, '1500', '1000'];
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();

  // 15–16. Reload the cart and confirm every individual width persisted.
  await page.goto('/ru/cart');
  await page.reload();
  const cartRow = page.locator('text=/\\d+×[\\d+]+×\\d+ мм/').first();
  await expect(cartRow).toBeVisible();
  const cartText = (await cartRow.textContent()) ?? '';
  for (const width of finalWidths) {
    expect(cartText).toContain(width);
  }

  // 17–18. Checkout and confirm the order succeeds.
  const cartCheckoutButton = page.getByRole('button', { name: 'Оформить заказ' });
  await expect(cartCheckoutButton).toBeEnabled({ timeout: 15_000 });
  await cartCheckoutButton.click();
  await expect(page).toHaveURL(/\/order$/);

  const identity = checkoutIdentity(prefix, testInfo);
  await page.getByLabel('ФИО / Контактное лицо').fill(identity.fullName);
  await page.getByLabel('Телефон *', { exact: true }).fill(identity.phone);
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Город').fill('Алматы');

  await page.getByRole('button', { name: /Подтвердить заказ/ }).click();
  await expect(page).toHaveURL(/\/order\/success/, { timeout: 15_000 });
});

test('adding sections is capped at 5 and removing is capped at 1', async ({ page }) => {
  await page.goto('/ru/configurator');

  for (let i = 0; i < 12; i += 1) {
    const btn = addSectionButton(page);
    if (await btn.isDisabled()) break;
    await btn.click();
  }
  await expect(sectionButtons(page)).toHaveCount(5);
  await expect(addSectionButton(page)).toBeDisabled();
  await expect(page.getByText('Достигнуто максимальное количество секций.')).toBeVisible();

  // exact:true excludes ShelvingPreview's per-section "Удалить секцию N" buttons,
  // scoping this to the sections panel's plain-labeled remove button (on
  // the active section's row).
  const removeButtons = page.getByRole('button', { name: 'Удалить секцию', exact: true });
  for (let i = 0; i < 12; i += 1) {
    const btn = removeButtons.first();
    if (await btn.isDisabled()) break;
    await btn.click();
  }
  await expect(sectionButtons(page)).toHaveCount(1);
  await expect(removeButtons.first()).toBeDisabled();
});
