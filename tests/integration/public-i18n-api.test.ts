import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as pricingPost } from '@/app/api/pricing/calculate/route';
import { POST as ordersPost } from '@/app/api/orders/route';
import { POST as contactPost } from '@/app/api/contact/route';
import { clearMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { LOCALE_HEADER, type Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { ER, VL } from '@/lib/i18n/strings';

/**
 * Public API messages follow the locale the page declares in LOCALE_HEADER.
 * Numbers never depend on it, server validation stays authoritative, field
 * errors stay structured, and nothing is inferred from message text.
 */

let ip = 0;
function post(handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown, locale?: Locale) {
  ip += 1;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-forwarded-for': `10.77.${Math.floor(ip / 250)}.${ip % 250}` };
  if (locale) headers[LOCALE_HEADER] = locale;
  return handler(new NextRequest(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
}
const price = (body: unknown, locale?: Locale) => post(pricingPost, '/api/pricing/calculate', body, locale);
const order = (body: unknown, locale?: Locale) => post(ordersPost, '/api/orders', body, locale);

const configuration = (extra: Record<string, unknown> = {}) => ({
  modelSlug: 'ms-standard',
  depth: 400,
  sections: [
    { id: 'a', width: 1000, height: 2000, shelves: 5, rearWall: true, leftWall: false, rightWall: true },
    { id: 'b', width: 700, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false },
  ],
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'a' }],
  assemblyId: 'assembly-professional',
  deliveryId: 'delivery-country',
  quantity: 3,
  ...extra,
});

const orderBody = (extra: Record<string, unknown> = {}) => ({
  fullName: 'Тест Тестов',
  phone: '+77001234567',
  email: 'test@example.com',
  city: 'Павлодар',
  deliveryAddress: 'көше 1',
  customerType: 'INDIVIDUAL',
  paymentPreference: 'BANK_TRANSFER',
  items: [{ configuration: configuration() }],
  ...extra,
});

beforeEach(() => clearMemoryOrders());

describe('/api/pricing/calculate', () => {
  it('returns numerically identical results for kk, ru and no header', async () => {
    const [kk, ru, none] = await Promise.all([price(configuration(), 'kk'), price(configuration(), 'ru'), price(configuration())]);
    const [a, b, c] = await Promise.all([kk.json(), ru.json(), none.json()]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(a.breakdown).toEqual({ ...b.breakdown, discountReasons: a.breakdown.discountReasons });
    expect(b.breakdown).toEqual(c.breakdown);
    expect(a.totalWeightKg).toBe(b.totalWeightKg);
    expect(a.rowLengthMm).toBe(b.rowLengthMm);
    expect(a.configuration).toEqual(b.configuration);
    // Same kit, same quantities — only the names are in the page language.
    expect(a.bom.map((l: { componentId: string; quantity: number }) => [l.componentId, l.quantity])).toEqual(
      b.bom.map((l: { componentId: string; quantity: number }) => [l.componentId, l.quantity]),
    );
    expect(a.bom.map((l: { name: string }) => l.name)).not.toEqual(b.bom.map((l: { name: string }) => l.name));
    expect(b.bom.some((l: { name: string }) => l.name.startsWith('Полка'))).toBe(true);
    expect(a.bom.some((l: { name: string }) => /сөре/.test(l.name))).toBe(true);
    // The individual-delivery note in the customer's language.
    expect(a.deliveryNote).toBe(t(ER['ER-024'], 'kk'));
    expect(b.deliveryNote).toBe(t(ER['ER-024'], 'ru'));
  });

  it('answers compatibility errors in the active locale', async () => {
    const bad = configuration({ sections: configuration().sections.map((s) => ({ ...s, height: 2345 })) });
    const kk = await (await price(bad, 'kk')).json();
    const ru = await (await price(bad, 'ru')).json();
    expect(kk).toMatchObject({ ok: false, code: 'INCOMPATIBLE_CONFIGURATION', message: t(ER['ER-036'], 'kk', { H: 2345 }) });
    expect(ru).toMatchObject({ ok: false, code: 'INCOMPATIBLE_CONFIGURATION', message: 'Высота 2345 мм недоступна' });
    expect(kk.details).toContain(t(ER['ER-054'], 'kk', { H: 2345 }));
  });

  it('answers schema validation errors in the active locale, without field paths', async () => {
    const bad = configuration({ sections: [] });
    const kk = await (await price(bad, 'kk')).json();
    expect(kk.message).toBe(t(ER['ER-019'], 'kk'));
    expect(kk.details).toContain(t(VL['VL-010'], 'kk'));
    expect(JSON.stringify(kk)).not.toMatch(/sections\.\d|sections:/);
  });

  it('ignores an unknown locale value and answers in Russian (the API default)', async () => {
    const response = await price(configuration({ sections: configuration().sections.map((s) => ({ ...s, height: 2345 })) }), 'en' as Locale);
    expect((await response.json()).message).toBe('Высота 2345 мм недоступна');
  });
});

describe('/api/orders', () => {
  it('reports form validation errors in the active locale, as structured field errors', async () => {
    const body = orderBody({ fullName: 'A', city: '', email: 'x' });
    const kk = await (await order(body, 'kk')).json();
    const ru = await (await order(body, 'ru')).json();
    expect(kk.message).toBe(t(ER['ER-005'], 'kk'));
    expect(ru.message).toBe('Проверьте правильность заполнения формы');
    expect(kk.fieldErrors).toEqual(
      expect.arrayContaining([
        { field: 'fullName', message: t(VL['VL-002'], 'kk') },
        { field: 'email', message: t(VL['VL-003'], 'kk') },
        { field: 'city', message: t(VL['VL-014'], 'kk') },
      ]),
    );
    expect(ru.fieldErrors).toEqual(expect.arrayContaining([{ field: 'city', message: 'Укажите город' }]));
    // Same fields fail in both languages — validation itself is locale-independent.
    expect(kk.fieldErrors.map((e: { field: string }) => e.field)).toEqual(ru.fieldErrors.map((e: { field: string }) => e.field));
  });

  it('explains the four-city delivery rule in the active locale', async () => {
    const body = orderBody({ items: [{ configuration: configuration({ deliveryId: 'delivery-city' }) }] });
    const kk = await (await order(body, 'kk')).json();
    const ru = await (await order(body, 'ru')).json();
    expect(kk.fieldErrors).toEqual([{ field: 'city', message: t(VL['VL-013'], 'kk') }]);
    expect(ru.fieldErrors).toEqual([{ field: 'city', message: t(VL['VL-013'], 'ru') }]);
  });

  it('reports a cart configuration that cannot be priced in the active locale', async () => {
    const body = orderBody({ items: [{ configuration: configuration({ sections: configuration().sections.map((s) => ({ ...s, height: 2345 })) }) }] });
    const kk = await (await order(body, 'kk')).json();
    expect(kk.message).toBe(t(ER['ER-006'], 'kk', { reason: t(ER['ER-036'], 'kk', { H: 2345 }) }));
  });

  it.each(['kk', 'ru'] as const)('creates an order from a %s page with exactly the same stored amounts', async (locale) => {
    const response = await order(orderBody(), locale);
    expect(response.status).toBe(201);
    const created = await response.json();
    const stored = await getOrderByNumber(created.orderNumber);
    expect(stored).toBeDefined();

    clearMemoryOrders();
    const reference = await (await order(orderBody(), locale === 'kk' ? 'ru' : 'kk')).json();
    expect(created.grandTotal).toBe(reference.grandTotal);
    // What is stored for the admin panel and documents is the same (Russian) whatever the page language.
    expect(stored!.items[0].breakdown.discountReasons.join(' ')).not.toMatch(/[әғқңөұүһі]/i);
    expect(stored!.items[0].modelName).toBe('MS Стандарт');
  });
});

describe('/api/contact', () => {
  it('validates and confirms in the active locale', async () => {
    const invalid = await (await post(contactPost, '/api/contact', { name: 'A', phone: '1', message: 'x' }, 'kk')).json();
    expect(invalid.message).toBe(t(ER['ER-005'], 'kk'));
    expect(invalid.fieldErrors).toEqual(expect.arrayContaining([{ field: 'name', message: t(VL['VL-002'], 'kk') }, { field: 'phone', message: t(VL['VL-001'], 'kk') }]));
    const ok = await (await post(contactPost, '/api/contact', { name: 'Айгүл', phone: '+77001234567', message: 'Сәлем' }, 'kk')).json();
    expect(ok).toMatchObject({ ok: true, message: t(ER['ER-058'], 'kk') });
  });

  it('reports an empty message in the active locale, never the English Zod default', async () => {
    for (const locale of ['kk', 'ru'] as const) {
      const body = { name: 'Айгүл', phone: '+77001234567', message: '   ' };
      const response = await (await post(contactPost, '/api/contact', body, locale)).json();
      expect(response.fieldErrors).toEqual([{ field: 'message', message: t(VL['VL-015'], locale) }]);
      expect(JSON.stringify(response)).not.toMatch(/String must contain|Required|character/);
    }
    expect(t(VL['VL-015'], 'ru')).toBe('Введите сообщение');
    expect(t(VL['VL-015'], 'kk')).toBe('Хабарламаны енгізіңіз');
  });

  it('reports an over-long name or message in the active locale, with the unchanged limits', async () => {
    for (const locale of ['kk', 'ru'] as const) {
      const body = { name: 'А'.repeat(201), phone: '+77001234567', message: 'М'.repeat(2001) };
      const response = await (await post(contactPost, '/api/contact', body, locale)).json();
      expect(response.fieldErrors).toEqual([
        { field: 'name', message: t(VL['VL-016'], locale, { N: 200 }) },
        { field: 'message', message: t(VL['VL-017'], locale, { N: 2000 }) },
      ]);
      expect(JSON.stringify(response)).not.toMatch(/String must contain|character/);
      // Exactly at the limits is still accepted.
      const atLimit = await (await post(contactPost, '/api/contact', { name: 'А'.repeat(200), phone: '+77001234567', message: 'М'.repeat(2000) }, locale)).json();
      expect(atLimit.ok).toBe(true);
    }
    expect(t(VL['VL-016'], 'ru', { N: 200 })).toBe('Имя не должно быть длиннее 200 символов');
    expect(t(VL['VL-017'], 'kk', { N: 2000 })).toBe('Хабарлама 2000 таңбадан аспауы керек');
  });

  it('confirms in the active locale', async () => {
    const ok = await (await post(contactPost, '/api/contact', { name: 'Айгүл', phone: '+77001234567', message: 'Сәлем' }, 'ru')).json();
    expect(ok).toMatchObject({ ok: true, message: t(ER['ER-058'], 'ru') });
  });
});
