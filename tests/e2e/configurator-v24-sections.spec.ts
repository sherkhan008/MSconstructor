import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { sectionButton, sectionButtons, storedSections } from './helpers/sections';

/**
 * Configurator V2.4 — final page structure and per-section controls, in the
 * real browser, on both projects (desktop 1280 and Pixel 7):
 *  - page order: rack → kit → sections → characteristics → additional
 *    parameters → kit contents → price/actions;
 *  - the active section's own controls edit that section only, with its own
 *    limits, and the preview's height handle / shelf column follow it;
 *  - mixed configurations are priced from every section's own values;
 *  - no horizontal scroll, readable labels, no console errors.
 */

const MIXED2 = '?v=2&model=ms-standard&depth=400&sections=1000:1500:4:0:0:0,1200:2500:8:0:0:0';
const MIXED5 =
  '?v=2&model=ms-standard&depth=400&sections=700:1000:2:0:0:0,1000:1500:4:1:0:0,1200:2000:6:0:1:0,1500:2500:8:0:0:0,1000:3000:5:0:0:1';

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function waitForPrice(page: Page) {
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeEnabled({ timeout: 15_000 });
}

async function openMixed(page: Page, query: string, count: number) {
  await page.goto(`/ru/configurator${query}`);
  await expect(sectionButtons(page)).toHaveCount(count);
  await expect.poll(async () => (await storedSections(page)).length).toBe(count);
}

