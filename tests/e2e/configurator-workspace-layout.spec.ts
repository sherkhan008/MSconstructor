import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { storedSections } from './helpers/sections';
import { configurationToShareQuery, workspaceToShareQuery } from '../../src/lib/configurator/url';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '../../src/lib/types/domain';

/**
 * Layout guarantees of the configurator workspace redesign — sizes and
 * positions only; behaviour is covered by the other configurator specs.
 *
 * Mobile: the rack comes before the fixed purchase bar, the bar stays
 * compact, the two purchase buttons are ~48px (not oversized) and every
 * on-rack +/− keeps a 44px hit target around a smaller visible disc.
 * Desktop/tablet: the rack spans the content width with every control below
 * it, the whole rack is in view on load and the purchase bar — last in the
 * page, sticky at the bottom of the viewport through the controls — never
 * covers it. The reset action sits under the rack in both languages.
 */

const PURCHASE = { kk: ['Тапсырыс беру', 'Себетке қосу'], ru: ['Оформить заказ', 'Добавить в корзину'] };

async function waitForPrice(page: Page, addToCart: string) {
  await expect(page.getByRole('button', { name: addToCart, exact: true })).toBeEnabled({ timeout: 15_000 });
}

for (const width of [320, 375, 390, 430]) {
  test(`mobile ${width}px: rack first, compact purchase bar, 44px rack controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/configurator');
    const [checkout, addToCart] = PURCHASE.kk;
    await waitForPrice(page, addToCart);

    const rack = page.getByRole('img', { name: 'Стеллаждың алдынан қарағандағы көрінісінің сызбасы' });
    const bar = page.locator('.fixed.inset-x-0.bottom-0');
    const rackBox = (await rack.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    // The rack's own frame starts well above the purchase bar.
    expect(rackBox.y).toBeLessThan(barBox.y - 150);
    // Below 360px the total gets its own full-width line (label and the
    // secondary squares share the line above it) — ~20px taller, by design.
    expect(barBox.height).toBeLessThanOrEqual(width < 360 ? 160 : 140);

    // Inside the bar: the total is never clipped and no two controls overlap.
    const barLayout = await bar.evaluate((el) => {
      const price = el.querySelector('.price-flash, .opacity-60');
      const boxes = [...el.querySelectorAll('button'), ...(price ? [price] : [])]
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 0);
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) overlaps++;
        }
      return { overlaps, priceClipped: !price || price.scrollWidth > price.clientWidth + 1 };
    });
    expect(barLayout).toEqual({ overlaps: 0, priceClipped: false });

    for (const name of [checkout, addToCart]) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeLessThanOrEqual(56);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label*="секция қосу"], button[aria-label*="секцияны жою"], button[aria-label^="Сөрелер санын"]'))
        .filter((b) => b.querySelector('span'))
        .map((b) => {
          const hit = b.getBoundingClientRect();
          const disc = b.querySelector('span')!.getBoundingClientRect();
          return { hit: [hit.width, hit.height], disc: Math.max(disc.width, disc.height) };
        }),
    );
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const c of controls) {
      expect(Math.min(...c.hit)).toBeGreaterThanOrEqual(44);
      // Owner-approved ~15% reduction: add disc 32→27px, remove/shelf 28→24px.
      expect(c.disc).toBeLessThanOrEqual(28);
      expect(c.disc).toBeGreaterThanOrEqual(22);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

/**
 * Desktop and tablet (1024 px and up), 2026-10-01: one vertical column. The
 * rack spans the content width and nothing sits beside it; under it the
 * reset action, then the kit switcher, the active kit's parameters, its
 * sections, additional parameters, the kit contents and — last — the
 * purchase bar, which sticks to the bottom of the viewport while the
 * controls are on screen and never rides over the rack. Desktop project
 * only: a phone-emulated device at desktop widths is not a real
 * configuration (the mobile tests above cover phones).
 */
const FIVE_MIXED =
  '?v=2&model=ms-standard&depth=400&sections=700:1000:2:0:0:0,1000:1500:4:1:0:0,1200:2000:6:0:1:0,1500:2500:8:0:0:0,1000:3000:5:0:0:1';

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

const CORNERS = kit([section(1500, 2500, 8, 'LEFT'), section(700, 1000, 2), section(1000, 1800, 6), section(1200, 2200, 4), section(1000, 1500, 3, 'RIGHT')]);

const LAYOUT_CASES = {
  'five mixed sections': { query: FIVE_MIXED, kits: 1 },
  'LEFT + RIGHT corners': { query: `?${configurationToShareQuery(CORNERS)}`, kits: 1 },
  'a 3-kit workspace': {
    query: `?${workspaceToShareQuery([kit([section(1000, 2000, 5)]), CORNERS, kit([section(700, 1000, 2), section(1200, 3000, 8)])], 1)}`,
    kits: 3,
  },
} as const;

async function measureLayout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null | undefined) => (el ? (el.getBoundingClientRect().toJSON() as DOMRect) : null);
    const byText = (selector: string, text: string) => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent?.trim() === text);
    const frameEl = document.querySelector('.configurator-frame-box')!;
    const labels = Array.from(frameEl.querySelectorAll('svg text'))
      .map((t) => t.getBoundingClientRect())
      .filter((r) => r.width > 0);
    return {
      viewport: window.innerHeight,
      // The page's content column (the title block spans it).
      content: box(document.querySelector('h1'))!,
      frame: box(frameEl)!,
      // The preview panel: toolbar, frame and caption strip together.
      panel: box(frameEl.closest('.border-y'))!,
      labelsBottom: Math.max(...labels.map((r) => r.bottom)),
      svg: box(document.querySelector('[data-testid="preview-stage"] svg'))!,
      reset: box(byText('button', 'Сбросить настройки'))!,
      switcher: box(document.querySelector('[role="group"][aria-label="Комплекты"]'))!,
      kitParams: box(document.querySelector('[role="group"][aria-label="Параметры комплекта"]'))!,
      sections: box(document.querySelector('section[aria-labelledby="configurator-sections-heading"]'))!,
      advanced: box(byText('button', 'Дополнительные параметры'))!,
      bom: box(byText('h2', 'Состав комплекта'))!,
      bar: box(document.querySelector('.fixed.inset-x-0.bottom-0'))!,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1280, 720],
  [1440, 900],
  [1536, 864],
] as const) {
  for (const [name, { query, kits }] of Object.entries(LAYOUT_CASES)) {
    test(`desktop ${width}×${height}, ${name}: full-width rack, controls below it, purchase bar last`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'desktop layout');
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.setViewportSize({ width, height });
      await page.goto(`/ru/configurator${query}`);
      await expect(page.getByRole('group', { name: 'Комплекты' }).locator('[data-kit-tab]')).toHaveCount(kits);
      await waitForPrice(page, kits > 1 ? 'Добавить все в корзину' : PURCHASE.ru[1]);

      const load = await measureLayout(page);
      // The preview panel takes the whole content width (the title's and
      // the controls' width), and on load the whole of it — frame, every dimension label,
      // caption — is in view, undistorted (4:3 stage).
      expect(load.panel.width).toBeGreaterThanOrEqual(load.sections.width - 1);
      expect(load.panel.width).toBeGreaterThanOrEqual(load.content.width - 1);
      expect(load.panel.bottom).toBeLessThanOrEqual(load.viewport);
      expect(load.labelsBottom).toBeLessThanOrEqual(load.frame.bottom + 0.5);
      expect(load.svg.width / load.svg.height).toBeCloseTo(4 / 3, 2);
      // Much wider than the old one-third column (518×292 for five sections
      // at 1280–1536 px), and never wider than its panel.
      if (name === 'five mixed sections') expect(load.frame.width).toBeGreaterThan(640);
      expect(load.frame.width).toBeLessThanOrEqual(load.panel.width);
      // The purchase bar never covers the rack.
      expect(load.bar.top).toBeGreaterThanOrEqual(load.panel.bottom);

      // Vertical hierarchy, nothing beside the rack: rack → reset → kits →
      // kit parameters → sections → additional parameters → kit contents.
      const order = [load.panel, load.reset, load.switcher, load.kitParams, load.sections, load.advanced, load.bom];
      for (let i = 1; i < order.length; i++) expect(order[i].top, `block ${i}`).toBeGreaterThanOrEqual(order[i - 1].bottom);
      expect(load.overflow).toBeLessThanOrEqual(0);
      await expect(page.getByRole('heading', { name: 'Характеристики' })).toHaveCount(0);

      // Working through the sections: the bar rides at the bottom of the
      // viewport with the total and both actions fully in view, below the
      // rack.
      await page.locator('#configurator-sections-heading').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 150));
      const scrolled = await measureLayout(page);
      expect(Math.abs(scrolled.bar.bottom - scrolled.viewport)).toBeLessThanOrEqual(1);
      expect(scrolled.bar.top).toBeGreaterThanOrEqual(scrolled.panel.bottom);
      await expect(page.locator('.price-flash').first()).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: PURCHASE.ru[0], exact: true })).toBeInViewport({ ratio: 1 });

      // At the end of the page the bar settles in its own place, last.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const end = await measureLayout(page);
      expect(end.bar.top).toBeGreaterThanOrEqual(end.bom.bottom);
      expect(errors).toEqual([]);
    });
  }
}

test('desktop 1280×720: any overlap of the sticky purchase bar with the floating WhatsApp button leaves it inert', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/ru/configurator');
  const [checkout, addToCart] = PURCHASE.ru;
  await waitForPrice(page, addToCart);
  await page.locator('#configurator-sections-heading').scrollIntoViewIfNeeded();
  await expect(page.locator('.price-flash').first()).toBeInViewport({ ratio: 1 });
  for (const name of [checkout, addToCart]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const conflict = await page.evaluate(() => {
    const fab = document.querySelector('a.fixed[aria-label="Написать в WhatsApp"]') as HTMLElement | null;
    if (!fab || getComputedStyle(fab).display === 'none' || getComputedStyle(fab).pointerEvents === 'none') return false;
    const f = fab.getBoundingClientRect();
    return Array.from(document.querySelectorAll('[data-fab-avoid]')).some((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top;
    });
  });
  expect(conflict).toBe(false);
});

/**
 * The reset action under the rack: a real, clearly secondary button — 44px
 * tall, semibold, never the amber CTA treatment — that works from the
 * keyboard and restores the active kit's default configuration, in both
 * languages.
 */
for (const locale of ['ru', 'kk'] as const) {
  test(`${locale}: reset settings is visible under the rack, keyboard accessible and resets the kit`, async ({ page }) => {
    const label = locale === 'ru' ? 'Сбросить настройки' : 'Баптауларды бастапқы қалпына келтіру';
    const addToCart = PURCHASE[locale][1];
    await page.goto(`/${locale}/configurator`);
    await waitForPrice(page, addToCart);
    const defaults = await storedSections(page);

    await page.goto(`/${locale}/configurator${FIVE_MIXED}`);
    await expect.poll(async () => (await storedSections(page)).length).toBe(5);

    const reset = page.getByRole('button', { name: label, exact: true });
    await reset.scrollIntoViewIfNeeded();
    await expect(reset).toBeVisible();
    const look = await reset.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const frame = document.querySelector('.configurator-frame-box')!.getBoundingClientRect();
      return { tag: el.tagName, tabIndex: (el as HTMLElement).tabIndex, weight: Number(cs.fontWeight), size: parseFloat(cs.fontSize), height: r.height, belowRack: r.top >= frame.bottom, bg: cs.backgroundColor };
    });
    expect(look.tag).toBe('BUTTON');
    expect(look.tabIndex).toBe(0);
    expect(look.weight).toBeGreaterThanOrEqual(600);
    expect(look.size).toBeGreaterThanOrEqual(14);
    expect(look.height).toBeGreaterThanOrEqual(44);
    expect(look.belowRack).toBe(true);
    // Secondary: not the amber background of the checkout button.
    const checkoutBg = await page.getByRole('button', { name: PURCHASE[locale][0], exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(look.bg).not.toBe(checkoutBg);

    // Keyboard: focus it and press Enter — the kit returns to its defaults.
    await reset.focus();
    await expect(reset).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await storedSections(page)).map((s) => [s.width, s.height, s.shelves, s.corner]))
      .toEqual(defaults.map((s) => [s.width, s.height, s.shelves, s.corner]));
    await waitForPrice(page, addToCart);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
