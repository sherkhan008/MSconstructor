import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, config as middlewareConfig } from '@/middleware';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { generateMetadata as homeMetadata } from '@/app/[locale]/page';
import { generateMetadata as catalogMetadata } from '@/app/[locale]/catalog/page';
import { generateMetadata as modelMetadata } from '@/app/[locale]/catalog/[model]/page';
import { generateMetadata as configuratorMetadata } from '@/app/[locale]/configurator/page';
import { generateMetadata as cartMetadata } from '@/app/[locale]/cart/page';
import { generateMetadata as orderMetadata } from '@/app/[locale]/order/page';
import { generateMetadata as orderSuccessMetadata } from '@/app/[locale]/order/success/page';
import { generateMetadata as layoutMetadata, generateStaticParams, dynamicParams } from '@/app/[locale]/layout';
import { appUrl } from '@/lib/env';
import { localeProps } from './helpers/public-page';

/**
 * KZ-first routing: Kazakh at the root, Russian under /ru, one canonical
 * address per page and language, hreflang pairs, both variants in the sitemap.
 */

vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'font', className: 'font' });
  return { Oswald: font, Inter: font, IBM_Plex_Mono: font };
});

async function run(path: string) {
  return middleware(new NextRequest(new URL(path, 'http://localhost')));
}

const url = (path: string) => new URL(path, appUrl).toString();

describe('middleware locale routing', () => {
  it.each(['/', '/catalog', '/catalog/ms-standard', '/configurator', '/cart', '/order', '/order/success', '/delivery'])(
    'Kazakh %s is served at its own URL (rewritten to the kk segment, never redirected)',
    async (path) => {
      const response = await run(path);
      expect(response.status).toBe(200);
      const rewrite = new URL(response.headers.get('x-middleware-rewrite')!);
      expect(rewrite.pathname).toBe(path === '/' ? '/kk' : `/kk${path}`);
    },
  );

  it.each(['/ru', '/ru/catalog', '/ru/catalog/ms-standard', '/ru/configurator', '/ru/cart'])('Russian %s is served as is', async (path) => {
    const response = await run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });

  it.each([
    ['/kk', '/'],
    ['/kk/catalog', '/catalog'],
    ['/kk/catalog/ms-standard?x=1', '/catalog/ms-standard?x=1'],
    ['/ru/ru/catalog', '/ru/catalog'],
    ['/ru/ru', '/ru'],
    ['/kk/ru/catalog', '/catalog'],
    ['/ru/kk/cart', '/ru/cart'],
    ['/checkout', '/order'],
    ['/ru/checkout', '/ru/order'],
  ])('%s → 308 %s (single canonical address, no loop)', async (from, to) => {
    const response = await run(from);
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get('location')!);
    expect(`${location.pathname}${location.search}`).toBe(to);
    // The redirect target is itself final.
    const again = await run(to);
    expect(again.status).toBe(200);
  });

  it('keeps protecting the admin panel, unlocalized', async () => {
    const response = await run('/admin/orders');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/admin/login');
  });

  it('never runs for the API or static files', () => {
    const [matcher] = middlewareConfig.matcher;
    const re = new RegExp(`^${matcher}$`);
    for (const path of ['/api/orders', '/api/pricing/calculate', '/_next/static/x.js', '/sitemap.xml', '/robots.txt', '/images/a.svg']) {
      expect(re.test(path), path).toBe(false);
    }
    for (const path of ['/', '/catalog', '/ru/catalog', '/admin', '/admin/orders']) expect(re.test(path), path).toBe(true);
  });
});

describe('route tree', () => {
  function dirs(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
      const path = join(root, name);
      return statSync(path).isDirectory() ? [path, ...dirs(path)] : [];
    });
  }

  it('has no localized copy of the API or the admin panel', () => {
    const localized = dirs(join('src', 'app', '[locale]')).map((d) => d.replace(/\\/g, '/'));
    expect(localized.some((d) => /\/(api|admin)(\/|$)/.test(d))).toBe(false);
    expect(existsSync(join('src', 'app', 'api'))).toBe(true);
    expect(existsSync(join('src', 'app', 'admin', 'layout.tsx'))).toBe(true);
  });

  it('keeps the admin panel Russian-only, with its own <html lang="ru"> and no public chrome', () => {
    const layout = readFileSync(join('src', 'app', 'admin', 'layout.tsx'), 'utf8');
    expect(layout).toContain('<html lang="ru"');
    expect(layout).not.toMatch(/LocaleProvider|LanguageSwitcher|<Header|<Footer/);
  });

  it('prebuilds exactly the two public locales and 404s anything else', () => {
    expect(generateStaticParams()).toEqual([{ locale: 'kk' }, { locale: 'ru' }]);
    expect(dynamicParams).toBe(false);
  });
});

