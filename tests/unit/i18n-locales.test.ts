import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  HTML_LANG,
  LOCALES,
  SWITCHABLE_QUERY_KEYS,
  isLocale,
  localizePath,
  safeSwitchQuery,
  splitLocalePath,
  switchLocaleHref,
} from '@/lib/i18n/locales';
import { configurationToSearchParams } from '@/lib/configurator/url';
import type { ShelvingConfiguration } from '@/lib/types/domain';

/**
 * KZ-first URL scheme: Kazakh at the unprefixed root, Russian under /ru.
 * No /kk prefix, no English, no localized /admin or /api.
 */

describe('public locales', () => {
  it('are exactly Kazakh (primary, unprefixed) and Russian — no English', () => {
    expect(LOCALES).toEqual(['kk', 'ru']);
    expect(DEFAULT_LOCALE).toBe('kk');
    expect(isLocale('en')).toBe(false);
    expect(HTML_LANG).toEqual({ kk: 'kk', ru: 'ru' });
  });
});

describe('localizePath', () => {
  it.each([
    ['/', '/', '/ru'],
    ['/catalog', '/catalog', '/ru/catalog'],
    ['/catalog/ms-standard', '/catalog/ms-standard', '/ru/catalog/ms-standard'],
    ['/configurator?model=ms-standard', '/configurator?model=ms-standard', '/ru/configurator?model=ms-standard'],
    ['/cart', '/cart', '/ru/cart'],
    ['/order', '/order', '/ru/order'],
    ['/order/success?number=MS-1', '/order/success?number=MS-1', '/ru/order/success?number=MS-1'],
    ['/delivery', '/delivery', '/ru/delivery'],
  ])('%s → kk %s, ru %s', (path, kk, ru) => {
    expect(localizePath(path, 'kk')).toBe(kk);
    expect(localizePath(path, 'ru')).toBe(ru);
  });

  it('never prefixes the admin panel, the API or external URLs', () => {
    for (const href of ['/admin', '/admin/orders', '/api/orders', 'https://wa.me/7700', 'mailto:a@b.kz', '//evil.example']) {
      expect(localizePath(href, 'ru')).toBe(href);
    }
  });
});

describe('splitLocalePath', () => {
  it.each([
    ['/', 'kk', '/'],
    ['/catalog', 'kk', '/catalog'],
    ['/ru', 'ru', '/'],
    ['/ru/catalog/ms-standard', 'ru', '/catalog/ms-standard'],
    // "/russia" is not the Russian prefix.
    ['/russia', 'kk', '/russia'],
  ])('%s → %s %s', (pathname, locale, path) => {
    expect(splitLocalePath(pathname)).toEqual({ locale, path });
  });
});

describe('language switcher target (equivalent page, never the homepage)', () => {
  it.each([
    ['/', '/ru'],
    ['/catalog', '/ru/catalog'],
    ['/catalog/ms-standard', '/ru/catalog/ms-standard'],
    ['/configurator', '/ru/configurator'],
    ['/cart', '/ru/cart'],
    ['/order', '/ru/order'],
    ['/delivery', '/ru/delivery'],
    ['/payment', '/ru/payment'],
    ['/contacts', '/ru/contacts'],
    ['/privacy', '/ru/privacy'],
    ['/terms', '/ru/terms'],
  ])('%s ↔ %s', (kk, ru) => {
    expect(switchLocaleHref(kk, '', 'ru')).toBe(ru);
    expect(switchLocaleHref(ru, '', 'kk')).toBe(kk);
    expect(switchLocaleHref(kk, '', 'kk')).toBe(kk);
    expect(switchLocaleHref(ru, '', 'ru')).toBe(ru);
  });

  it('carries a full configurator share link across unchanged', () => {
    const config: ShelvingConfiguration = {
      modelSlug: 'ms-standard',
      depth: 400,
      sections: [
        { id: 'a', width: 1000, height: 2000, shelves: 5, rearWall: true, leftWall: false, rightWall: false },
        { id: 'b', width: 700, height: 2000, shelves: 5, rearWall: false, leftWall: true, rightWall: true },
      ],
      loadCapacity: 150,
      shelfType: 'STANDARD',
      colorId: 'color-grey',
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'a' }],
      assemblyId: 'assembly-professional',
      deliveryId: 'delivery-city',
      quantity: 3,
      metalFootPad: true,
      shelfCornerBrackets: true,
    };
    const query = configurationToSearchParams(config);
    const ru = switchLocaleHref('/configurator', `?${query}`, 'ru');
    expect(ru.startsWith('/ru/configurator?')).toBe(true);
    const carried = new URLSearchParams(ru.split('?')[1]);
    for (const [key, value] of query) expect(carried.get(key), key).toBe(value);
    // …and back to Kazakh, byte-identical state.
    const kk = switchLocaleHref('/ru/configurator', `?${carried}`, 'kk');
    expect(new URLSearchParams(kk.split('?')[1]).toString()).toBe(new URLSearchParams(carried).toString());
  });

  it('allow-lists every key the configurator share link can contain', () => {
    const everyKey = configurationToSearchParams({
      modelSlug: 'ms-standard', depth: 400,
      sections: [{ id: 'a', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false }],
      loadCapacity: 150, shelfType: 'STANDARD', colorId: 'color-grey',
      accessories: [{ accessoryId: 'acc-adjustable-feet', quantity: 1 }],
      assemblyId: 'assembly-self', deliveryId: 'delivery-pickup', quantity: 1,
      promoCode: 'X', metalFootPad: true, shelfCornerBrackets: true,
    });
    for (const key of everyKey.keys()) expect(SWITCHABLE_QUERY_KEYS['/configurator'], key).toContain(key);
  });

  it('keeps catalog filters and the order number on their own pages only', () => {
    expect(switchLocaleHref('/catalog', '?model=ms-standard&sort=price_asc&availability=in_stock&useCase=garage', 'ru')).toBe(
      '/ru/catalog?model=ms-standard&useCase=garage&availability=in_stock&sort=price_asc',
    );
    expect(switchLocaleHref('/ru/order/success', '?number=MS-20260921-00001', 'kk')).toBe('/order/success?number=MS-20260921-00001');
    // A configurator key means nothing on the homepage.
    expect(switchLocaleHref('/', '?height=2000', 'ru')).toBe('/ru');
  });

  it('drops unknown, tracking and redirect-style parameters, and oversized values', () => {
    const search = '?utm_source=x&redirect=https://evil.example&next=//evil&__proto__=1&model=ms-standard&sections=' + 'x'.repeat(600);
    expect(safeSwitchQuery('/configurator', search)).toBe('?model=ms-standard');
    expect(switchLocaleHref('/catalog', '?utm_source=x&returnTo=/admin', 'ru')).toBe('/ru/catalog');
  });
});
