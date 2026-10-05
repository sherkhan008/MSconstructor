import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { storedSections, storedWorkspace } from './helpers/sections';
import { configurationToShareQuery, workspaceToShareQuery } from '../../src/lib/configurator/url';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '../../src/lib/types/domain';

/**
 * 2026-10-01 owner requirement: a corner's geometry reads best from above, so
 * a corner that appears — converted in the section controls, or arriving with
 * a kit (switching kits, a share link, a restored draft) — selects the top
 * view, which draws the kit's real corner plan. It never fights the customer:
 * an explicit choice of the front view sticks until a NEW corner appears.
 * Straight racks keep the default front view. Reset returns to it. Switching
 * view never prices anything.
 */

const section = (width: number, height: number, shelves: number, corner: SectionCorner = 'NONE'): ShelvingSection => ({
  id: `${width}-${height}-${shelves}-${corner}`,
  width,
  height,
  shelves,
  rearWall: false,
  leftWall: false,
  rightWall: false,
  corner,
});

const kit = (sections: ShelvingSection[]): ShelvingConfiguration => ({
  modelSlug: 'ms-standard',
  depth: 400,
  sections,
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId: 'delivery-pickup',
  quantity: 1,
});

const STRAIGHT3 = kit([section(1000, 2000, 5), section(1000, 2000, 5), section(1000, 2000, 5)]);
const LEFT_AND_RIGHT = kit([section(1000, 2000, 5, 'LEFT'), section(1000, 2000, 5), section(1000, 2000, 5, 'RIGHT')]);

const frontButton = (page: Page) => page.getByRole('button', { name: 'Вид спереди', exact: true });
const topButton = (page: Page) => page.getByRole('button', { name: 'Вид сверху', exact: true });

async function expectView(page: Page, view: 'front' | 'top') {
  await expect(topButton(page)).toHaveAttribute('aria-pressed', String(view === 'top'));
  await expect(frontButton(page)).toHaveAttribute('aria-pressed', String(view === 'front'));
  if (view === 'top') {
    await expect(page.getByRole('img', { name: 'Схема стеллажа сверху' })).toBeVisible();
    await expect(page.getByTestId('preview-stage')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('preview-stage')).toBeVisible();
  }
}