describe('metadata: canonical, hreflang and Open Graph', () => {
  it('Kazakh pages are canonical at the root URL; Russian pages at /ru — never canonicalized to Kazakh', async () => {
    const pages = [
      ['/', homeMetadata(localeProps('kk')), homeMetadata(localeProps('ru'))],
      ['/catalog', catalogMetadata(localeProps('kk')), catalogMetadata(localeProps('ru'))],
      ['/catalog/ms-standard', modelMetadata(localeProps('kk', { model: 'ms-standard' })), modelMetadata(localeProps('ru', { model: 'ms-standard' }))],
      ['/configurator', configuratorMetadata(localeProps('kk')), configuratorMetadata(localeProps('ru'))],
    ] as const;
    for (const [path, kkPromise, ruPromise] of pages) {
      const kk = await kkPromise;
      const ru = await ruPromise;
      const kkUrl = url(path);
      const ruUrl = url(path === '/' ? '/ru' : `/ru${path}`);

      expect(kk.alternates?.canonical, path).toBe(kkUrl);
      expect(ru.alternates?.canonical, path).toBe(ruUrl);
      // hreflang pairs the same two URLs from both sides; x-default → the Kazakh root URL.
      const pair = { kk: kkUrl, ru: ruUrl, 'x-default': kkUrl };
      expect(kk.alternates?.languages, path).toEqual(pair);
      expect(ru.alternates?.languages, path).toEqual(pair);
      expect(kk.openGraph).toMatchObject({ url: kkUrl, locale: 'kk_KZ' });
      expect(ru.openGraph).toMatchObject({ url: ruUrl, locale: 'ru_KZ' });
      expect(kk.title).not.toBe(ru.title);
    }
  });

  it('localizes the title, description and Open Graph text', async () => {
    const kk = await catalogMetadata(localeProps('kk'));
    const ru = await catalogMetadata(localeProps('ru'));
    expect(ru.title).toBe('Каталог металлических стеллажей MS — цены и характеристики');
    expect(String(kk.title)).toMatch(/[әғқңөұүһі]/i);
    expect(String(kk.description)).toMatch(/[әғқңөұүһі]/i);
    const kkModel = await modelMetadata(localeProps('kk', { model: 'ms-standard' }));
    expect(kkModel.title).toBe('MS Стандарт стеллаж— модульдік металл стеллажы | Қазақстанда сатып алу');
  });

  it('keeps cart, checkout and order success out of the index, symmetrically in both languages', async () => {
    const pages = [
      ['/cart', cartMetadata],
      ['/order', orderMetadata],
      ['/order/success', orderSuccessMetadata],
    ] as const;
    for (const [path, metadata] of pages) {
      for (const locale of ['kk', 'ru'] as const) {
        const meta = await metadata(localeProps(locale));
        const own = url(locale === 'ru' ? `/ru${path}` : path);
        expect(meta.robots, `${locale} ${path}`).toEqual({ index: false, follow: false });
        // Its own URL only — never canonicalized to the other language, and no hreflang pair to announce.
        expect(meta.alternates, `${locale} ${path}`).toEqual({ canonical: own });
      }
    }
  });

  it('layout defaults: localized brand title and keywords, legal seller as author', async () => {
    const kk = await layoutMetadata({ params: Promise.resolve({ locale: 'kk' }) });
    const ru = await layoutMetadata({ params: Promise.resolve({ locale: 'ru' }) });
    expect(ru.title).toMatchObject({ default: 'MS Стеллажи — модульные металлические стеллажи | Казахстан' });
    expect(kk.title).toMatchObject({ default: 'MS Стеллаждар — модульдік металл стеллаждар | Қазақстан' });
    expect(kk.authors).toEqual([{ name: 'ИП "ГИДРОПРОЕКТ"' }]);
    expect(ru.authors).toEqual(kk.authors);
    expect(kk.openGraph).toMatchObject({ locale: 'kk_KZ' });
  });
});

describe('sitemap and robots', () => {
  it('lists every public page in both languages, each with its hreflang pair', async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    for (const path of ['/', '/catalog', '/configurator', '/delivery', '/payment', '/contacts', '/privacy', '/terms', '/catalog/ms-standard']) {
      const kk = url(path);
      const ru = url(path === '/' ? '/ru' : `/ru${path}`);
      expect(urls, path).toContain(kk);
      expect(urls, path).toContain(ru);
      const entry = entries.find((e) => e.url === ru)!;
      expect(entry.alternates?.languages).toEqual({ kk, ru, 'x-default': kk });
    }
  });

  it('excludes admin, API, cart/checkout, order pages and hidden models', async () => {
    const urls = (await sitemap()).map((e) => new URL(e.url).pathname);
    for (const path of urls) {
      expect(path).not.toMatch(/^\/(ru\/)?(admin|api|cart|order|checkout|kk)(\/|$)/);
      expect(path).not.toMatch(/ms-strong|archive-ms/);
    }
  });

  it('robots keeps the cart/order flow of both languages out, and nothing public', () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules[0] : rules).disallow as string[];
    for (const path of ['/admin', '/api', '/cart', '/order', '/ru/cart', '/ru/order']) expect(disallow).toContain(path);
    // robots.txt Disallow is a path prefix: /order also covers /order/success, /ru/order covers /ru/order/success.
    const blocked = (path: string) => disallow.some((rule) => path === rule || path.startsWith(rule.endsWith('/') ? rule : `${rule}/`) || path.startsWith(`${rule}?`));
    for (const path of ['/order/success', '/ru/order/success', '/cart', '/ru/cart']) expect(blocked(path), path).toBe(true);
    for (const path of ['/', '/ru', '/catalog', '/ru/catalog', '/catalog/ms-standard', '/ru/catalog/ms-standard', '/configurator', '/ru/configurator', '/delivery', '/ru/delivery', '/payment', '/ru/payment', '/contacts', '/ru/contacts', '/privacy', '/ru/privacy', '/terms', '/ru/terms']) {
      expect(blocked(path), path).toBe(false);
    }
  });
});