test('the page follows the V2.4/V2.5 order: rack, kit switcher, kit, sections, characteristics, options, contents, price', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/ru/configurator');
  await waitForPrice(page);

  const order = await page.evaluate(() => {
    const byText = (selector: string, text: string) =>
      Array.from(document.querySelectorAll(selector)).find((el) => el.textContent?.trim().startsWith(text)) ?? null;
    const nodes = [
      document.querySelector('[data-testid="preview-stage"]'),
      byText('h2', 'Комплект 1'),
      byText('h3', 'Секции'),
      byText('h2', 'Характеристики'),
      byText('button', 'Дополнительные параметры'),
      byText('h2', 'Состав комплекта'),
      byText('button', 'Оформить заказ'),
    ];
    if (nodes.some((n) => !n)) return nodes.map((n) => Boolean(n));
    return nodes.every((n, i) => i === 0 || nodes[i - 1]!.compareDocumentPosition(n!) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  // V2.5: the kit switcher sits between the rack and the kit's parameters,
  // holding the one kit plus "+ Комплект".
  const switcher = page.getByRole('group', { name: 'Комплекты' });
  await expect(switcher.getByRole('button', { name: /^Комплект \d/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Добавить комплект' })).toBeEnabled();
  const switcherFirst = await page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="Комплекты"]');
    const stage = document.querySelector('[data-testid="preview-stage"]');
    const heading = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent?.trim() === 'Комплект 1');
    return Boolean(
      group && stage && heading &&
        stage.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING &&
        group.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(switcherFirst).toBe(true);
  expect(errors).toEqual([]);
});

test('a mixed rack: each section edits only itself, with its own limits', async ({ page }) => {
  const errors = trackErrors(page);
  await openMixed(page, MIXED2, 2);

  // Section 1 is active: its own values.
  await expect(page.locator('select[aria-label="Ширина секции 1"]')).toHaveValue('1000');
  await expect(page.locator('select[aria-label="Высота секции 1"]')).toHaveValue('1500');
  await expect(page.getByTestId('shelf-count')).toHaveText('4');
  await expect(page.locator('button[data-axis="height"]')).toHaveAttribute('aria-valuenow', '1500');

  // Height of section 1 → section 2 untouched.
  await page.locator('select[aria-label="Высота секции 1"]').selectOption('1800');
  await expect.poll(async () => (await storedSections(page)).map((s) => [s.width, s.height, s.shelves])).toEqual([
    [1000, 1800, 4],
    [1200, 2500, 8],
  ]);

  // Shelves of section 1 → up to ITS ceiling (1800 mm → 6), section 2 untouched.
  const increase = page.getByRole('button', { name: 'Увеличить', exact: true });
  await increase.click();
  await increase.click();
  await expect(page.getByTestId('shelf-count')).toHaveText('6');
  await expect(increase).toBeDisabled();
  expect((await storedSections(page)).map((s) => s.shelves)).toEqual([6, 8]);

  // Section 2 becomes active: its own controls, its own limits.
  await sectionButton(page, 2).click();
  await expect(sectionButton(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('select[aria-label="Высота секции 2"]')).toHaveValue('2500');
  await expect(page.getByTestId('shelf-count')).toHaveText('8');
  await expect(increase).toBeDisabled();
  const heightOptions = await page
    .locator('select[aria-label="Высота секции 2"] option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(heightOptions).toEqual(['2000', '2200', '2500', '3000']);
  await expect(page.locator('button[data-axis="height"]')).toHaveAttribute('aria-valuenow', '2500');

  // The preview's shelf column acts on the active section (section 2) only.
  const previewShelves = page.getByRole('group', { name: 'Полки · Секция 2' });
  await previewShelves.getByRole('button', { name: 'Уменьшить количество полок' }).click();
  await expect.poll(async () => (await storedSections(page)).map((s) => s.shelves)).toEqual([6, 7]);
  expect(errors).toEqual([]);
});

test('pressing another section’s upright selects and resizes that section; hovering never changes the selection', async ({ page, isMobile }) => {
  await openMixed(page, MIXED2, 2);
  await sectionButton(page, 2).click();
  await expect(sectionButton(page, 2)).toHaveAttribute('aria-pressed', 'true');

  const zone = page.locator('[data-testid="width-resize-zone"][data-section-index="0"]');
  await zone.scrollIntoViewIfNeeded();
  const box = (await zone.boundingBox())!;
  const x = box.x + box.width / 2;
  // A point the zone itself owns (no on-rack control floating over it).
  let y = box.y + box.height * 0.85;
  for (const f of [0.85, 0.75, 0.95, 0.6, 0.4, 0.2]) {
    const candidate = box.y + box.height * f;
    const owned = await page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el?.getAttribute('data-testid') === 'width-resize-zone' && el.getAttribute('data-section-index') === '0';
      },
      [x, candidate] as const,
    );
    if (owned) {
      y = candidate;
      break;
    }
  }
  if (!isMobile) {
    // Passing over section 1's upright is not a selection.
    await page.mouse.move(x, y);
    await expect(sectionButton(page, 2)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 8 });
  await page.mouse.up();

  await expect(sectionButton(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await storedSections(page))[0].width).not.toBe(1000);
  expect((await storedSections(page))[1].width).toBe(1200);
});

test('add copies the active section; duplicate copies it with walls and a new id; never a sixth section', async ({ page }) => {
  await openMixed(page, '?v=2&model=ms-standard&depth=400&sections=1000:1500:4:1:0:0,1200:2500:8:0:0:0', 2);

  await sectionButton(page, 2).click();
  await page.getByRole('button', { name: 'Добавить секцию', exact: true }).click();
  await expect(sectionButtons(page)).toHaveCount(3);
  let sections = await storedSections(page);
  expect([sections[2].width, sections[2].height, sections[2].shelves]).toEqual([1200, 2500, 8]);
  await expect(sectionButton(page, 3)).toHaveAttribute('aria-pressed', 'true');

  await sectionButton(page, 1).click();
  await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(sectionButtons(page)).toHaveCount(4);
  sections = await storedSections(page);
  const { id: aId, ...a } = sections[0];
  const { id: bId, ...b } = sections[1];
  expect(b).toEqual(a);
  expect(bId).not.toBe(aId);

  await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(sectionButtons(page)).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Дублировать', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Добавить секцию', exact: true })).toBeDisabled();
  expect(await storedSections(page)).toHaveLength(5);
});

test('a mixed rack is priced from every section’s own width, height and shelves', async ({ page }) => {
  const bodies: { sections: { width: number; height: number; shelves: number }[] }[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/pricing/calculate') && request.method() === 'POST') bodies.push(request.postDataJSON());
  });
  await openMixed(page, MIXED2, 2);
  await waitForPrice(page);
  const total = await page.locator('.price-flash').first().innerText();

  await page.locator('select[aria-label="Высота секции 1"]').selectOption('2000');
  await expect.poll(async () => page.locator('.price-flash').first().innerText(), { timeout: 15_000 }).not.toBe(total);
  await waitForPrice(page);
  const last = bodies[bodies.length - 1];
  expect(last.sections.map((s) => [s.width, s.height, s.shelves])).toEqual([
    [1000, 2000, 4],
    [1200, 2500, 8],
  ]);
});

