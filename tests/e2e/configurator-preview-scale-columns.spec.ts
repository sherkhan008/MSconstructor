import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { storedActiveConfiguration, storedWorkspace } from './helpers/sections';
import { configurationToShareQuery, workspaceToShareQuery } from '../../src/lib/configurator/url';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '../../src/lib/types/domain';

/**
 * 2026-10-01 owner requirements, in the real browser:
 *
 *  1. The rack is drawn ~30% larger than in the previously accepted
 *     workspace — display only: every physical value, the drawing's own
 *     proportions and the price stay exactly as they were. It still fits its
 *     frame (rack, labels, controls) from one section to five, with corners,
 *     and the page never scrolls sideways.
 *  2. Every section is its own column of its own controls, and the kit's one
 *     depth sits directly above them — once per kit, never per section.
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

const kit = (sections: ShelvingSection[], depth = 400): ShelvingConfiguration => ({
  modelSlug: 'ms-standard',
  depth,
  sections,
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId: 'delivery-pickup',
  quantity: 1,
});

const q = (config: ShelvingConfiguration) => `?${configurationToShareQuery(config)}`;
const ONE = kit([section(1000, 2000, 5)]);
const THREE_MIXED = kit([section(1000, 2000, 5), section(700, 1500, 4), section(1200, 2500, 7)]);
const FIVE = kit([section(1000, 2000, 5), section(700, 1000, 2), section(1200, 2500, 7), section(1500, 3000, 8), section(1000, 1800, 6)]);
const CORNERS = kit([section(1500, 2500, 8, 'LEFT'), section(1000, 2000, 5), section(1200, 2200, 6, 'RIGHT')]);

async function waitForPrice(page: Page) {
  await expect(page.getByRole('button', { name: /^Добавить (все )?в корзину$/ })).toBeEnabled({ timeout: 20_000 });
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

/** The drawn rack (every upright) in CSS px, and anything of the drawing —
 * uprights, dimension labels, rack controls — that crosses the frame edge. */
async function measureRack(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.configurator-frame-box')!.getBoundingClientRect();
    const rects = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
    const uprights = rects('[data-testid="preview-stage"] rect[data-upright]');
    const outside = (r: DOMRect) => r.left < frame.left - 0.5 || r.right > frame.right + 0.5 || r.top < frame.top - 0.5 || r.bottom > frame.bottom + 0.5;
    // A control's VISIBLE disc (its first span) — the 44px hit area may
    // overhang the frame edge by design.
    const discs = Array.from(document.querySelectorAll('.configurator-frame-box button'))
      .map((b) => (b.querySelector('span') ?? b).getBoundingClientRect())
      .filter((r) => r.width > 0);
    return {
      height: Math.max(...uprights.map((r) => r.bottom)) - Math.min(...uprights.map((r) => r.top)),
      width: Math.max(...uprights.map((r) => r.right)) - Math.min(...uprights.map((r) => r.left)),
      bottom: Math.max(...uprights.map((r) => r.bottom)),
      clippedUprights: uprights.filter(outside).length,
      clippedLabels: rects('.configurator-frame-box svg text').filter(outside).length,
      clippedDiscs: discs.filter(outside).length,
    };
  });
}

/** The previously accepted workspace: the same page with the display scale
 * at 1 — exactly the old frame cap (desktop/tablet). */
async function withLegacyScale(page: Page) {
  await page.addStyleTag({ content: '.configurator-frame { --preview-display-scale: 1 !important; }' });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const [width, height] of [
  [1280, 720],
  [1440, 900],
  [1536, 864],
  [1024, 768],
  [1180, 820],
] as const) {
  test(`desktop ${width}×${height}: the rack is ~30% larger than the accepted layout, physically unchanged and inside its frame`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop layout');
    await page.setViewportSize({ width, height });
    for (const [name, config] of [
      ['1 section', ONE],
      ['3 mixed sections', THREE_MIXED],
      ['5 sections', FIVE],
    ] as const) {
      await page.goto(`/ru/configurator${q(config)}`);
      await waitForPrice(page);
      const total = await page.locator('.price-flash').first().innerText();
      const now = await measureRack(page);
      expect(now, name).toMatchObject({ clippedUprights: 0, clippedLabels: 0, clippedDiscs: 0 });
      // The rack itself is in view on load.
      expect(now.bottom, name).toBeLessThanOrEqual(height);
      await noHorizontalScroll(page);

      await withLegacyScale(page);
      const before = await measureRack(page);
      const ratio = now.height / before.height;
      // ~1.3×; a wide row on a narrower screen is held to its panel width.
      expect(ratio, `${name} ${now.height} vs ${before.height}`).toBeGreaterThanOrEqual(name === '5 sections' ? 1.18 : 1.27);
      expect(ratio, name).toBeLessThanOrEqual(1.31);
      // Uniform: the drawing's own proportions do not change.
      expect(now.width / now.height, name).toBeCloseTo(before.width / before.height, 2);

      // Physical values and the price are exactly what the link set.
      const stored = await storedActiveConfiguration(page);
      expect(stored!.depth, name).toBe(config.depth);
      expect(stored!.sections.map((s) => [s.width, s.height, s.shelves]), name).toEqual(config.sections.map((s) => [s.width, s.height, s.shelves]));
      await expect(page.getByTestId('height-dimension-tag')).toHaveText(String(config.sections[0].height));
      expect(await page.locator('.price-flash').first().innerText(), name).toBe(total);
    }
  });
}

