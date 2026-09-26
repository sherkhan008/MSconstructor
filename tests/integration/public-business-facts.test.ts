import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Catalog } from '@/lib/data/repository';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { localeProps, renderInLocale } from './helpers/public-page';

/**
 * Owner-confirmed business facts (2026-09-21) that public copy must not
 * contradict:
 *
 *   1. Delivery in Алматы, Астана, Караганда and Шымкент is the SAME DAY;
 *      other regions of Kazakhstan take 2–3 days. Nothing may promise
 *      "next day" delivery or quote a 2–7 day manufacturing time.
 *   2. Non-standard (custom) dimensions CANNOT be ordered — only the sizes
 *      offered in the configurator.
 *   3. The configurator's first-run hint speaks customer language
 *      ("точки изменения размера"), not "маркеры".
 *
 * Rendered pages prove what a visitor actually sees; the static scan of
 * public sources catches the same claims in copy no test happens to render.
 */

const CITIES_RU = ['Алматы', 'Астане', 'Караганде', 'Шымкенту'];
const CITIES_PICKUP_RU = ['Алматы', 'Астане', 'Караганде', 'Шымкенте'];
const CITIES_KK = ['Алматы', 'Астана', 'Қарағанды', 'Шымкент'];

/** Lowercased substrings no public page, SEO text or catalog copy may contain. */
const FORBIDDEN_CLAIMS = [
  // next-day delivery
  'следующий день',
  'следующий рабочий день',
  'на след. день',
  'келесі күні',
  'next day',
  'next-day',
  // manufacturing-time claims that contradict same-day delivery
  'срок изготовления',
  'от 2 до 7',
  'дайындау мерзімі',
  // custom / arbitrary dimensions
  'любые размеры',
  'любых размеров',
  'любой размер',
  'нестандартные размеры',
  'нестандартных размеров',
  'нестандартных объёмов',
  'нестандартных заказов',
  'индивидуальный размер',
  'индивидуальные размеры',
  'по вашим размерам',
  'под ваши размеры',
  'кез келген өлшем',
  'стандартты емес өлшемдер',
  'стандартты емес көлем',
  'стандартты емес тапсырыс',
  // developer wording in the configurator hint
  'маркеры',
  'маркерлер',
];

let catalog: Catalog;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '+7 707 107 8235');
  delete process.env.DATABASE_URL;
  delete process.env.NEXT_PHASE;
  const { getCatalog } = await import('@/lib/data/repository');
  catalog = await getCatalog();
});

/** Renders a public page in Russian — the language these copy checks are written in. */
async function renderPage(modulePath: string, params: Record<string, string> = {}): Promise<string> {
  const mod = await import(/* @vite-ignore */ modulePath);
  return await renderInLocale((await mod.default(localeProps('ru', params))) as ReactElement, 'ru');
}

const modelPage = () => renderPage('@/app/[locale]/catalog/[model]/page', { model: 'ms-standard' });

/** Every FAQPage JSON-LD Question on a rendered page, as {question, answer}. */
function faqFromJsonLd(html: string): { question: string; answer: string }[] {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = scripts.find((s) => s['@type'] === 'FAQPage');
  expect(faq, 'FAQPage structured data').toBeDefined();
  return faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => ({ question: q.name, answer: q.acceptedAnswer.text }));
}

function expectNoForbiddenClaim(text: string, where: string) {
  const lower = text.toLowerCase();
  for (const claim of FORBIDDEN_CLAIMS) expect(lower, `${where} contains "${claim}"`).not.toContain(claim);
}

