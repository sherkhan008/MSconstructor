import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { site as Site } from '@/lib/config/site';

/**
 * The public legal identity of the seller.
 *
 * Two names coexist on this site and must not drift into each other: the
 * BRAND ("MS Стеллажи") on the logo and titles, and the LEGAL SELLER
 * (ИП "ГИДРОПРОЕКТ") in the offer, the privacy policy, the footer's
 * реквизиты and Organization JSON-LD. These tests render the real public
 * pages and assert (a) that no pre-launch placeholder identity survives
 * anywhere, (b) that the real identity appears where a customer needs it,
 * and (c) that confidential banking details never do.
 */

/**
 * Every placeholder that stood here before the seller was configured. The
 * old WhatsApp fallback digits are included: with
 * NEXT_PUBLIC_WHATSAPP_NUMBER configured (as production requires and this
 * file stubs) they must not appear either.
 */
const PLACEHOLDERS = [
  'ТОО «MS Стеллаж Казахстан»',
  'MS Стеллаж Казахстан',
  'ул. Алаш',
  'sales@ms-stellazh.kz',
  '+7 (771) 864-67-02',
  '77718646702',
];

/** The placeholder BIN, only where a BIN is actually printed — bare twelve
 * zeros also occur inside SVG float coordinates. */
const PLACEHOLDER_BIN = /БИН:?\s*0{12}/;

/** Server-only SELLER_* values. A public page that printed any of these
 * would be leaking the seller's bank account to every visitor. */
const CONFIDENTIAL = ['KZ31722S000011028184', 'CASPKZKA', 'Kaspi Bank', 'SELLER_IBAN'];

/**
 * NEXT_PUBLIC_WHATSAPP_NUMBER is inlined at build time, and `site` reads it
 * once at module load — so it is stubbed before the modules are imported,
 * exactly as a production build supplies it. Nothing here depends on the
 * developer's own .env.
 */
const PAGE_MODULES = {
  homepage: '@/app/page',
  contacts: '@/app/contacts/page',
  privacy: '@/app/privacy/page',
  terms: '@/app/terms/page',
} as const;

type PageName = keyof typeof PAGE_MODULES | 'footer';
const PAGES: readonly PageName[] = ['homepage', 'contacts', 'privacy', 'terms', 'footer'];

let site: typeof Site;
let organizationJsonLd: () => Record<string, unknown>;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '+7 707 107 8235');
  site = (await import('@/lib/config/site')).site;
  organizationJsonLd = (await import('@/lib/seo')).organizationJsonLd as typeof organizationJsonLd;
});

async function markup(page: PageName): Promise<string> {
  if (page === 'footer') {
    const { Footer } = await import('@/components/layout/Footer');
    return renderToStaticMarkup(Footer());
  }
  const mod = await import(/* @vite-ignore */ PAGE_MODULES[page]);
  return renderToStaticMarkup((await mod.default({})) as React.ReactElement);
}

describe('no placeholder seller identity survives on a public page', () => {
  it.each(PAGES)('%s', async (page) => {
    const html = await markup(page);
    for (const placeholder of PLACEHOLDERS) expect(html).not.toContain(placeholder);
    expect(html).not.toMatch(PLACEHOLDER_BIN);
  });

  it('the configuration itself carries no placeholder and no voice phone', () => {
    const json = JSON.stringify(site);
    for (const placeholder of PLACEHOLDERS) expect(json).not.toContain(placeholder);
    expect(json).not.toContain('000000000000');
    // There is no owner-supplied phone: the field must not exist at all,
    // rather than hold a fabricated or WhatsApp-derived number.
    expect(site).not.toHaveProperty('phone');
    expect(site).not.toHaveProperty('phoneHref');
    expect(site.legalName).toBe('ИП "ГИДРОПРОЕКТ"');
    expect(site.bin).toBe('970115300155');
    expect(site.address).toBe('г. Астана, ул. А. Иманова, 19');
    expect(site.email).toBe('serdalybakrambek2@gmail.com');
    // The brand is untouched.
    expect(site.name).toBe('MS Стеллажи');
  });
});

describe('the real legal seller appears where a customer needs it', () => {
  it('the public offer names the seller, its BIN, address and email', async () => {
    const html = await markup('terms');
    expect(html).toContain('ИП &quot;ГИДРОПРОЕКТ&quot;');
    expect(html).toContain('970115300155');
    expect(html).toContain('г. Астана, ул. А. Иманова, 19');
    expect(html).toContain('serdalybakrambek2@gmail.com');
  });

  it('the privacy policy names the seller and its email', async () => {
    const html = await markup('privacy');
    expect(html).toContain('ИП &quot;ГИДРОПРОЕКТ&quot;');
    expect(html).toContain('serdalybakrambek2@gmail.com');
  });

  it('the footer carries the brand, the legal seller and the BIN', async () => {
    const html = await markup('footer');
    expect(html).toContain('MS Стеллажи');
    expect(html).toContain('ИП &quot;ГИДРОПРОЕКТ&quot;');
    expect(html).toContain('970115300155');
  });

  it('contacts shows реквизиты and the address', async () => {
    const html = await markup('contacts');
    expect(html).toContain('ИП &quot;ГИДРОПРОЕКТ&quot;');
    expect(html).toContain('г. Астана, ул. А. Иманова, 19');
  });
});

describe('WhatsApp replaces the phone that was never supplied', () => {
  it.each(PAGES)('%s renders no tel: link', async (page) => {
    expect(await markup(page)).not.toContain('tel:');
  });

  it('the WhatsApp number is public, digits-only in the link and formatted for reading', () => {
    expect(site.whatsapp).toBe('77071078235');
    expect(site.whatsappDisplay).toBe('+7 707 107 8235');
  });

  it.each(['contacts', 'footer', 'homepage'] as const)('%s still offers the WhatsApp contact', async (page) => {
    const html = await markup(page);
    expect(html).toContain('wa.me/77071078235');
    expect(html).toContain('+7 707 107 8235');
  });
});

describe('banking details never reach a public page', () => {
  it.each(PAGES)('%s', async (page) => {
    const html = await markup(page);
    for (const secret of CONFIDENTIAL) expect(html).not.toContain(secret);
  });

  it('nor the site configuration', () => {
    const json = JSON.stringify(site);
    for (const secret of CONFIDENTIAL) expect(json).not.toContain(secret);
  });
});

describe('Organization structured data', () => {
  it('identifies the legal seller, keeps the brand as alternateName', () => {
    const ld = organizationJsonLd();
    expect(ld.name).toBe('ИП "ГИДРОПРОЕКТ"');
    expect(ld.alternateName).toBe('MS Стеллажи');
    expect(ld.taxID).toBe('970115300155');
    expect(ld.email).toBe('serdalybakrambek2@gmail.com');
    expect(ld.address).toMatchObject({
      streetAddress: 'г. Астана, ул. А. Иманова, 19',
      addressLocality: 'Астана',
      addressCountry: 'KZ',
    });
  });

  it('asserts nothing the seller never supplied, and no banking data', () => {
    const json = JSON.stringify(organizationJsonLd());
    for (const placeholder of [...PLACEHOLDERS, ...CONFIDENTIAL, '000000000000']) expect(json).not.toContain(placeholder);
    // No fabricated telephone, postal code, coordinates or social profiles.
    for (const key of ['telephone', 'postalCode', 'geo', 'sameAs']) expect(json).not.toContain(key);
  });
});