test('five mixed sections: readable labels, no horizontal scroll, sticky price bar usable', async ({ page, isMobile }) => {
  const errors = trackErrors(page);
  await openMixed(page, MIXED5, 5);
  await waitForPrice(page);

  const layout = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="preview-stage"] svg')!;
    const unitPx = svg.getBoundingClientRect().width / 640;
    const labelPx = Array.from(svg.querySelectorAll('text')).map((t) => Number(t.getAttribute('font-size')) * unitPx);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallestLabelPx: Math.min(...labelPx),
      labels: labelPx.length,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.smallestLabelPx).toBeGreaterThanOrEqual(10.9);
  // Height, every section width and the total are still drawn.
  expect(layout.labels).toBeGreaterThanOrEqual(7);

  const checkout = page.getByRole('button', { name: 'Оформить заказ' });
  await expect(page.locator('.price-flash').first()).toBeInViewport();
  await expect(checkout).toBeInViewport();
  if (isMobile) {
    // The compact bar stays pinned while the customer scrolls the controls.
    await page.getByRole('heading', { name: 'Характеристики' }).scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
    await expect(page.locator('.price-flash').first()).toBeInViewport();
  }
  expect(errors).toEqual([]);
});

test('on narrow sections the height handle keeps a full touch target clear of every "+" and the shelf "+"', async ({ page }) => {
  const racks = [
    MIXED5,
    '?v=2&model=ms-standard&depth=800&sections=700:1000:2:0:0:0,700:1000:2:0:0:0,700:1000:2:0:0:0,700:1000:2:0:0:0,700:1000:2:0:0:0',
  ];
  for (const query of racks) {
    await openMixed(page, query, 5);
    for (let n = 1; n <= 5; n += 1) {
      await sectionButton(page, n).click();
      await expect(sectionButton(page, n)).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-testid="preview-stage"]').scrollIntoViewIfNeeded();
      const d = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="preview-stage"]')!;
        const centre = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
        const height = centre(stage.querySelector('button[data-axis="height"]')!);
        const width = centre(stage.querySelector('button[data-axis="width"]')!);
        const adds = Array.from(stage.querySelectorAll('button[aria-label^="Добавить секцию после"]')).map(centre);
        const shelfPlus = centre(stage.querySelector('button[aria-label="Увеличить количество полок"]')!);
        return {
          add: Math.min(...adds.map((a) => dist(height, a))),
          shelfPlus: dist(height, shelfPlus),
          width: dist(height, width),
        };
      });
      // 44 px centre to centre: the two 44 px touch targets do not overlap.
      expect(d.add, `${query} section ${n}: height handle ↔ "+"`).toBeGreaterThanOrEqual(43.5);
      expect(d.shelfPlus, `${query} section ${n}: height handle ↔ shelf "+"`).toBeGreaterThanOrEqual(43.5);
      // The two 18 px resize discs never overlap, even on a short narrow section.
      expect(d.width, `${query} section ${n}: height ↔ width handle`).toBeGreaterThanOrEqual(24);
    }
  }
});