describe('delivery times match the confirmed business model', () => {
  it('the city delivery method states same-day delivery in all four warehouse cities (ru and kk)', () => {
    const city = catalog.deliveryMethods.find((d) => d.kind === 'CITY')!;
    expect(city.description.ru).toBe('Доставка по Алматы, Астане, Караганде и Шымкенту — бесплатно, в тот же день.');
    expect(city.basePrice).toBe(0);
    expect(city.description.kk).toBe('Алматы, Астана, Қарағанды және Шымкент қалаларында жеткізу — тегін, сол күні.');
  });

  it('the Kazakhstan-wide delivery method states 2–3 days for other regions (ru and kk)', () => {
    const country = catalog.deliveryMethods.find((d) => d.kind === 'COUNTRY')!;
    expect(country.description.ru).toBe(
      'Доставка в другие города и регионы Казахстана — 2–3 дня. Стоимость доставки рассчитывается индивидуально.',
    );
    expect(country.description.kk).toBe(
      'Қазақстанның басқа қалалары мен өңірлеріне жеткізу — 2–3 күн. Жеткізу құны жеке есептеледі.',
    );
  });

  it.each([
    ['homepage', () => renderPage('@/app/[locale]/page')],
    ['/delivery', () => renderPage('@/app/[locale]/delivery/page')],
    ['/catalog/ms-standard', modelPage],
  ])('%s names the four cities with same-day delivery and 2–3 days elsewhere', async (_name, render) => {
    const html = await render();
    expect(html).toContain('Доставка по Алматы, Астане, Караганде и Шымкенту — бесплатно, в тот же день');
    expect(html).toContain('2–3 дня');
  });
});

describe('model page FAQ (visible and FAQPage structured data)', () => {
  it('asks about delivery time, not manufacturing time', async () => {
    const html = await modelPage();
    const faq = faqFromJsonLd(html);
    const questions = faq.map((q) => q.question);
    expect(questions).not.toContain('Какой срок изготовления?');
    const delivery = faq.find((q) => q.question === 'Какие сроки доставки?');
    expect(delivery?.answer).toBe(
      'По Алматы, Астане, Караганде и Шымкенту доставляем в тот же день. В другие города и регионы Казахстана — в течение 2–3 дней.',
    );
    const cost = faq.find((q) => q.question === 'Сколько стоит доставка?');
    expect(cost?.answer).toBe(
      'По Алматы, Астане, Караганде и Шымкенту доставка бесплатная. В другие города и регионы Казахстана стоимость доставки рассчитывается индивидуально.',
    );
    // structured data mirrors the visible FAQ exactly
    for (const item of faq) {
      expect(html).toContain(item.question);
      expect(html).toContain(item.answer);
    }
    expect(html).toContain('Какие сроки доставки?');
    expect(html).not.toContain('от 2 до 7');
    for (const cityName of CITIES_RU) expect(delivery?.answer).toContain(cityName);
  });

  it('says plainly that non-standard dimensions cannot be ordered', async () => {
    const html = await modelPage();
    const faq = faqFromJsonLd(html);
    const custom = faq.find((q) => q.question === 'Можно ли заказать нестандартный размер?');
    expect(custom?.answer).toBe('Нет. Доступны только размеры, представленные в конфигураторе.');
    expect(html).toContain('Нет. Доступны только размеры, представленные в конфигураторе.');
    expect(html).not.toContain('индивидуального расчёта');
  });
});

describe('no public page or SEO text claims custom dimensions or next-day delivery', () => {
  it.each([
    ['homepage', () => renderPage('@/app/[locale]/page')],
    ['/delivery', () => renderPage('@/app/[locale]/delivery/page')],
    ['/terms', () => renderPage('@/app/[locale]/terms/page')],
    ['/catalog/ms-standard', modelPage],
  ])('%s', async (name, render) => {
    expectNoForbiddenClaim(await render(), name);
  });

  it('catalog copy (models, SEO, listings, delivery and assembly options) — ru and kk', () => {
    const text = JSON.stringify({
      models: catalog.models.map((m) => ({ name: m.name, description: m.description, seo: m.seo })),
      products: catalog.products.map((p) => ({ name: p.name, description: p.description, seo: p.seo })),
      deliveryMethods: catalog.deliveryMethods,
      assemblyServices: catalog.assemblyServices,
    });
    expectNoForbiddenClaim(text, 'catalog data');
    for (const cityName of CITIES_KK) expect(text).toContain(cityName);
  });

  it('public source files', () => {
    const files = [...walk('src/app'), ...walk('src/components'), ...walk('src/lib/config'), 'src/lib/data/seed-data.ts', 'src/lib/seo.ts']
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => !file.replaceAll('\\', '/').includes('/admin/'));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expectNoForbiddenClaim(readFileSync(file, 'utf8'), file);
  });
});