test('the rack fits its frame with corners and at every section count, on this device, without page overflow', async ({ page }) => {
  for (const config of [ONE, THREE_MIXED, FIVE, CORNERS]) {
    await page.goto(`/ru/configurator${q(config)}`);
    await waitForPrice(page);
    if (config === CORNERS) {
      // Corners open the top view: the plan lies inside the frame…
      const plan = await page.evaluate(() => {
        const frame = document.querySelector('.configurator-frame-box')!.getBoundingClientRect();
        const svg = document.querySelector('[data-testid="top-view-corner-plan"] svg')!.getBoundingClientRect();
        const texts = Array.from(document.querySelectorAll('[data-testid="top-view-corner-plan"] svg text')).map((t) => t.getBoundingClientRect());
        return [svg, ...texts].filter((r) => r.left < frame.left - 0.5 || r.right > frame.right + 0.5 || r.top < frame.top - 0.5 || r.bottom > frame.bottom + 0.5).length;
      });
      expect(plan).toBe(0);
      // …and so does the front view.
      await page.getByRole('button', { name: 'Вид спереди', exact: true }).click();
    }
    const rack = await measureRack(page);
    expect(rack).toMatchObject({ clippedUprights: 0, clippedLabels: 0 });
    await noHorizontalScroll(page);
  }
});

test('phones: a lone section is drawn 1.3× larger than the accepted phone frame allowed', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone framing');
  await page.goto(`/ru/configurator${q(ONE)}`);
  await waitForPrice(page);
  const frame = (await page.locator('.configurator-frame-box').boundingBox())!;
  // The accepted phone frame was width × 1/0.9 tall at most; it now takes
  // the extra height the larger drawing needs, at the same width.
  expect(frame.height / frame.width).toBeGreaterThan((1 / 0.9) * 1.25);
  const rack = await measureRack(page);
  expect(rack).toMatchObject({ clippedUprights: 0, clippedLabels: 0, clippedDiscs: 0 });
  await noHorizontalScroll(page);
});

/* ------------------------------------------------------------------------- */

