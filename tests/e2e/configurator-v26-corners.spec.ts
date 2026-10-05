import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './helpers/admin-order-fixtures';
import { checkoutFixturePrefix, checkoutIdentity, isolateOrderRequests, removeCheckoutFixtures } from './helpers/checkout-order-fixtures';
import { sectionButtons, selectSection, storedSections, storedWorkspace } from './helpers/sections';
import { configurationToShareQuery, workspaceToShareQuery } from '../../src/lib/configurator/url';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '../../src/lib/types/domain';

/**
 * Configurator V2.6 — corner sections in the real browser, on both projects
 * (desktop 1280 and Pixel 7), against the real server and catalog: the
 * section-level orientation control (valid choices only), a corner priced
 * exactly like the straight rack, the corner drawing inside the frame, the
 * corner width drag along the rotated axis, v4 links and the KZ/RU switch,
 * the top view a corner selects on its own (2026-10-01) and its real corner
 * plan, add to cart and checkout with a server re-price.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
let prisma: PrismaClient | undefined;
let prefix: string;

test.beforeAll(({}, testInfo) => {
  prefix = checkoutFixturePrefix('CORNERS', testInfo.project.name, testInfo.repeatEachIndex);
  if (hasDatabase) prisma = createPrismaClient();
});

test.afterAll(async () => {
  if (!prisma) return;
  await removeCheckoutFixtures(prisma, prefix);
  await prisma.$disconnect();
});

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function waitForPrice(page: Page, addLabel: RegExp = /^Добавить (все )?в корзину$/) {
  await expect(page.getByRole('button', { name: addLabel })).toBeEnabled({ timeout: 20_000 });
}

async function barTotal(page: Page): Promise<number> {
  const price = page.locator('.price-flash').first();
  await expect(price).toBeVisible({ timeout: 20_000 });
  return Number((await price.innerText()).replace(/\D/g, ''));
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const section = (width: number, height: number, shelves: number, corner: SectionCorner = 'NONE', extra: Partial<ShelvingSection> = {}): ShelvingSection => ({
  id: `${width}-${height}-${shelves}-${corner}`,
  width,
  height,
  shelves,
  rearWall: false,
  leftWall: false,
  rightWall: false,
  corner,
  ...extra,
});

function kit(sections: ShelvingSection[], overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
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
    ...overrides,
  };
}

const FIVE_WITH_BOTH = kit([
  section(1500, 2500, 8, 'LEFT', { rearWall: true }),
  section(700, 1000, 2),
  section(1000, 1800, 6),
  section(1200, 2200, 4),
  section(1000, 1500, 3, 'RIGHT', { leftWall: true }),
]);
const straightened = (cfg: ShelvingConfiguration) => ({ ...cfg, sections: cfg.sections.map((s) => ({ ...s, corner: 'NONE' as const })) });

/** A corner opens in the top view (2026-10-01); the customer can always
 * choose the front view, which is where the uprights and drag handles are. */
async function showFrontView(page: Page) {
  const top = page.getByRole('button', { name: 'Вид сверху', exact: true });
  await expect(top).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Вид спереди', exact: true }).click();
  await expect(page.getByTestId('preview-stage')).toBeVisible();
}

/** Every upright drawn by the preview lies inside the visible workspace frame. */
async function rackInsideFrame(page: Page) {
  const frame = (await page.locator('.configurator-frame-box').first().boundingBox())!;
  const boxes = await page.locator('[data-testid="preview-stage"] rect[data-upright]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.x0).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(b.x1).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(b.y0).toBeGreaterThanOrEqual(frame.y - 0.5);
    expect(b.y1).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  }
}

