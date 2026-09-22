import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { CT, H, HM, PR } from '../../src/lib/i18n/strings';

/**
 * The storefront path Homepage → Catalog → MS Standard → Configurator, in
 * both public languages, and the catalog/model pages at phone widths.
 */

const LOCALES = [
  { locale: 'kk', prefix: '' },
  { locale: 'ru', prefix: '/ru' },
] as const;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

for (const { locale, prefix } of LOCALES) {
  test(`${locale}: homepage → catalog → MS Standard → configurator keeps the language`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const errors = watchErrors(page);
    const nav = page.getByRole('navigation', { name: H['H-001'][locale] });

    await page.goto(prefix || '/');
    await page.locator('main').getByRole('link', { name: HM['HM-005'][locale] }).first().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/catalog$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(CT['CT-001'][locale]);
    await expect(nav.getByRole('link', { name: H['H-002'][locale] })).toHaveAttribute('aria-current', 'page');

    await page.locator('main').getByRole('link', { name: HM['HM-033'][locale] }).first().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/catalog/ms-standard$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PR['PR-002'][locale]);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);

    await page.locator('main').getByRole('link', { name: PR['PR-006'][locale] }).first().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/configurator\\?model=ms-standard$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(nav.getByRole('link', { name: H['H-003'][locale] })).toHaveAttribute('aria-current', 'page');

    expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });
}

for (const path of ['/catalog', '/catalog/ms-standard', '/ru/catalog', '/ru/catalog/ms-standard']) {
  test(`${path} works at phone widths without overflow or a covered action`, async ({ page }) => {
    await page.goto(path);
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}`).toBeLessThanOrEqual(0);

      // The configurator action of the first model panel / the hero stays reachable and fits.
      const primary = page.locator('main [data-fab-avoid] a[href*="/configurator"]').first();
      await primary.scrollIntoViewIfNeeded();
      const box = (await primary.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);

      // No protected action sits under the visible floating WhatsApp button.
      for (const action of await page.locator('[data-fab-avoid]').all()) {
        // Some actions exist only at wider breakpoints (display: none here).
        if (!(await action.isVisible())) continue;
        await action.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const conflict = await page.evaluate(() => {
          const fab = document.querySelector('a.fixed[aria-label]') as HTMLElement | null;
          if (!fab || getComputedStyle(fab).pointerEvents === 'none' || getComputedStyle(fab).display === 'none') return false;
          const fabBox = fab.getBoundingClientRect();
          return Array.from(document.querySelectorAll('[data-fab-avoid]')).some((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left < fabBox.right && rect.right > fabBox.left && rect.top < fabBox.bottom && rect.bottom > fabBox.top;
          });
        });
        expect(conflict, `${path} at ${width}`).toBe(false);
      }
    }
  });
}
