import { test, expect } from '@playwright/test';

/**
 * The homepage's three popular MS Standard configurations, exercised the way
 * a customer uses them: each card's two actions must carry that card's own
 * configuration — not a neighbour's, and not a default rack.
 *
 * Dimensions are read from the card that is being clicked rather than
 * hardcoded here, so the test proves "this card's actions match this card"
 * against whatever the catalog currently advertises.
 */

const CARD = 'section:has(h2:text("Популярные конфигурации")) >> div:has(> a[href^="/catalog/"]):has(h3)';

function parseDimensions(title: string) {
  const match = title.match(/(\d+)×(\d+)×(\d+),\s*(\d+)\s*(?:полки|полок|полка)/);
  if (!match) throw new Error(`Unexpected card title: ${title}`);
  return { height: match[1], width: match[2], depth: match[3], shelves: match[4] };
}

test('shows exactly three MS Standard configurations at depths 300, 400 and 600', async ({ page }) => {
  await page.goto('/');
  const titles = await page
    .locator('section:has(h2:text("Популярные конфигурации")) h3')
    .allTextContents();

  expect(titles).toHaveLength(3);
  expect(titles.map((t) => parseDimensions(t).depth)).toEqual(['300', '400', '600']);
  for (const title of titles) {
    const dims = parseDimensions(title);
    expect(dims.height).toBe('2000');
    expect(dims.width).toBe('1000');
    expect(dims.shelves).toBe('4');
    expect(title).toContain('MS Стандарт');
  }
});

test('every card states "4 полки" in its specification line', async ({ page }) => {
  await page.goto('/');
  const specs = page.locator('section:has(h2:text("Популярные конфигурации")) .tech-label').filter({ hasText: 'полки' });
  await expect(specs).toHaveCount(3);
  for (const text of await specs.allTextContents()) expect(text).toContain('4 полки');
});

test('every card shows a drawing of its own rack, not the sample-image placeholder', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('section:has(h2:text("Популярные конфигурации"))');

  // One inline SVG drawing per card, and no catalog placeholder image left.
  await expect(section.locator('svg[role="img"]')).toHaveCount(3);
  await expect(section.locator('img[src*="/images/models/"]')).toHaveCount(0);

  // Each drawing is built from its own configuration: four shelf planes and
  // that card's own depth tag.
  for (const [index, depth] of [300, 400, 600].entries()) {
    const card = page.locator(CARD).nth(index);
    await expect(card.locator('svg text', { hasText: String(depth) }).first()).toBeAttached();
  }
});

test('every card shows a real price from the server pricing engine', async ({ page }) => {
  await page.goto('/');
  const prices = await page
    .locator('section:has(h2:text("Популярные конфигурации")) .mono')
    .filter({ hasText: '₸' })
    .allTextContents();

  expect(prices).toHaveLength(3);
  const numeric = prices.map((p) => Number(p.replace(/[^\d]/g, '')));
  for (const total of numeric) expect(total).toBeGreaterThan(0);
  // Deeper rack, higher price — a single shared/stale total would break this.
  expect(numeric[0]).toBeLessThan(numeric[1]);
  expect(numeric[1]).toBeLessThan(numeric[2]);
});

for (const [index, depth] of [300, 400, 600].entries()) {
  test(`"Настроить" on the ${depth}mm card opens the configurator with that exact configuration`, async ({ page }) => {
    await page.goto('/');
    const card = page.locator(CARD).nth(index);
    const dims = parseDimensions((await card.locator('h3').textContent()) ?? '');
    expect(dims.depth).toBe(String(depth));

    await card.getByRole('link', { name: 'Настроить' }).click();
    await page.waitForURL(/\/configurator\?/);

    const params = new URL(page.url()).searchParams;
    expect(params.get('model')).toBe('ms-standard');
    expect(params.get('height')).toBe(dims.height);
    expect(params.get('depth')).toBe(dims.depth);
    expect(params.get('shelves')).toBe(dims.shelves);
    expect(params.get('sections')).toContain(dims.width);
  });
}