async function waitForPrice(page: Page) {
  await expect(page.getByRole('button', { name: /^Добавить (все )?в корзину$/ })).toBeEnabled({ timeout: 20_000 });
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const orientation = (page: Page, n: number) => page.locator(`select[aria-label="Расположение секции ${n}"]`);

test('adding a LEFT corner opens the top view; an explicit front view sticks until another corner appears', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/ru/configurator?${configurationToShareQuery(STRAIGHT3)}`);
  await waitForPrice(page);
  // 1. A straight rack opens in the front view.
  await expectView(page, 'front');

  // 2–3. Section 1 becomes a LEFT corner → the top view, drawing it.
  await orientation(page, 1).selectOption('LEFT');
  await expectView(page, 'top');
  const plan = page.getByTestId('top-view-corner-plan');
  await expect(plan.locator('[data-plan-section="1"]')).toHaveAttribute('data-corner', 'LEFT');

  // 4–5. The customer chooses the front view: it stays, through edits that
  // add no corner — a straight section's width, the corner's own width.
  await frontButton(page).click();
  await expectView(page, 'front');
  await page.locator('select[aria-label="Ширина секции 2"]').selectOption('700');
  await page.locator('select[aria-label="Ширина секции 1"]').selectOption('1200');
  await expect.poll(async () => (await storedSections(page)).map((s) => s.width)).toEqual([1200, 700, 1000]);
  await expectView(page, 'front');

  // 6–7. A second corner (RIGHT) appears → the top view again, both drawn.
  await orientation(page, 3).selectOption('RIGHT');
  await expectView(page, 'top');
  await expect(plan.locator('[data-plan-section="3"]')).toHaveAttribute('data-corner', 'RIGHT');
  expect((await storedSections(page)).map((s) => s.corner)).toEqual(['LEFT', 'NONE', 'RIGHT']);
  expect(errors).toEqual([]);
});

test('a RIGHT corner opens the top view; corners removed again hand an automatic top view back to the front', async ({ page }) => {
  await page.goto(`/ru/configurator?${configurationToShareQuery(kit([section(1000, 2000, 5), section(1000, 2000, 5)]))}`);
  await waitForPrice(page);
  await expectView(page, 'front');
  await orientation(page, 2).selectOption('RIGHT');
  await expectView(page, 'top');
  await expect(page.getByTestId('top-view-corner-plan').locator('[data-plan-section="2"]')).toHaveAttribute('data-corner', 'RIGHT');
  // The corner removed: the view the corner chose returns to the default.
  await orientation(page, 2).selectOption('NONE');
  await expectView(page, 'front');
});

test('LEFT + RIGHT in a share link: opens in the top view with both corners drawn; the front view stays available', async ({ page }) => {
  await page.goto(`/ru/configurator?${configurationToShareQuery(LEFT_AND_RIGHT)}`);
  await waitForPrice(page);
  await expectView(page, 'top');
  const plan = page.getByTestId('top-view-corner-plan');
  await expect(plan.locator('[data-corner="LEFT"]')).toHaveCount(1);
  await expect(plan.locator('[data-corner="RIGHT"]')).toHaveCount(1);
  await expect(plan.locator('[data-corner="NONE"]')).toHaveCount(1);
  await frontButton(page).click();
  await expectView(page, 'front');
  await expect(page.getByTestId('preview-stage').locator('rect[data-upright]')).toHaveCount(12);
});

test('a restored draft with a corner opens in the top view; a legacy v2 link (straight) opens in the front view', async ({ page }) => {
  await page.goto(`/ru/configurator?${configurationToShareQuery(LEFT_AND_RIGHT)}`);
  await waitForPrice(page);
  await expectView(page, 'top');
  // No query: the persisted draft (localStorage) is what loads.
  await page.goto('/ru/configurator');
  await waitForPrice(page);
  expect((await storedSections(page)).map((s) => s.corner)).toEqual(['LEFT', 'NONE', 'RIGHT']);
  await expectView(page, 'top');

  await page.goto('/ru/configurator?v=2&model=ms-standard&depth=400&sections=1000:2000:5:0:0:0,1200:2500:7:0:0:0');
  await waitForPrice(page);
  expect((await storedSections(page)).map((s) => [s.width, s.corner])).toEqual([
    [1000, 'NONE'],
    [1200, 'NONE'],
  ]);
  await expectView(page, 'front');
});

test('switching to a kit that has corners opens the top view; a straight kit opens the front view', async ({ page }) => {
  const straight = kit([section(1000, 2000, 5)]);
  const withCorner = kit([section(1000, 2000, 5, 'LEFT'), section(1000, 2000, 5)]);
  await page.goto(`/ru/configurator?${workspaceToShareQuery([straight, withCorner, kit([section(700, 1000, 2)])], 0)}`);
  await waitForPrice(page);
  await expectView(page, 'front');

  const tab = (n: number) => page.getByRole('group', { name: 'Комплекты' }).locator(`[data-kit-tab="${n}"]`);
  await tab(2).click();
  await expectView(page, 'top');
  await tab(3).click();
  await expectView(page, 'front');
  // Front chosen explicitly on the corner kit, then away and back: arriving
  // at a kit with corners is a corner appearing on screen again.
  await tab(2).click();
  await expectView(page, 'top');
  await frontButton(page).click();
  await tab(1).click();
  await expectView(page, 'front');
  await tab(2).click();
  await expectView(page, 'top');
  // Each kit kept its own corners.
  const corners = (await storedWorkspace(page))!.kits.map((k) => k.configuration.sections.map((s) => s.corner));
  expect(corners).toEqual([['NONE'], ['LEFT', 'NONE'], ['NONE']]);
});

test('reset returns a corner kit to the default straight rack in the front view', async ({ page }) => {
  await page.goto(`/ru/configurator?${configurationToShareQuery(LEFT_AND_RIGHT)}`);
  await waitForPrice(page);
  await expectView(page, 'top');
  await page.getByRole('button', { name: 'Сбросить настройки', exact: true }).click();
  await expect.poll(async () => (await storedSections(page)).map((s) => [s.width, s.height, s.shelves, s.corner])).toEqual([[1000, 2000, 5, 'NONE']]);
  await expectView(page, 'front');
  // A top view chosen explicitly is also reset to the default.
  await topButton(page).click();
  await expectView(page, 'top');
  await page.getByRole('button', { name: 'Сбросить настройки', exact: true }).click();
  await expectView(page, 'front');
});

test('the automatic and the manual view switches never request a price', async ({ page }) => {
  await page.goto(`/ru/configurator?${configurationToShareQuery(LEFT_AND_RIGHT)}`);
  await waitForPrice(page);
  const requests: string[] = [];
  page.on('request', (r) => r.url().includes('/api/pricing/calculate') && requests.push(r.url()));
  await frontButton(page).click();
  await topButton(page).click();
  await frontButton(page).click();
  await page.waitForTimeout(700); // longer than the pricing debounce
  expect(requests).toEqual([]);
});
