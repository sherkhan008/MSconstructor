import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './helpers/admin-order-fixtures';
import { checkoutFixturePrefix, checkoutIdentity, isolateOrderRequests, removeCheckoutFixtures } from './helpers/checkout-order-fixtures';
import { sectionButtons, storedWorkspace } from './helpers/sections';
import { workspaceToShareQuery } from '../../src/lib/configurator/url';
import type { ShelvingConfiguration, ShelvingSection } from '../../src/lib/types/domain';

/**
 * Configurator V2.5 — the multi-kit workspace in the real browser, on both
 * projects (desktop 1280 and Pixel 7), against the real server and catalog:
 * the kit switcher, independent kits with their own active section, the
 * Σ quantity ≤ 5 rack limit, zero pricing requests on kit/preview switches,
 * "add all to cart" (atomic) through checkout with server re-pricing, v3
 * workspace links, old single-kit links, and the KZ/RU switch.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
let prisma: PrismaClient | undefined;
let prefix: string;

test.beforeAll(({}, testInfo) => {
  prefix = checkoutFixturePrefix('WORKSPACE', testInfo.project.name, testInfo.repeatEachIndex);
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

const switcher = (page: Page) => page.getByRole('group', { name: 'Комплекты' });
const kitTabs = (page: Page) => switcher(page).getByRole('button', { name: /^Комплект \d/ });
const kitTab = (page: Page, n: number) => switcher(page).getByRole('button', { name: new RegExp(`^Комплект ${n}\\b`) });
const addKit = (page: Page) => page.getByRole('button', { name: 'Добавить комплект' });
/** The preview's own per-section hit areas — one per section of the kit it draws. */
const previewSections = (page: Page) => page.getByTestId('preview-stage').getByRole('button', { name: /^Секция \d+, ширина/ });

/** Waits until every kit has a current server price (the purchase actions enable). */
async function waitForPrices(page: Page, addLabel: RegExp = /^Добавить (все )?в корзину$/) {
  await expect(page.getByRole('button', { name: addLabel })).toBeEnabled({ timeout: 20_000 });
}