test('the orientation control offers only valid choices; choosing a corner keeps the price', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/ru/configurator?${configurationToShareQuery(kit([section(1000, 2000, 5), section(1000, 2000, 5), section(1000, 2000, 5)]))}`);
  await expect(sectionButtons(page)).toHaveCount(3);
  await waitForPrice(page);
  const straightTotal = await barTotal(page);

  await selectSection(page, 2);
  await expect(page.locator('select[aria-label="Расположение секции 2"]')).toHaveCount(0); // middle: straight only
  await selectSection(page, 3);
  const last = page.locator('select[aria-label="Расположение секции 3"]');
  await expect(last.locator('option')).toHaveText(['Прямая', 'Угол справа']);
  await selectSection(page, 1);
  const first = page.locator('select[aria-label="Расположение секции 1"]');
  await expect(first.locator('option')).toHaveText(['Прямая', 'Угол слева']);
  await first.selectOption({ label: 'Угол слева' });
  await expect.poll(async () => (await storedSections(page)).map((s) => s.corner)).toEqual(['LEFT', 'NONE', 'NONE']);

  await waitForPrice(page);
  expect(await barTotal(page)).toBe(straightTotal);
  // Section 1's own column names its orientation; the new corner opened the
  // top view with its real plan.
  await expect(page.locator('[data-section-column="1"] select[aria-label="Расположение секции 1"]')).toHaveValue('LEFT');
  await expect(page.getByTestId('top-view-corner-plan')).toBeVisible();
  await showFrontView(page);
  await expect(page.getByTestId('preview-stage')).toContainText('↗ 1000');
  await rackInsideFrame(page);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('five sections with both corners: priced like the straight rack, drawn inside the frame, no page overflow', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/ru/configurator?${configurationToShareQuery(straightened(FIVE_WITH_BOTH))}`);
  await waitForPrice(page);
  const straightTotal = await barTotal(page);

  await page.goto(`/ru/configurator?${configurationToShareQuery(FIVE_WITH_BOTH)}`);
  await expect(sectionButtons(page)).toHaveCount(5);
  await waitForPrice(page);
  expect(await barTotal(page)).toBe(straightTotal);
  expect((await storedSections(page)).map((s) => s.corner)).toEqual(['LEFT', 'NONE', 'NONE', 'NONE', 'RIGHT']);
  await showFrontView(page);
  const stage = page.getByTestId('preview-stage');
  await expect(stage).toContainText('↗ 1500');
  await expect(stage).toContainText('↗ 1000');
  // Each of the five sections draws its own four uprights.
  await expect(stage.locator('rect[data-upright]')).toHaveCount(20);
  await rackInsideFrame(page);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('a corner width drag follows the receding axis and commits one supported width', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/ru/configurator?${configurationToShareQuery(kit([section(1000, 2000, 5), section(1000, 2000, 5, 'RIGHT')]))}`);
  await waitForPrice(page);
  await showFrontView(page);
  await selectSection(page, 2);
  const handle = page.locator('button[data-axis="width"]');
  await expect(handle).toBeVisible();
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  let pricingRequests = 0;
  page.on('request', (r) => r.url().includes('/api/pricing/calculate') && (pricingRequests += 1));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Up and to the right — the drawing's receding direction.
  await page.mouse.move(start.x + 30, start.y - 25, { steps: 10 });
  const mid = (await handle.boundingBox())!;
  expect(mid.x + mid.width / 2).toBeGreaterThan(start.x + 5); // moved with the pointer, along the diagonal
  expect(mid.y + mid.height / 2).toBeLessThan(start.y - 5);
  await page.mouse.move(start.x + 60, start.y - 50, { steps: 10 });
  expect(pricingRequests).toBe(0); // no pricing while dragging
  await page.mouse.up();

  await expect.poll(async () => (await storedSections(page))[1].width).toBeGreaterThan(1000);
  const [, cornerSection] = await storedSections(page);
  expect([1200, 1500]).toContain(cornerSection.width);
  expect(cornerSection.corner).toBe('RIGHT');
  expect((await storedWorkspace(page))!.kits[0].configuration.depth).toBe(400); // depth never swapped in
  await waitForPrice(page);
  await rackInsideFrame(page);
  expect(errors).toEqual([]);
});

test('v4 links and the KZ/RU switch carry every corner of every kit; the top view draws them', async ({ page }) => {
  const errors = trackErrors(page);
  const second = kit([section(1200, 2000, 5, 'RIGHT')]);
  await page.goto(`/ru/configurator?${workspaceToShareQuery([FIVE_WITH_BOTH, second], 0)}`);
  await waitForPrice(page, /^Добавить все в корзину$/);
  const ruTotal = await barTotal(page);
  const cornersOf = async () =>
    (await storedWorkspace(page))!.kits.map((k) => k.configuration.sections.map((s) => s.corner));
  expect(await cornersOf()).toEqual([['LEFT', 'NONE', 'NONE', 'NONE', 'RIGHT'], ['RIGHT']]);

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/ru')),
    page.getByTestId('language-switcher').getByRole('link', { name: 'KZ', exact: true }).click(),
  ]);
  await waitForPrice(page, /^(Барлығын себетке қосу|Себетке қосу)$/);
  expect(await cornersOf()).toEqual([['LEFT', 'NONE', 'NONE', 'NONE', 'RIGHT'], ['RIGHT']]);
  expect(await barTotal(page)).toBe(ruTotal);

  // The kit on screen has corners, so the reloaded page opens in the top
  // view, drawing the real corner plan.
  await expect(page.getByRole('button', { name: 'Үстінен қарағандағы көрініс' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('top-view-corner-plan')).toBeVisible();
  await expect(page.getByTestId('top-view-corner-plan').locator('[data-plan-section]')).toHaveCount(5);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('add all to cart and check out: corners arrive exactly and the server re-prices the order', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await isolateOrderRequests(page, prefix, testInfo);
  await page.goto(`/ru/configurator?${workspaceToShareQuery([FIVE_WITH_BOTH, kit([section(1000, 2000, 5, 'LEFT')])], 0)}`);
  await waitForPrice(page, /^Добавить все в корзину$/);
  const total = await barTotal(page);
  await page.getByRole('button', { name: 'Добавить все в корзину' }).click();
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items);
  expect(cart.map((i: { configuration: { sections: { corner: string }[] } }) => i.configuration.sections.map((s) => s.corner))).toEqual([
    ['LEFT', 'NONE', 'NONE', 'NONE', 'RIGHT'],
    ['LEFT'],
  ]);

  await page.goto('/ru/order');
  const identity = checkoutIdentity(prefix, testInfo);
  await page.getByLabel('ФИО / Контактное лицо').fill(identity.fullName);
  await page.getByLabel('Телефон *', { exact: true }).fill(identity.phone);
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Город').fill('Алматы');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/orders') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /Подтвердить заказ/ }).click(),
  ]);
  const body = await response.json();
  expect(response.status()).toBe(201);
  expect(body.data?.grandTotal ?? body.grandTotal).toBe(total);
  await expect(page).toHaveURL(/\/order\/success/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