test('every section is its own column of its own controls; the kit depth sits once, directly above them', async ({ page }) => {
  await page.goto(`/ru/configurator${q(THREE_MIXED)}`);
  await waitForPrice(page);
  const columns = page.locator('[data-section-column]');
  await expect(columns).toHaveCount(3);
  for (let n = 1; n <= 3; n += 1) {
    const col = page.locator(`[data-section-column="${n}"]`);
    const s = THREE_MIXED.sections[n - 1];
    await expect(col.getByRole('button', { name: `Секция ${n}`, exact: true })).toBeVisible();
    await expect(col.locator(`select[aria-label="Ширина секции ${n}"]`)).toHaveValue(String(s.width));
    await expect(col.locator(`select[aria-label="Высота секции ${n}"]`)).toHaveValue(String(s.height));
    await expect(col.getByTestId('shelf-count')).toHaveText(String(s.shelves));
    // Never another section's controls.
    for (let other = 1; other <= 3; other += 1)
      if (other !== n) await expect(col.locator(`select[aria-label="Ширина секции ${other}"]`)).toHaveCount(0);
  }

  // Depth: one control per kit, not inside any column, directly above them.
  const depth = page.getByRole('combobox', { name: /Глубина/ });
  await expect(depth).toHaveCount(1);
  await expect(depth).toHaveValue('400');
  await expect(page.getByTestId('kit-depth')).toContainText('Глубина комплекта');
  await expect(page.getByTestId('kit-depth')).toContainText('Одна для всех секций');
  await expect(columns.locator('select[aria-label*="Глубина"]')).toHaveCount(0);
  const depthBox = (await page.getByTestId('kit-depth').boundingBox())!;
  const firstBox = (await columns.first().boundingBox())!;
  expect(firstBox.y).toBeGreaterThanOrEqual(depthBox.y + depthBox.height);
  expect(firstBox.y - (depthBox.y + depthBox.height)).toBeLessThanOrEqual(24);

  // Editing section 2 changes section 2 only.
  await page.locator('[data-section-column="2"] select[aria-label="Высота секции 2"]').selectOption('1800');
  await page.locator('[data-section-column="2"]').getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect
    .poll(async () => (await storedActiveConfiguration(page))!.sections.map((s) => [s.width, s.height, s.shelves]))
    .toEqual([
      [1000, 2000, 5],
      [700, 1800, 5],
      [1200, 2500, 7],
    ]);
  // One depth for the kit: changing it changes no section.
  await depth.selectOption('500');
  await expect.poll(async () => (await storedActiveConfiguration(page))!.depth).toBe(500);
  expect((await storedActiveConfiguration(page))!.sections.every((s) => !('depth' in s))).toBe(true);
  await noHorizontalScroll(page);
});

test('desktop: five columns side by side at 1280 px, still usable; they wrap on a narrower screen', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/ru/configurator${q(FIVE)}`);
  await waitForPrice(page);
  const boxes = async () => page.locator('[data-section-column]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  let cols = await boxes();
  expect(cols).toHaveLength(5);
  expect(new Set(cols.map((c) => Math.round(c.top))).size).toBe(1); // one row
  for (const c of cols) expect(c.width).toBeGreaterThanOrEqual(200); // controls keep a usable width
  for (let i = 1; i < cols.length; i += 1) expect(cols[i].left).toBeGreaterThanOrEqual(cols[i - 1].right); // left → right, no overlap

  await page.setViewportSize({ width: 1024, height: 768 });
  cols = await boxes();
  expect(new Set(cols.map((c) => Math.round(c.top))).size).toBeGreaterThan(1); // wraps
  for (const c of cols) expect(c.width).toBeGreaterThanOrEqual(200);
  await noHorizontalScroll(page);
});

test('phones: section columns stack full-width, one under another', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto(`/ru/configurator${q(THREE_MIXED)}`);
  await waitForPrice(page);
  const cols = await page.locator('[data-section-column]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  // The list's content box: its width less its own side padding.
  const listContentWidth = await page
    .locator('[data-section-column]')
    .first()
    .locator('xpath=..')
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
  for (let i = 0; i < cols.length; i += 1) {
    expect(cols[i].width).toBeGreaterThanOrEqual(listContentWidth - 1);
    if (i > 0) expect(cols[i].top).toBeGreaterThanOrEqual(cols[i - 1].bottom);
  }
  await noHorizontalScroll(page);
});

test('each kit has its own columns and its own depth; editing one kit never touches another', async ({ page }) => {
  await page.goto(`/ru/configurator?${workspaceToShareQuery([THREE_MIXED, kit([section(1200, 2000, 5)], 500)], 0)}`);
  await waitForPrice(page);
  await expect(page.locator('[data-section-column]')).toHaveCount(3);
  const tab = (n: number) => page.getByRole('group', { name: 'Комплекты' }).locator(`[data-kit-tab="${n}"]`);
  await tab(2).click();
  await expect(page.locator('[data-section-column]')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: /Глубина/ })).toHaveValue('500');
  await page.locator('[data-section-column="1"] select[aria-label="Высота секции 1"]').selectOption('2500');
  await expect.poll(async () => (await storedActiveConfiguration(page))!.sections[0].height).toBe(2500);

  await tab(1).click();
  await expect(page.locator('[data-section-column]')).toHaveCount(3);
  await expect(page.getByRole('combobox', { name: /Глубина/ })).toHaveValue('400');
  const kits = (await storedWorkspace(page))!.kits;
  expect(kits[0].configuration.sections.map((s) => [s.width, s.height, s.shelves])).toEqual(THREE_MIXED.sections.map((s) => [s.width, s.height, s.shelves]));
  expect(kits[1].configuration.sections.map((s) => [s.width, s.height])).toEqual([[1200, 2500]]);
});
