import { test, expect } from './helpers/test';
import { SELLER_BANKING_SENTINELS } from '../fixtures/seller-banking-sentinels';
import { site } from '../../src/lib/config/site';

/**
 * The seller's public legal identity, as a visitor's browser actually
 * receives it — header and footer included (client components the SSR
 * integration test cannot render), plus the client bundle itself.
 *
 * The brand ("MS Стеллажи") and the legal seller (ИП "ГИДРОПРОЕКТ") are
 * separate: the first is the shop's name, the second identifies who sells in
 * the offer, the privacy policy and the реквизиты. No pre-launch placeholder
 * may survive, no voice phone may be invented, and the seller's bank details
 * must never leave the server.
 */

// Both public languages carry the same legal identity.
const ROUTES = ['/', '/contacts', '/privacy', '/terms', '/catalog', '/delivery'].flatMap((r) => [r, r === '/' ? '/ru' : `/ru${r}`]);

// The pre-launch phone fallback is covered by the tel: and WhatsApp checks below.
const PLACEHOLDERS = [
  'ТОО «MS Стеллаж Казахстан»',
  'MS Стеллаж Казахстан',
  'ул. Алаш',
  'sales@ms-stellazh.kz',
];

/**
 * Server-only SELLER_* banking values — see src/lib/documents/seller.ts.
 * playwright.config.ts starts the server with the synthetic sentinels; when
 * the runner's environment (the developer's .env, a CI secret) holds real
 * values, those are checked too — read at runtime, never written here.
 */
/** Any email address: the company publishes none (WhatsApp only), and these
 * pages carry no customer data that could hold one. */
const ANY_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const CONFIDENTIAL = [
  ...new Set([
    ...Object.values(SELLER_BANKING_SENTINELS),
    ...[process.env.SELLER_IBAN, process.env.SELLER_BIC, process.env.SELLER_BANK_NAME]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value),
  ]),
];

for (const route of ROUTES) {
  test(`${route} carries no placeholder identity, no tel:/mailto: link, no email and no bank details`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const html = await page.content();
    for (const placeholder of PLACEHOLDERS) expect(html, `${route}: ${placeholder}`).not.toContain(placeholder);
    for (const secret of CONFIDENTIAL) expect(html, `${route}: ${secret}`).not.toContain(secret);
    expect(html).not.toMatch(/БИН:?\s*0{12}/);
    // No fabricated voice number anywhere, in any form.
    expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
    // No company email: WhatsApp is the only public contact channel.
    expect(await page.locator('a[href^="mailto:"]').count()).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(ANY_EMAIL);
    for (const raw of await page.locator('script[type="application/ld+json"]').allTextContents()) {
      expect(raw, `${route}: JSON-LD`).not.toMatch(ANY_EMAIL);
    }
  });
}

test('the public offer identifies the real legal seller', async ({ page }) => {
  await page.goto('/ru/terms');
  const text = await page.locator('main').innerText();
  expect(text).toContain('ИП "ГИДРОПРОЕКТ"');
  expect(text).toContain('970115300155');
  expect(text).toContain('г. Астана, ул. А. Иманова, 19');
  expect(text).not.toMatch(ANY_EMAIL);
});

test('the footer separates the brand from the legal seller', async ({ page }) => {
  await page.goto('/ru');
  const footer = page.locator('footer');
  await expect(footer).toContainText('MS Стеллажи');
  await expect(footer).toContainText('ИП "ГИДРОПРОЕКТ"');
  await expect(footer).toContainText('970115300155');
  // WhatsApp is the footer's contact; there is no company email.
  await expect(footer.locator('a[href^="https://wa.me/"]').first()).toBeVisible();
  expect(await footer.locator('a[href^="mailto:"]').count()).toBe(0);
  expect(await footer.innerText()).not.toMatch(ANY_EMAIL);
});

test('WhatsApp remains the public contact channel, on the configured public number', async ({ page }) => {
  await page.goto('/ru/contacts');
  // The header's WhatsApp action is an icon with an aria-label only; the
  // contact details in `main` are where the number itself is readable.
  // The number is the one the app itself resolves from the build's
  // NEXT_PUBLIC_WHATSAPP_NUMBER (`site`), so this holds with or without a
  // developer .env; that the configured value is the seller's real number is
  // pinned in tests/integration/public-legal-identity.test.ts.
  const link = page.locator(`main a[href^="https://wa.me/${site.whatsapp}"]`).first();
  await expect(link).toBeVisible();
  await expect(link).toContainText(site.whatsappDisplay);
  // Reachable without a mouse and large enough to tap.
  await link.focus();
  await expect(link).toBeFocused();
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(20);
});

test('Organization structured data names the legal seller and asserts nothing invented', async ({ page }) => {
  await page.goto('/ru/contacts');
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  const ld = JSON.parse(raw!);
  expect(ld).toMatchObject({
    '@type': 'Organization',
    name: 'ИП "ГИДРОПРОЕКТ"',
    alternateName: 'MS Стеллажи',
    taxID: '970115300155',
    address: { streetAddress: 'г. Астана, ул. А. Иманова, 19', addressLocality: 'Астана', addressCountry: 'KZ' },
  });
  for (const key of ['telephone', 'postalCode', 'geo', 'sameAs', 'email']) expect(ld).not.toHaveProperty(key);
});

test('the client bundle carries no seller bank details', async ({ page, request }) => {
  await page.goto('/ru');
  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => (n as HTMLScriptElement).src));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    const body = await (await request.get(src)).text();
    for (const secret of CONFIDENTIAL) expect(body, `${src}: ${secret}`).not.toContain(secret);
  }
});
