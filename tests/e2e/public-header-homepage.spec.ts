import { test, expect } from './helpers/test';
import { H, HM } from '../../src/lib/i18n/strings';

/**
 * The storefront shell (Header) and the configurator-first homepage, in both
 * public languages: every configurator entry point is localized, the mobile
 * menu is keyboard-operable, the cart indicator reflects the cart, and each
 * homepage renders its own language only.
 */

const LOCALES = [
  { locale: 'kk', home: '/', prefix: '' },
  { locale: 'ru', home: '/ru', prefix: '/ru' },
] as const;

for (const { locale, home, prefix } of LOCALES) {
  test(`${locale}: the header configurator CTA and the hero CTAs lead to the localized configurator`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(home);
    const header = page.locator('header');
    await expect(header.getByRole('link', { name: H['H-008'][locale], exact: true })).toHaveAttribute('href', `${prefix}/configurator`);

    const hero = page.locator('section[aria-labelledby="home-hero-title"]');
    await expect(hero.getByRole('link', { name: HM['HM-004'][locale] })).toHaveAttribute('href', `${prefix}/configurator`);
    await expect(hero.getByRole('link', { name: HM['HM-005'][locale] })).toHaveAttribute('href', `${prefix}/catalog`);
    // The hero rack opens the configurator preloaded with exactly that rack.
    const configureRack = await hero.locator(`a[href^="${prefix}/configurator?"]`).getAttribute('href');
    expect(configureRack).toContain('model=ms-standard');
    await expect(hero.locator('svg[role="img"]')).toBeVisible();
  });

  test(`${locale}: the homepage states the delivery terms verbatim and shows no other language`, async ({ page }) => {
    await page.goto(home);
    const main = page.locator('main');
    await expect(main).toContainText(HM['HM-050'][locale]);
    await expect(main).toContainText(HM['HM-051'][locale]);

    const other = locale === 'kk' ? 'ru' : 'kk';
    for (const key of ['HM-002', 'HM-004', 'HM-034', 'HM-050', 'HM-051'] as const) {
      await expect(main).not.toContainText(HM[key][other]);
    }
    await expect(page.locator('header')).not.toContainText(H['H-008'][other]);
  });

  test(`${locale}: the mobile menu opens, closes on Escape and returns focus`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`${prefix}/catalog`);
    const toggle = page.getByRole('button', { name: H['H-009'][locale] });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    const menu = page.getByRole('navigation', { name: H['H-011'][locale] });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: H['H-010'][locale] })).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: H['H-002'][locale] })).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link', { name: H['H-012'][locale] })).toHaveAttribute('href', `${prefix}/configurator`);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByRole('button', { name: H['H-009'][locale] })).toBeFocused();

    // The language switch and the cart stay reachable at the narrowest width.
    await expect(page.getByTestId('language-switcher')).toBeVisible();
    await expect(page.locator('header').getByRole('link', { name: H['H-007'][locale] })).toBeVisible();
  });
}

test('desktop navigation marks the current section', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/ru/catalog/ms-standard');
  const nav = page.getByRole('navigation', { name: H['H-001'].ru });
  await expect(nav.getByRole('link', { name: H['H-002'].ru })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: H['H-004'].ru })).not.toHaveAttribute('aria-current', 'page');
});

test('the header cart indicator counts what a homepage card added', async ({ page }) => {
  await page.goto('/ru');
  const cart = page.locator('header').getByRole('link', { name: H['H-007'].ru });
  await expect(cart).toHaveText('');
  const card = page.locator('section:has(h2:text("Популярные конфигурации")) >> div:has(> a[href*="/catalog/"]):has(h3)').first();
  await card.getByRole('button', { name: 'В корзину' }).click();
  await expect(card.getByRole('button', { name: 'Добавлено ✓' })).toBeVisible();
  await expect(cart).toHaveText('1');
});