describe('configurator first-run hint', () => {
  it('asks to drag the resize points, not "маркеры"', async () => {
    const { ShelvingPreview } = await import('@/components/configurator/ShelvingPreview');
    const config: ShelvingConfiguration = {
      modelSlug: 'ms-standard',
      depth: 400,
      sections: [{ id: 'sec-1', width: 1000, height: 2000, shelves: 4, rearWall: false, leftWall: false, rightWall: false }],
      loadCapacity: 150,
      shelfType: 'STANDARD',
      colorId: 'color-grey',
      accessories: [],
      assemblyId: 'assembly-self',
      deliveryId: 'delivery-pickup',
      quantity: 1,
    };
    const html = await renderInLocale(createElement(ShelvingPreview, { config, interactive: true }), 'ru');
    expect(html).toContain('Нажмите на секцию, чтобы выбрать её, или перетащите точки изменения размера.');
    expect(html).not.toContain('перетащите маркеры');
    expect(html).not.toContain('Кликните секцию');
    // Kazakh: the owner-approved hint, the same «нүктелер» (points) wording.
    const kk = await renderInLocale(createElement(ShelvingPreview, { config, interactive: true }), 'kk');
    expect(kk).toContain('Секцияны таңдау үшін басыңыз немесе өлшемді өзгерту нүктелерін сүйреңіз.');
    expect(kk).not.toMatch(/маркер/i);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('price, dimension, warehouse and terms wording', () => {
  const PRICE_RULE = 'Стоимость стеллажа рассчитывается автоматически в конфигураторе на основании выбранной комплектации.';
  const SIZES_RULE = 'Доступны только размеры, представленные в конфигураторе.';

  it('/terms states configurator pricing, size limit, free same-day and 2–3 day delivery', async () => {
    const html = (await renderPage('@/app/[locale]/terms/page')).replace(/\s+/g, ' ');
    expect(html).toContain(PRICE_RULE);
    expect(html).toContain(SIZES_RULE);
    expect(html).toContain('доставка осуществляется бесплатно в тот же день');
    expect(html).toContain('в течение 2–3 дней, стоимость доставки рассчитывается индивидуально');
    expect(html).not.toContain('подтверждаются менеджером');
    expect(html).not.toContain('Итоговая цена подтверждается менеджером');
  });

  it('individual calculation is attached only to delivery cost, never to the shelving price', async () => {
    for (const page of ['@/app/[locale]/terms/page', '@/app/[locale]/delivery/page', '@/app/[locale]/page']) {
      const html = (await renderPage(page)).replace(/\s+/g, ' ').toLowerCase();
      expect(html).not.toMatch(/стоимость стеллажа[^.]*индивидуальн/);
      expect(html).not.toMatch(/цена[^.]*подтверждается менеджером/);
      for (const m of html.matchAll(/[^.]*индивидуальн[^.]*\./g)) {
        expect(m[0], 'sentence: ' + m[0]).toMatch(/доставк|сборк|ral/);
      }
    }
  });

  it('pickup names all four warehouse cities and never a single Алматы warehouse', () => {
    const pickup = catalog.deliveryMethods.find((d) => d.kind === 'PICKUP')!;
    for (const c of CITIES_PICKUP_RU) expect(pickup.description.ru).toContain(c);
    for (const c of CITIES_KK) expect(pickup.description.kk).toContain(c);
    expect(JSON.stringify(catalog.deliveryMethods).toLowerCase()).not.toContain('склад в г. алматы');
    expect(JSON.stringify(catalog.deliveryMethods)).not.toContain('Алматы қаласындағы қоймадан');
  });

  it('/delivery labels city delivery free and other-region delivery individually priced', async () => {
    const html = await renderPage('@/app/[locale]/delivery/page');
    expect(html).toContain('Бесплатно');
    expect(html).toContain('Стоимость доставки рассчитывается индивидуально');
    expect(html).not.toContain('Стоимость уточняется менеджером');
  });
});

describe('localization CSV', () => {
  const buf = readFileSync('docs/localization/public-strings.csv');
  const text = buf.toString('utf8');

  it('is UTF-8 with BOM, has 565 data rows and no replacement characters', () => {
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).not.toContain('\ufffd');
    expect(text.split(/\r?\n/).filter((l) => /^[A-Z]{1,3}-\d{3},/.test(l))).toHaveLength(565);
  });

  it('keeps every Kazakh letter intact', () => {
    for (const ch of 'ҚқӘәғңӨөҰұҮүІі') expect(text).toContain(ch);
    expect(text).not.toMatch(/[\u0400-\u04ff]\?[\u0400-\u04ff]/);
  });
});