test('the homepage never scrolls horizontally, from 320px to 1920px', async ({ page }) => {
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(clientWidth);
  }
});

/**
 * The floating WhatsApp button is fixed to the bottom-right corner, so
 * without help it sits on top of whatever scrolls under it. It must never be
 * clickable while it covers an action (see WhatsAppFloatingButton).
 */
for (const width of [320, 375, 390, 430, 768, 1440]) {
  test(`the WhatsApp button never covers an action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');

    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let offset = 0; offset < pageHeight; offset += 200) {
      await page.evaluate((y) => window.scrollTo(0, y), offset);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      const conflict = await page.evaluate(() => {
        const button = document.querySelector('a.fixed[aria-label="Написать в WhatsApp"]') as HTMLElement | null;
        if (!button) return null;
        const style = getComputedStyle(button);
        const interactive = style.pointerEvents !== 'none' && Number(style.opacity) > 0.01 && style.display !== 'none';
        if (!interactive) return null;

        const box = button.getBoundingClientRect();
        for (const cta of document.querySelectorAll('[data-fab-avoid]')) {
          const rect = cta.getBoundingClientRect();
          const overlaps = !(rect.right < box.left || rect.left > box.right || rect.bottom < box.top || rect.top > box.bottom);
          if (overlaps && rect.width > 0 && rect.height > 0) return { scrollY: window.scrollY, button: box.toJSON(), action: rect.toJSON() };
        }
        return null;
      });

      expect(conflict, `WhatsApp button covers an action at ${width}px, scrollY ${offset}`).toBeNull();
    }
  });
}

test('the WhatsApp button stays reachable where it covers nothing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  // The contacts section has a link with the same accessible name, so the
  // floating button is addressed by its own attribute.
  const fab = page.locator('a[aria-label="Написать в WhatsApp"].fixed');
  await expect(fab).toHaveAttribute('href', /wa\.me/);
  await expect(fab).toBeVisible();
  await expect(fab).not.toHaveAttribute('aria-hidden', 'true');
});

test('the MS Standard feature panel shows its range specs and both CTAs', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('section:has(h2:text("Категории стеллажей"))');

  await expect(panel.getByRole('heading', { name: 'MS Стандарт', exact: true })).toBeVisible();
  for (const spec of ['1000–3000 мм', '700–1500 мм', '300–800 мм', 'до 150 кг/полку']) {
    await expect(panel.getByText(spec, { exact: false }).first()).toBeVisible();
  }
  await expect(panel.getByRole('link', { name: 'Настроить стеллаж' })).toHaveAttribute(
    'href',
    '/configurator?model=ms-standard',
  );
  await expect(panel.getByRole('link', { name: 'Смотреть модели' })).toHaveAttribute('href', '/catalog/ms-standard');
  // The panel draws a real configuration instead of a placeholder photo.
  await expect(panel.locator('svg').first()).toBeVisible();
});

test('"В корзину" adds that card\'s exact configuration to the cart', async ({ page }) => {
  await page.goto('/');
  const card = page.locator(CARD).nth(2);
  const dims = parseDimensions((await card.locator('h3').textContent()) ?? '');
  expect(dims.depth).toBe('600');

  await card.getByRole('button', { name: 'В корзину' }).click();
  await expect(card.getByRole('button', { name: 'Добавлено ✓' })).toBeVisible({ timeout: 15_000 });

  await page.goto('/cart');
  const line = page.locator('main').getByText(
    `${dims.height}×${dims.width}×${dims.depth} мм`,
    { exact: false },
  );
  await expect(line.first()).toBeVisible();
  // Russian count agreement — four shelves reads "4 полки".
  await expect(page.getByText(`${dims.shelves} полки`).first()).toBeVisible();
});
