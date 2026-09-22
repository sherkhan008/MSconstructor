import { test, expect } from './helpers/test';

/**
 * The order summary bar is `fixed inset-x-0 bottom-0`, so any content wider
 * than the viewport is clipped and genuinely unreachable — the page cannot
 * scroll horizontally to it. Regression guard for a mobile layout bug where
 * the total plus the four actions ("Добавить в корзину", "Оформить заказ",
 * WhatsApp, share) needed ~526px on a 412px-wide phone, pushing the WhatsApp
 * and share buttons off-screen. Every action must stay within the viewport at
 * phone width.
 */
test('every order summary bar action stays inside the viewport at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/ru/configurator?model=ms-standard&height=2500&depth=600&shelves=8&sections=1000:false:false:false');
  await expect(page.locator('select[aria-label="Ширина секции 1"]')).toBeVisible();

  // The actions only become enabled once a server price has arrived.
  const addToCart = page.getByRole('button', { name: /Добавить в корзину/ });
  await expect(addToCart).toBeEnabled({ timeout: 15_000 });

  const overflowing = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const names = [/Добавить в корзину/, /Оформить заказ/, /WhatsApp/i, /Поделиться конфигурацией/];
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('button, a'))) {
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
      if (!names.some((n) => n.test(label))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) bad.push(`${label.slice(0, 24)} [${Math.round(r.left)}..${Math.round(r.right)}] vw=${vw}`);
    }
    return bad;
  });
  expect(overflowing).toEqual([]);

  // And the bar's own content must not overflow its box.
  const bar = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /Добавить в корзину/.test(b.textContent ?? ''));
    const el = btn?.closest('div[class*="fixed"]') as HTMLElement | null;
    return el ? { scrollW: el.scrollWidth, clientW: el.clientWidth } : null;
  });
  expect(bar).not.toBeNull();
  expect(bar!.scrollW).toBeLessThanOrEqual(bar!.clientW + 1);
});
