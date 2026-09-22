import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

/**
 * Layout guarantees of the configurator workspace redesign — sizes and
 * positions only; behaviour is covered by the other configurator specs.
 *
 * Mobile: the rack comes before the fixed purchase bar, the bar stays
 * compact, the two purchase buttons are ~48px (not oversized) and every
 * on-rack +/− keeps a 44px hit target around a smaller visible disc.
 * Desktop: on a short 1280×720 screen the total and both purchase actions
 * are in view without scrolling the page.
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

test('desktop 1280×720: total and both purchase actions are in view without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/ru/configurator');
  const [checkout, addToCart] = PURCHASE.ru;
  await waitForPrice(page, addToCart);

  await expect(page.locator('.price-flash').first()).toBeInViewport({ ratio: 1 });
  for (const name of [checkout, addToCart]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole('img', { name: 'Схема стеллажа спереди' })).toBeInViewport();

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
