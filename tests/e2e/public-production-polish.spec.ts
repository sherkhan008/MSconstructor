import { test, expect } from './helpers/test';
import { parseConfigurationFromSearchParams } from '../../src/lib/configurator/url';

const popular = 'section:has(h2:text("Популярные конфигурации"))';
const cardSelector = `${popular} >> div:has(> a[href*="/catalog/"]):has(h3)`;

for (const model of ['ms-strong', 'archive-ms']) {
  test(`hidden configurator ${model} returns 404`, async ({ request }) => {
    const response = await request.get(`/ru/configurator?model=${model}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('noindex');
  });
}

// Both public languages: Kazakh copy is longer and must not overflow either.
const PAGES = ['/', '/catalog', '/catalog/ms-standard', '/configurator', '/contacts', '/delivery', '/payment', '/privacy', '/terms'];
for (const [pagePath, route] of PAGES.flatMap((p) => [[p, p], [p, p === '/' ? '/ru' : `/ru${p}`]])) {
  test(`${route} has no public sample imagery or responsive overflow`, async ({ page, request }) => {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const addToCart = route.startsWith('/ru') ? 'Добавить в корзину' : 'Себетке қосу';
    if (pagePath === '/configurator') await expect(page.getByRole('button', { name: addToCart })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/SAMPLE IMAGE/i);
    for (const src of await page.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) {
      if (new URL(src).pathname.endsWith('.svg')) expect(await (await request.get(src)).text()).not.toMatch(/SAMPLE IMAGE/i);
    }
    if (['/', '/catalog', '/catalog/ms-standard'].includes(pagePath)) await expect(page.locator('main svg[role="img"]').first()).toBeVisible();
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${route} at ${width}`).toBeLessThanOrEqual(0);
    }
  });
}

test('each popular price and cart item matches its exact four-shelf server configuration', async ({ page, request }) => {
  await page.goto('/ru');
  const totals = [];
  for (const [index, depth] of [300, 400, 600].entries()) {
    const card = page.locator(cardSelector).nth(index);
    const href = await card.getByRole('link', { name: 'Настроить', exact: true }).getAttribute('href');
    const config = parseConfigurationFromSearchParams(new URL(href!, page.url()).searchParams);
    expect(config).toMatchObject({ modelSlug: 'ms-standard', depth });
    expect(config.sections?.map(({ width, height, shelves }) => ({ width, height, shelves }))).toEqual([{ width: 1000, height: 2000, shelves: 4 }]);
    const response = await request.post('/api/pricing/calculate', { data: { accessories: [], ...config } });
    const price = await response.json();
    expect(price.ok).toBe(true);
    const rendered = Number((await card.locator('.mono').filter({ hasText: '₸' }).innerText()).replace(/\D/g, ''));
    expect(rendered).toBe(price.breakdown.total);
    totals.push(rendered);
    const submitted = page.waitForRequest(req => req.url().endsWith('/api/pricing/calculate') && req.method() === 'POST');
    await card.getByRole('button', { name: 'В корзину' }).click();
    const submittedConfig = (await submitted).postDataJSON();
    expect(submittedConfig).toMatchObject({ depth, sections: [{ width: 1000, height: 2000, shelves: 4 }] });
    expect(submittedConfig).not.toHaveProperty('height');
    expect(submittedConfig).not.toHaveProperty('shelves');
    await expect(card.getByRole('button', { name: 'Добавлено ✓' })).toBeVisible();
  }
  console.info(`Authoritative rendered popular prices: ${totals.join(', ')}`);
  const items = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items);
  expect(items).toHaveLength(3);
  expect(
    items.map((item: { configuration: { depth: number; sections: { shelves: number }[] } }) => [
      item.configuration.depth,
      item.configuration.sections.map((s) => s.shelves),
    ]),
  ).toEqual([[300, [4]], [400, [4]], [600, [4]]]);
  for (const route of ['/ru/cart', '/ru/order']) {
    await page.goto(route);
    if (route === '/ru/cart') await expect(page.locator('main').getByText('4 полки').first()).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'Ваш заказ' })).toBeVisible();
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      for (const action of await page.locator('[data-fab-avoid]').all()) {
        await action.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const conflict = await page.evaluate(() => {
          const fab = document.querySelector('a.fixed[aria-label="Написать в WhatsApp"]') as HTMLElement;
          if (getComputedStyle(fab).pointerEvents === 'none' || getComputedStyle(fab).display === 'none') return false;
          const box = fab.getBoundingClientRect();
          return Array.from(document.querySelectorAll('[data-fab-avoid]')).some(node => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
          });
        });
        expect(conflict).toBe(false);
      }
    }
  }
});

test('WhatsApp is idle after layout settles and reacts to a new protected action', async ({ page }) => {
  await page.goto('/ru');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    (window as unknown as { framesScheduled: number }).framesScheduled = 0;
    window.requestAnimationFrame = callback => {
      (window as unknown as { framesScheduled: number }).framesScheduled++;
      return original(callback);
    };
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { framesScheduled: number }).framesScheduled)).toBe(0);
  await page.evaluate(() => {
    const action = document.createElement('button');
    action.id = 'qa-action';
    action.dataset.fabAvoid = '';
    action.style.cssText = 'position:fixed;bottom:24px;right:16px;width:80px;height:60px';
    document.body.append(action);
  });
  const fab = page.locator('a.fixed[aria-label="Написать в WhatsApp"]');
  await expect(fab).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => document.querySelector('#qa-action')!.remove());
  await expect(fab).toHaveAttribute('aria-hidden', 'false');
});