/** The purchase card's total, digits only. */
async function barTotal(page: Page): Promise<number> {
  const price = page.locator('.price-flash').first();
  await expect(price).toBeVisible({ timeout: 20_000 });
  return Number((await price.innerText()).replace(/\D/g, ''));
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

const section = (width: number, height: number, shelves: number, walls: Partial<ShelvingSection> = {}): ShelvingSection => ({
  id: `${width}-${height}-${shelves}`,
  width,
  height,
  shelves,
  rearWall: false,
  leftWall: false,
  rightWall: false,
  ...walls,
});

function kit(overrides: Partial<ShelvingConfiguration>): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections: [section(1000, 2000, 5)],
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

const LINKED_KITS = [
  kit({ sections: [section(1000, 1500, 4, { rearWall: true }), section(1200, 2500, 8)], quantity: 2 }),
  kit({ sections: [section(700, 1000, 2), section(1000, 2000, 5, { leftWall: true }), section(1000, 3000, 6)], accessories: [] }),
  kit({ sections: [section(1000, 2000, 5)], metalFootPad: true }),
];

test('kits are independent: switch, per-kit controls and preview, each kit remembers its active section', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/ru/configurator');
  await waitForPrices(page);
  await expect(kitTabs(page)).toHaveCount(1);

  // Kit 1: two sections, section 2 active, section 1 at 1500 mm.
  await page.locator('select[aria-label="Высота секции 1"]').selectOption('1500');
  await page.getByRole('button', { name: 'Добавить секцию', exact: true }).click();
  await expect(sectionButtons(page)).toHaveCount(2);
  await expect(page.locator('select[aria-label="Ширина секции 2"]')).toBeVisible();

  // Kit 2 starts from the default rack and becomes the active kit.
  await addKit(page).click();
  await expect(kitTabs(page)).toHaveCount(2);
  await expect(kitTab(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(kitTab(page, 1)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: 'Комплект 2', exact: true })).toBeVisible();
  await expect(sectionButtons(page)).toHaveCount(1);
  await expect(previewSections(page)).toHaveCount(1);
  await expect(page.locator('select[aria-label="Высота секции 1"]')).toHaveValue('2000');
  await page.locator('select[aria-label="Высота секции 1"]').selectOption('2500');

  // The active kit is obvious: filled, unlike the others.
  const [activeBg, idleBg] = await Promise.all([
    kitTab(page, 2).evaluate((el) => getComputedStyle(el).backgroundColor),
    kitTab(page, 1).evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(activeBg).not.toBe(idleBg);

  // Back to kit 1: its own sections, values, preview and active section 2.
  await kitTab(page, 1).click();
  await expect(kitTab(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(sectionButtons(page)).toHaveCount(2);
  await expect(previewSections(page)).toHaveCount(2);
  await expect(page.locator('select[aria-label="Ширина секции 2"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Секция 1', exact: true })).toContainText('1500');

  await kitTab(page, 2).click();
  await expect(page.locator('select[aria-label="Высота секции 1"]')).toHaveValue('2500');

  const workspace = (await storedWorkspace(page))!;
  expect(workspace.kits).toHaveLength(2);
  expect(workspace.kits[0].configuration.sections.map((s) => s.height)).toEqual([1500, 1500]);
  expect(workspace.kits[1].configuration.sections.map((s) => s.height)).toEqual([2500]);
  expect(workspace.activeKitId).toBe(workspace.kits[1].id);
  await waitForPrices(page);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('switching kits or the preview mode sends no pricing request', async ({ page }) => {
  await page.goto('/ru/configurator');
  await waitForPrices(page);
  await addKit(page).click();
  await waitForPrices(page);
  await page.waitForTimeout(800);

  let requests = 0;
  page.on('request', (r) => r.url().includes('/api/pricing/calculate') && requests++);
  for (let i = 0; i < 3; i += 1) {
    await kitTab(page, 1).click();
    await kitTab(page, 2).click();
  }
  await page.getByRole('button', { name: 'Вид сверху' }).click();
  await kitTab(page, 1).click();
  await page.getByRole('button', { name: 'Вид спереди' }).click();
  await page.waitForTimeout(1000);
  expect(requests).toBe(0);
  await waitForPrices(page);
});

test('Σ quantity ≤ 5: the kit quantity and "+ Комплект" stop at five racks', async ({ page }) => {
  await page.goto('/ru/configurator');
  await waitForPrices(page);
  await page.getByRole('button', { name: 'Увеличить количество', exact: true }).click(); // kit 1 × 2
  await addKit(page).click();
  const plus = page.getByRole('button', { name: 'Увеличить количество', exact: true });
  await plus.click();
  await plus.click(); // kit 2 × 3 → 5 racks
  await expect(page.getByTestId('kit-quantity')).toHaveText('3');
  await expect(plus).toBeDisabled();
  await expect(addKit(page)).toBeDisabled();
  await expect(page.getByText('В одном заказе можно оформить не более 5 стеллажей.').first()).toBeVisible();
  // 3 + 3 is unreachable: kit 1 cannot grow either.
  await kitTab(page, 1).click();
  await expect(page.getByTestId('kit-quantity')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'Увеличить количество', exact: true })).toBeDisabled();
  await expect.poll(async () => (await storedWorkspace(page))!.kits.map((k) => k.configuration.quantity)).toEqual([2, 3]);
  await waitForPrices(page);
});

test('five kits: the switcher wraps without page overflow and every tab is a 44px target', async ({ page }) => {
  await page.goto('/ru/configurator');
  await waitForPrices(page);
  for (let i = 0; i < 4; i += 1) await addKit(page).click();
  await expect(kitTabs(page)).toHaveCount(5);
  await expect(addKit(page)).toHaveCount(0);
  await expect(page.getByText('В конфигураторе не более 5 комплектов.')).toBeVisible();
  for (let n = 1; n <= 5; n += 1) {
    const box = (await kitTab(page, n).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await kitTab(page, 3).click();
  await expect(kitTab(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Удалить комплект' }).click();
  await expect(kitTabs(page)).toHaveCount(4);
  // The kit that took its place is now active.
  await expect(kitTab(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await noHorizontalScroll(page);
  await waitForPrices(page);
});

test('add all kits to the cart and check out: every kit arrives exactly, the server re-prices the order', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await isolateOrderRequests(page, prefix, testInfo);
  await page.goto(`/ru/configurator?${workspaceToShareQuery(LINKED_KITS, 0)}`);
  await expect(kitTabs(page)).toHaveCount(3);
  await waitForPrices(page);
  const workspaceTotal = await barTotal(page);
  await expect(page.getByText('Итого за все комплекты')).toBeVisible();

  await page.getByRole('button', { name: 'Добавить все в корзину' }).click();
  const workspace = (await storedWorkspace(page))!;
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items);
  expect(cart).toHaveLength(3);
  expect(cart.map((i: { configuration: unknown }) => i.configuration)).toEqual(workspace.kits.map((k) => k.configuration));

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
  // The server's own re-priced total equals the workspace total shown.
  expect(body.data?.grandTotal ?? body.grandTotal).toBe(workspaceTotal);
  await expect(page).toHaveURL(/\/order\/success/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('no partial add: a cart without room for every kit keeps nothing from the workspace', async ({ page }) => {
  await page.goto('/ru/configurator');
  await waitForPrices(page);
  await page.getByRole('button', { name: 'Увеличить количество', exact: true }).click();
  await page.getByRole('button', { name: 'Увеличить количество', exact: true }).click(); // × 3
  await waitForPrices(page);
  await page.getByRole('button', { name: 'Добавить в корзину' }).click(); // cart: 3 racks
  await addKit(page).click(); // workspace: 3 + 1 = 4 racks, cart has room for 2
  await expect(page.getByTestId('configurator-kit-limit')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Добавить все в корзину' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Оформить заказ' })).toBeDisabled();
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items);
  expect(cart).toHaveLength(1);
});

test('a v3 workspace link restores every kit and the active kit; KZ/RU switch carries the whole workspace', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/ru/configurator?${workspaceToShareQuery(LINKED_KITS, 1)}`);
  await expect(kitTabs(page)).toHaveCount(3);
  await expect(kitTab(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(sectionButtons(page)).toHaveCount(3);
  await waitForPrices(page);
  const ruTotal = await barTotal(page);

  const stripIds = (kits: { configuration: Record<string, unknown> & { sections: { id: string }[] } }[]) =>
    kits.map((k) => ({ ...k.configuration, sections: k.configuration.sections.map(({ id: _id, ...rest }) => rest) }));
  const before = (await storedWorkspace(page))!;
  expect(stripIds(before.kits).map((k) => k.sections)).toEqual(LINKED_KITS.map((k) => k.sections.map(({ id: _id, ...rest }) => rest)));

  // RU → KZ: the switch link carries v=3, the active kit and every kit.
  const switcherLinks = page.getByTestId('language-switcher');
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/ru')), switcherLinks.getByRole('link', { name: 'KZ', exact: true }).click()]);
  const url = new URL(page.url());
  expect(url.searchParams.get('v')).toBe('3');
  expect(url.searchParams.get('active')).toBe('2');
  expect(['k1', 'k2', 'k3'].every((k) => url.searchParams.has(k))).toBe(true);
  const kkSwitcher = page.getByRole('group', { name: 'Жинақтар' });
  await expect(kkSwitcher.getByRole('button', { name: /^\d-жинақ/ })).toHaveCount(3);
  await expect(kkSwitcher.getByRole('button', { name: /^2-жинақ/ })).toHaveAttribute('aria-pressed', 'true');
  await waitForPrices(page, /^(Барлығын себетке қосу|Себетке қосу)$/);
  expect(await barTotal(page)).toBe(ruTotal);
  const after = (await storedWorkspace(page))!;
  expect(stripIds(after.kits)).toEqual(stripIds(before.kits));
  expect(errors).toEqual([]);
});

test('an old single-kit (v2) link opens as a one-kit workspace; a malformed v3 link changes nothing', async ({ page }) => {
  await page.goto('/ru/configurator?v=2&model=ms-standard&depth=400&sections=1000:1500:4:0:0:0,1200:2500:8:0:0:0&qty=2');
  await expect(kitTabs(page)).toHaveCount(1);
  await expect(sectionButtons(page)).toHaveCount(2);
  await expect(page.getByTestId('kit-quantity')).toHaveText('2');
  await waitForPrices(page);

  await addKit(page).click();
  await expect(kitTabs(page)).toHaveCount(2);
  await page.goto('/ru/configurator?v=3&active=1&k1=garbage&k2=v%3D2');
  await expect(kitTabs(page)).toHaveCount(2); // the saved workspace is kept
  await waitForPrices(page);
});
