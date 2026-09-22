import { test, expect } from './helpers/test';

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

const PLACEHOLDERS = [
  'ТОО «MS Стеллаж Казахстан»',
  'MS Стеллаж Казахстан',
  'ул. Алаш',
  'sales@ms-stellazh.kz',
  '+7 (771) 864-67-02',
  '77718646702',
];

/** Server-only SELLER_* values — see src/lib/documents/seller.ts. */
const CONFIDENTIAL = ['KZ31722S000011028184', 'CASPKZKA', 'Kaspi Bank'];

for (const route of ROUTES) {
  test(`${route} carries no placeholder identity, no tel: link and no bank details`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const html = await page.content();
    for (const placeholder of PLACEHOLDERS) expect(html, `${route}: ${placeholder}`).not.toContain(placeholder);
    for (const secret of CONFIDENTIAL) expect(html, `${route}: ${secret}`).not.toContain(secret);
    expect(html).not.toMatch(/БИН:?\s*0{12}/);
    // No fabricated voice number anywhere, in any form.
    expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
  });
}

test('the public offer identifies the real legal seller', async ({ page }) => {
  await page.goto('/ru/terms');
  const text = await page.locator('main').innerText();
  expect(text).toContain('ИП "ГИДРОПРОЕКТ"');
  expect(text).toContain('970115300155');
  expect(text).toContain('г. Астана, ул. А. Иманова, 19');
  expect(text).toContain('serdalybakrambek2@gmail.com');
});

test('the footer separates the brand from the legal seller', async ({ page }) => {
  await page.goto('/ru');
  const footer = page.locator('footer');
  await expect(footer).toContainText('MS Стеллажи');
  await expect(footer).toContainText('ИП "ГИДРОПРОЕКТ"');
  await expect(footer).toContainText('970115300155');
});

test('WhatsApp remains the public contact channel, on the real number', async ({ page }) => {
  await page.goto('/ru/contacts');
  // The header's WhatsApp action is an icon with an aria-label only; the
  // contact details in `main` are where the number itself is readable.
  const link = page.locator('main a[href^="https://wa.me/77071078235"]').first();
  await expect(link).toBeVisible();
  await expect(link).toContainText('+7 707 107 8235');
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
    email: 'serdalybakrambek2@gmail.com',
    address: { streetAddress: 'г. Астана, ул. А. Иманова, 19', addressLocality: 'Астана', addressCountry: 'KZ' },
  });
  for (const key of ['telephone', 'postalCode', 'geo', 'sameAs']) expect(ld).not.toHaveProperty(key);
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
