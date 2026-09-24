import type { Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { test, expect } from './helpers/test';
import { createPrismaClient } from './helpers/admin-order-fixtures';
import { checkoutFixturePrefix, checkoutIdentity, isolateOrderRequests, removeCheckoutFixtures } from './helpers/checkout-order-fixtures';
import { t } from '../../src/lib/i18n/format';
import { CF, CK, CN, CR, CT, DL, F, H, HM, OS, VL } from '../../src/lib/i18n/strings';

/**
 * KZ-first public site in a real browser: Kazakh at the root, Russian under
 * /ru, the KZ / RU switcher opening the equivalent page, and customer state
 * (configurator, cart, prices) surviving a language switch untouched.
 * Runs in both projects (desktop and Pixel 7).
 */

const kk = (entry: { ru: string; kk: string }) => entry.kk;
const ru = (entry: { ru: string; kk: string }) => entry.ru;

/** Console errors and uncaught exceptions — hydration mismatches land here. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function switchTo(page: Page, label: 'RU' | 'KZ') {
  const switcher = page.getByTestId('language-switcher');
  await expect(switcher).toBeVisible();
  const before = page.url();
  await Promise.all([page.waitForURL((url) => url.toString() !== before), switcher.getByRole('link', { name: label, exact: true }).click()]);
  await expect(page.getByTestId('language-switcher')).toBeVisible();
}

/** The configurator total, digits only — "1 234 ₸" → "1234". */
async function configuratorTotal(page: Page): Promise<string> {
  const bar = page.locator('.fixed.inset-x-0.bottom-0');
  const price = bar.locator('.price-flash').first();
  await expect(price).toBeVisible({ timeout: 15_000 });
  return (await price.innerText()).replace(/\D/g, '');
}

test('the Kazakh root and the Russian /ru are server-rendered in their own language', async ({ request }) => {
  const kkHtml = await (await request.get('/')).text();
  const ruHtml = await (await request.get('/ru')).text();
  expect(kkHtml).toContain('<html lang="kk"');
  expect(ruHtml).toContain('<html lang="ru"');
  expect(kkHtml).toContain(kk(HM['HM-002']));
  expect(ruHtml).toContain(ru(HM['HM-002']));
  expect(kkHtml).not.toContain(ru(HM['HM-002']));
  expect(ruHtml).not.toContain(kk(HM['HM-002']));
});

for (const [kkPath, ruPath, heading] of [
  ['/', '/ru', HM['HM-002']],
  ['/catalog', '/ru/catalog', CT['CT-001']],
  ['/catalog/ms-standard', '/ru/catalog/ms-standard', { ru: 'MS Стандарт', kk: 'MS Стандарт' }],
  ['/configurator', '/ru/configurator', CF['CF-002']],
  ['/cart', '/ru/cart', CR['CR-001']],
  ['/order', '/ru/order', CK['CK-001']],
  ['/delivery', '/ru/delivery', DL['DL-001']],
] as const) {
  test(`switcher: ${kkPath} ↔ ${ruPath} opens the equivalent page`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(kkPath);
    await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(kk(heading), { ignoreCase: true });

    await switchTo(page, 'RU');
    expect(new URL(page.url()).pathname).toBe(ruPath);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru(heading), { ignoreCase: true });

    await switchTo(page, 'KZ');
    expect(new URL(page.url()).pathname).toBe(kkPath);
    expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });
}

test('Kazakh pages use Kazakh chrome and Russian pages Russian chrome', async ({ page }) => {
  await page.goto('/catalog');
  const header = page.locator('header');
  await expect(header.getByRole('link', { name: kk(H['H-007']) })).toBeVisible();
  await expect(page.locator('footer')).toContainText(kk(F['F-012']));
  await expect(page.locator('footer')).not.toContainText(ru(F['F-012']));
  await page.goto('/ru/catalog');
  await expect(page.locator('header').getByRole('link', { name: ru(H['H-007']) })).toBeVisible();
  await expect(page.locator('footer')).toContainText(ru(F['F-012']));
  await expect(page.locator('footer')).not.toContainText(kk(F['F-012']));
});

