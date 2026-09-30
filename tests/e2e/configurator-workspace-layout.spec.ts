import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

/**
 * Layout guarantees of the configurator workspace redesign — sizes and
 * positions only; behaviour is covered by the other configurator specs.
 *
 * Mobile: the rack comes before the fixed purchase bar, the bar stays
 * compact, the two purchase buttons are ~48px (not oversized) and every
 * on-rack +/− keeps a 44px hit target around a smaller visible disc.
 * Desktop: the whole rack is in view on load, with the total and both
 * purchase actions in document flow directly under it.
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

test('desktop 1280×720: the whole rack is in view on load; price and both actions sit directly under it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/ru/configurator');
  const [checkout, addToCart] = PURCHASE.ru;
  await waitForPrice(page, addToCart);

  await expect(page.locator('.configurator-frame-box').first()).toBeInViewport({ ratio: 1 });
  // The bar is the next thing on the page: one short scroll brings the
  // total and both actions fully into view.
  await page.getByRole('button', { name: checkout, exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator('.price-flash').first()).toBeInViewport({ ratio: 1 });
  for (const name of [checkout, addToCart]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }

  // Any overlap with the floating WhatsApp button must leave it inert.
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
 * Desktop and tablet (1024 px and up): one vertical column — the rack at the
 * content width, the purchase bar directly under it in document flow, then
 * the kit switcher, the kit's parameters, its sections, additional parameters
 * and the kit contents. On load the whole rack is in view and nothing covers
 * it; once the page scrolls past the bar it sticks under the header, over the
 * controls only. Desktop project only: a phone-emulated device at desktop
 * widths is not a real configuration (the mobile tests above cover phones).
 */
const FIVE_MIXED =
  '?v=2&model=ms-standard&depth=400&sections=700:1000:2:0:0:0,1000:1500:4:1:0:0,1200:2000:6:0:1:0,1500:2500:8:0:0:0,1000:3000:5:0:0:1';

for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1280, 720],
  [1440, 900],
  [1536, 864],
] as const) {
  test(`desktop ${width}×${height}: full-width rack fully in view, purchase bar under it, controls below`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop layout');
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height });
    await page.goto(`/ru/configurator${FIVE_MIXED}`);
    const [checkout, addToCart] = PURCHASE.ru;
    await waitForPrice(page, addToCart);

    const measure = () =>
      page.evaluate(() => {
        const box = (el: Element | null | undefined) => el?.getBoundingClientRect().toJSON() as DOMRect;
        const frameEl = document.querySelector('.configurator-frame-box')!;
        const labels = Array.from(frameEl.querySelectorAll('svg text'))
          .map((t) => t.getBoundingClientRect())
          .filter((r) => r.width > 0);
        return {
          viewport: window.innerHeight,
          header: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')),
          frame: box(frameEl),
          // The preview panel: toolbar, frame and caption strip together.
          panel: box(frameEl.closest('.border-y')),
          labelsBottom: Math.max(...labels.map((r) => r.bottom)),
          svg: box(document.querySelector('[data-testid="preview-stage"] svg')),
          bar: box(document.querySelector('.fixed.inset-x-0.bottom-0')),
          switcher: box(document.querySelector('[role="group"][aria-label="Комплекты"]')),
          kitParams: box(document.querySelector('[role="group"][aria-label="Параметры комплекта"]')),
          sections: box(document.querySelector('section[aria-labelledby="configurator-sections-heading"]')),
          advanced: box(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Дополнительные параметры')),
          bom: box(Array.from(document.querySelectorAll('h2')).find((h) => h.textContent?.trim() === 'Состав комплекта')),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

    const load = await measure();
    // On load the whole preview — frame, every dimension label, caption —
    // is inside the viewport, and the bar starts only below it.
    expect(load.panel.bottom).toBeLessThanOrEqual(load.viewport);
    expect(load.labelsBottom).toBeLessThanOrEqual(load.frame.bottom);
    expect(load.bar.top).toBeGreaterThanOrEqual(load.panel.bottom);

    // Much larger than the old one-third column (518×292 for five sections),
    // never wider than the content, never distorted (4:3 stage).
    expect(load.frame.width).toBeGreaterThan(600);
    expect(load.frame.width).toBeLessThanOrEqual(load.sections.width + 1);
    expect(load.svg.width / load.svg.height).toBeCloseTo(4 / 3, 2);

    // Vertical hierarchy: rack → bar → kits → kit params → sections →
    // additional parameters → contents; nothing sits beside the rack.
    const order = [load.panel, load.bar, load.switcher, load.kitParams, load.sections, load.advanced, load.bom];
    for (let i = 1; i < order.length; i++) expect(order[i].top).toBeGreaterThanOrEqual(order[i - 1].bottom);
    expect(load.sections.width).toBeGreaterThan(width * 0.75);
    expect(load.overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('heading', { name: 'Характеристики' })).toHaveCount(0);

    // Working through the sections, the bar sticks under the header with the
    // total and both actions fully in view — the rack is above it by then.
    await page.locator('#configurator-sections-heading').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const scrolled = await measure();
    expect(Math.abs(scrolled.bar.top - scrolled.header)).toBeLessThanOrEqual(1);
    expect(scrolled.panel.bottom).toBeLessThanOrEqual(scrolled.bar.top);
    await expect(page.locator('.price-flash').first()).toBeInViewport({ ratio: 1 });
    for (const name of [checkout, addToCart]) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });

    // Back at the top the bar returns to its place under the rack.
    await page.evaluate(() => window.scrollTo(0, 0));
    const back = await measure();
    expect(back.bar.top).toBeGreaterThanOrEqual(back.panel.bottom);
    expect(back.panel.bottom).toBeLessThanOrEqual(back.viewport);
    expect(errors).toEqual([]);
  });
}
