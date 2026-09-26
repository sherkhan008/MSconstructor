import { test, expect } from './helpers/test';

/**
 * The public 404 in both languages, against the real server: a real 404
 * status, the site's own header, the page's language kept (html lang and
 * every way onward), no English framework page and nothing indexable.
 *
 * Next.js 15 renders a notFound() thrown by a page as a 404 document whose
 * body the browser fills from the inlined React payload (app-render's error
 * shell), so the page content is asserted in the browser; the raw response
 * is checked for its status, noindex and the absence of the framework's own
 * English 404 markup.
 */

const CASES = [
  { path: '/ru/no-such-page', lang: 'ru', title: 'Страница не найдена', catalog: '/ru/catalog', home: '/ru', catalogLabel: 'Перейти в каталог', homeLabel: 'На главную' },
  { path: '/no-such-page', lang: 'kk', title: 'Бет табылмады', catalog: '/catalog', home: '/', catalogLabel: 'Каталогқа өту', homeLabel: 'Басты бетке' },
  { path: '/ru/catalog/no-such-model', lang: 'ru', title: 'Страница не найдена', catalog: '/ru/catalog', home: '/ru', catalogLabel: 'Перейти в каталог', homeLabel: 'На главную' },
  { path: '/catalog/no-such-model', lang: 'kk', title: 'Бет табылмады', catalog: '/catalog', home: '/', catalogLabel: 'Каталогқа өту', homeLabel: 'Басты бетке' },
] as const;

for (const c of CASES) {
  test(`404 ${c.path}: localized (${c.lang}), inside the site layout, with locale-preserving ways back`, async ({ page, request }) => {
    const raw = await request.get(c.path);
    expect(raw.status()).toBe(404);
    const html = await raw.text();
    expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
    expect(html).not.toMatch(/<h1[^>]*next-error-h1/);

    const response = await page.goto(c.path);
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.title);
    await expect(page.locator('body')).not.toContainText('could not be found');
    await expect(page.getByRole('link', { name: c.catalogLabel, exact: true })).toHaveAttribute('href', c.catalog);
    await expect(page.getByRole('link', { name: c.homeLabel, exact: true })).toHaveAttribute('href', c.home);
    // The site's own header is there (a way back even without the buttons).
    await expect(page.locator('header')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await page.getByRole('link', { name: c.catalogLabel, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${c.catalog.replace(/\//g, '\\/')}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
  });
}