test('a configured rack, its price and every setting survive a language switch', async ({ page }) => {
  const query =
    'v=2&model=ms-standard&depth=400&sections=1000:1800:4:1:0:0,700:1800:4:0:1:1&load=150&shelfType=STANDARD&color=color-grey&assembly=assembly-professional&delivery=delivery-pickup&qty=2';
  await page.goto(`/configurator?${query}`);
  const kkTotal = await configuratorTotal(page);
  // An edit made on the page (not in the URL) must survive too.
  await page.locator(`select[aria-label="${t(CF['CF-036'], 'kk', { N: 2 })}"]`).selectOption('1000');
  await expect.poll(() => configuratorTotal(page), { timeout: 15_000 }).not.toBe(kkTotal);
  const kkEditedTotal = await configuratorTotal(page);

  await switchTo(page, 'RU');
  expect(new URL(page.url()).pathname).toBe('/ru/configurator');
  const ruTotal = await configuratorTotal(page);
  expect(ruTotal).toBe(kkEditedTotal);
  expect(kkEditedTotal).not.toBe(kkTotal);
  await expect(page.locator('select[aria-label="Ширина секции 1"]')).toHaveValue('1000');
  await expect(page.locator('select[aria-label="Ширина секции 2"]')).toHaveValue('1000');
  await expect(page.getByTestId('shelf-count')).toContainText('4');

  await switchTo(page, 'KZ');
  expect(await configuratorTotal(page)).toBe(ruTotal);
});

test('the cart survives a language switch with the same items and total', async ({ page }) => {
  await page.goto('/configurator');
  await configuratorTotal(page);
  await page.getByRole('button', { name: kk(CF['CF-066']) }).click();
  await expect(page.getByText(kk(CF['CF-069']))).toBeVisible();

  await page.goto('/cart');
  const cartTotal = page.locator('aside').locator('.mono').first();
  await expect(cartTotal).toBeVisible();
  const kkCart = (await cartTotal.innerText()).replace(/\D/g, '');
  const kkItems = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items);
  await expect(page.getByRole('button', { name: kk(CF['CF-067']) })).toBeEnabled();

  await switchTo(page, 'RU');
  expect(new URL(page.url()).pathname).toBe('/ru/cart');
  await expect(page.getByRole('button', { name: ru(CF['CF-067']) })).toBeEnabled();
  expect((await page.locator('aside').locator('.mono').first().innerText()).replace(/\D/g, '')).toBe(kkCart);
  const ruItems = await page.evaluate(() => JSON.parse(localStorage.getItem('ms-shelving-cart')!).state.items);
  expect(ruItems).toEqual(kkItems);
  await expect(page.locator('main').getByText(/полк/).first()).toBeVisible();
});

test.describe('checkout in Kazakh', () => {
  let prisma: PrismaClient | undefined;
  let prefix: string;

  test.beforeAll(({}, testInfo) => {
    prefix = checkoutFixturePrefix('I18N', testInfo.project.name, testInfo.repeatEachIndex);
    if (process.env.DATABASE_URL) prisma = createPrismaClient();
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await removeCheckoutFixtures(prisma, prefix);
    await prisma.$disconnect();
  });

  test('validation messages and the order confirmation are Kazakh', async ({ page }, testInfo) => {
    await isolateOrderRequests(page, prefix, testInfo);
    await page.goto('/configurator');
    await configuratorTotal(page);
    await page.getByRole('button', { name: kk(CF['CF-066']) }).click();
    await page.goto('/order');

    // Labels are Kazakh; client-side validation answers in Kazakh.
    await expect(page.getByText(kk(CK['CK-006']))).toBeVisible();
    await expect(page.getByText(kk(CK['CK-012']), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: kk(CK['CK-020']) }).click();
    await expect(page.getByText(kk(VL['VL-002']))).toBeVisible();
    await expect(page.getByText(kk(VL['VL-014']))).toBeVisible();

    const identity = checkoutIdentity(prefix, testInfo);
    await page.locator('input[name="fullName"]').fill(identity.fullName);
    await page.locator('input[name="phone"]').fill(identity.phone);
    await page.locator('input[name="email"]').fill(identity.email);
    await page.locator('input[name="city"]').fill('Алматы');
    await page.getByRole('button', { name: kk(CK['CK-020']) }).click();

    await expect(page).toHaveURL(/^[^?]*\/order\/success\?number=/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/order/success');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(kk(OS['OS-001']));
    await expect(page.getByText(kk(OS['OS-006']), { exact: true })).toBeVisible();

    // The success page switches with its order number.
    const number = new URL(page.url()).searchParams.get('number');
    await switchTo(page, 'RU');
    expect(new URL(page.url()).pathname).toBe('/ru/order/success');
    expect(new URL(page.url()).searchParams.get('number')).toBe(number);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru(OS['OS-001']));
  });

  test('the four-city delivery rule is explained in Kazakh', async ({ page }, testInfo) => {
    await isolateOrderRequests(page, prefix, testInfo);
    await page.goto('/configurator?v=2&model=ms-standard&depth=400&sections=1000:2000:5:0:0:0&delivery=delivery-city');
    await configuratorTotal(page);
    await page.getByRole('button', { name: kk(CF['CF-066']) }).click();
    await page.goto('/order');

    const identity = checkoutIdentity(prefix, testInfo);
    await page.locator('input[name="fullName"]').fill(identity.fullName);
    await page.locator('input[name="phone"]').fill(identity.phone);
    await page.locator('input[name="email"]').fill(identity.email);
    await page.locator('input[name="city"]').fill('Павлодар');
    await page.locator('input[name="deliveryAddress"]').fill('Сәтбаев көшесі, 1');
    await page.getByRole('button', { name: kk(CK['CK-020']) }).click();

    await expect(page.getByText(kk(VL['VL-013'])).first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/order\/success/);
  });
});

test('Kazakh shelf counts are invariant; Russian ones agree with the number', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.locator('main').getByText('4 сөре', { exact: true }).first()).toBeVisible();
  await page.goto('/ru/catalog');
  await expect(page.locator('main').getByText('4 полки', { exact: true }).first()).toBeVisible();
});

test('/kk is not a second Kazakh site and /ru/api does not exist', async ({ request }) => {
  const kkPrefixed = await request.get('/kk/catalog', { maxRedirects: 0 });
  expect(kkPrefixed.status()).toBe(308);
  expect(kkPrefixed.headers()['location']).toMatch(/\/catalog$/);
  expect((await request.get('/ru/api/health')).status()).toBe(404);
  expect((await request.get('/ru/admin')).status()).toBe(404);
});

for (const [path, locale] of [['/contacts', 'kk'], ['/ru/contacts', 'ru']] as const) {
  test(`${path}: an empty contact message is reported in the page language`, async ({ page }) => {
    await page.goto(path);
    await page.locator('#contact-name').fill('Айгүл');
    await page.locator('#contact-phone').fill('+77001234567');
    await page.getByRole('button', { name: CN['CN-010'][locale], exact: true }).click();
    await expect(page.getByText(VL['VL-015'][locale], { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/String must contain|character/);
  });
}

test('private pages are noindex in both languages, carry no hreflang pair and are not in the sitemap', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of ['/cart', '/order', '/order/success?number=X', '/ru/cart', '/ru/order', '/ru/order/success?number=X']) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html, path).not.toMatch(/rel="alternate" hrefLang=/);
    expect(sitemap, path).not.toContain(path.split('?')[0] + '<');
  }
  const robots = await (await request.get('/robots.txt')).text();
  for (const rule of ['/cart', '/order', '/ru/cart', '/ru/order']) expect(robots).toMatch(new RegExp(`^Disallow: ${rule}$`, 'm'));
});
