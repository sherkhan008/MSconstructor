import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildOrderEvent } from '@/lib/notifications/events';
import { createTelegramChannel, defaultChannels, type NotificationChannel } from '@/lib/notifications/channels';
import {
  WHATSAPP_TEMPLATE_PARAMETERS,
  buildWhatsAppTemplateParameters,
  createWhatsAppChannel,
  type WhatsAppChannelOptions,
} from '@/lib/notifications/providers/whatsapp';
import { resolveWhatsAppConfig, type WhatsAppConfigResolution } from '@/lib/notifications/providers/whatsapp-config';
import { emitOrderEvent, retryFailedDeliveries } from '@/lib/notifications/service';
import { clearMemoryDeliveries, getMemoryDeliveries } from '@/lib/notifications/store';
import { publicEnv } from '@/lib/env';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * WhatsApp Cloud API internal new-order alert
 * (src/lib/notifications/providers/whatsapp.ts). Meta is always mocked: the
 * global fetch throws, so any accidental real network call fails the test.
 */

const TOKEN = 'EAAG-SECRET-ACCESS-TOKEN-xyz';

const WHATSAPP_ENV = {
  WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ADMIN_RECIPIENT: '+7 (701) 000-00-01',
  WHATSAPP_TEMPLATE_NAME: 'new_order_admin',
  WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
  WHATSAPP_GRAPH_API_VERSION: 'v24.0',
};

const READY = resolveWhatsAppConfig(WHATSAPP_ENV);

/** Internal-only values that must never reach the admin message. */
const INTERNAL = ['SUPPLIER-SKU-777', 'Поставщик ТОО Металл', '987654', 'internalDetails'];

const ORDER: OrderRecord = {
  id: 'order-1',
  orderNumber: 'MS-250921-0001',
  status: 'NEW',
  customer: {
    fullName: 'Тест Тестов',
    phone: '+7 700 123 45 67',
    whatsapp: '+77009998877',
    email: 'test@example.com',
    city: 'Алматы',
    companyName: 'ТОО Клиент',
    binIin: '123456789012',
    type: 'INDIVIDUAL',
  },
  deliveryAddress: 'ул. Секретная, 1',
  paymentPreference: 'BANK_TRANSFER',
  comment: 'Позвоните после 18:00',
  items: [
    {
      configuration: {} as OrderRecord['items'][number]['configuration'],
      bom: [{ sku: INTERNAL[0], name: INTERNAL[1], quantity: 4 } as unknown as OrderRecord['items'][number]['bom'][number]],
      breakdown: { net: 100000, vat: 12000, discount: 0, total: 112000, purchaseCost: 987654 } as unknown as OrderRecord['items'][number]['breakdown'],
      modelName: 'MS Standard',
      documentSnapshot: { deliveryName: 'Самовывоз' } as OrderRecord['items'][number]['documentSnapshot'],
    },
  ],
  netTotal: 100000,
  vatTotal: 12000,
  discountTotal: 0,
  grandTotal: 112000,
  createdAt: '2026-09-21T10:00:00.000Z',
};

const created = buildOrderEvent({
  event: 'order.created',
  orderNumber: ORDER.orderNumber,
  status: 'NEW',
  grandTotal: ORDER.grandTotal,
});

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function metaMock(respond: () => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>) {
  const calls: CapturedCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return respond();
  });
  return { calls, fetchMock };
}

function whatsapp(
  fetchMock: NonNullable<WhatsAppChannelOptions['fetch']>,
  config: WhatsAppConfigResolution = READY,
  extra: WhatsAppChannelOptions = {},
): NotificationChannel {
  return createWhatsAppChannel({ config, fetch: fetchMock, loadOrder: async (n) => (n === ORDER.orderNumber ? ORDER : undefined), ...extra });
}

function templateTexts(call: CapturedCall): string[] {
  const template = call.body.template as { components: { parameters: { text: string }[] }[] };
  return template.components[0].parameters.map((p) => p.text);
}

describe('WhatsApp new-order admin notification', () => {
  let logs: string[];
  let globalFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearMemoryDeliveries();
    logs = [];
    for (const level of ['warn', 'error', 'info', 'log'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
    }
    globalFetch = vi.fn(async () => {
      throw new Error('network must not be used');
    });
    vi.stubGlobal('fetch', globalFetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('disabled: not a default channel, zero network calls, nothing recorded', async () => {
    expect(defaultChannels().map((c) => c.id)).toEqual(['telegram', 'email']);
    await emitOrderEvent(created);
    const disabled = createWhatsAppChannel({ config: { state: 'disabled' } });
    expect(disabled.availability()).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    expect(await disabled.send(created)).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
    await emitOrderEvent(created, { channels: () => [disabled] });
    expect(globalFetch).not.toHaveBeenCalled();
    expect(getMemoryDeliveries()).toHaveLength(0);
  });

  it('enabled: order.created sends one template message to the admin recipient via the Graph API', async () => {
    const { calls, fetchMock } = metaMock(async () => ({ ok: true, status: 200 }));
    await emitOrderEvent(created, { channels: () => [whatsapp(fetchMock)] });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe('https://graph.facebook.com/v24.0/123456789012345/messages');
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '77010000001',
      type: 'template',
      template: { name: 'new_order_admin', language: { code: 'ru' } },
    });
    // The recipient is the admin, never the customer's phone or WhatsApp.
    expect(call.body.to).not.toBe('77001234567');
    expect(call.body.to).not.toBe('77009998877');
    expect(getMemoryDeliveries()).toEqual([
      expect.objectContaining({ event: 'order.created', channel: 'whatsapp', status: 'SENT', orderNumber: ORDER.orderNumber }),
    ]);
  });

  it('maps the order fields to template parameters {{1}}…{{6}} in order', () => {
    expect(WHATSAPP_TEMPLATE_PARAMETERS).toEqual(['orderNumber', 'customerName', 'phone', 'city', 'total', 'deliveryMethod']);
    const params = buildWhatsAppTemplateParameters(ORDER);
    expect(params).toHaveLength(6);
    expect(params[0]).toBe('MS-250921-0001');
    expect(params[1]).toBe('Тест Тестов');
    expect(params[2]).toBe('+7 700 123 45 67');
    expect(params[3]).toBe('Алматы');
    expect(params[4]).toMatch(/^112\s000 ₸$/);
    expect(params[5]).toBe('Самовывоз');
  });

  it('template parameters are Meta-safe: no newlines, no empty values', () => {
    const params = buildWhatsAppTemplateParameters({
      ...ORDER,
      customer: { ...ORDER.customer, fullName: 'Тест\n\tТестов     Младший', city: '  ' },
      items: [{ ...ORDER.items[0], documentSnapshot: undefined }],
    });
    expect(params[1]).toBe('Тест Тестов Младший');
    expect(params[3]).toBe('—');
    expect(params[5]).toBe('—');
    for (const p of params) expect(p).not.toMatch(/[\n\t]| {4,}/);
  });

  it('never includes supplier prices, BOM details or unnecessary personal data', async () => {
    const { calls, fetchMock } = metaMock(async () => ({ ok: true, status: 200 }));
    await whatsapp(fetchMock).send(created);
    const sent = JSON.stringify(calls[0].body);
    for (const value of [...INTERNAL, 'test@example.com', 'ул. Секретная', 'Позвоните после', '123456789012', 'ТОО Клиент', '+77009998877']) {
      expect(sent).not.toContain(value);
    }
    expect(templateTexts(calls[0])).toEqual(buildWhatsAppTemplateParameters(ORDER));
    // The outbox keeps only the redacted event payload.
    await emitOrderEvent(created, { channels: () => [whatsapp(fetchMock)] });
    expect(JSON.stringify(getMemoryDeliveries())).not.toContain('Тест Тестов');
  });

  it('only order.created is dispatched; status_changed/paid still reach Telegram unchanged', async () => {
    const { calls, fetchMock } = metaMock(async () => ({ ok: true, status: 200 }));
    const telegramCalls: string[] = [];
    const telegram = createTelegramChannel({
      botToken: 'bot-token',
      chatId: '1',
      fetch: async (_url, init) => {
        telegramCalls.push(JSON.parse(init.body).text);
        return { ok: true, status: 200 };
      },
    });
    const deps = { channels: () => [telegram, whatsapp(fetchMock)] };
    await emitOrderEvent(created, deps);
    await emitOrderEvent(
      buildOrderEvent({ event: 'order.status_changed', orderNumber: ORDER.orderNumber, status: 'CONFIRMED', previousStatus: 'NEW', grandTotal: 112000 }),
      deps,
    );
    await emitOrderEvent(
      buildOrderEvent({ event: 'order.paid', orderNumber: ORDER.orderNumber, status: 'PAID', previousStatus: 'AWAITING_PAYMENT', grandTotal: 112000 }),
      deps,
    );
    expect(calls).toHaveLength(1);
    // Telegram text stays the redacted format: no customer data.
    expect(telegramCalls).toHaveLength(3);
    expect(telegramCalls[0]).toMatch(/^Новый заказ №MS-250921-0001\nСумма: /);
    expect(telegramCalls.join('\n')).not.toContain('Тест Тестов');
    expect(getMemoryDeliveries().map((d) => d.channel)).toEqual(['telegram', 'whatsapp', 'telegram', 'telegram']);
  });

  it('Meta API error: returns a code, records FAILED, never throws, never logs the token', async () => {
    const { fetchMock } = metaMock(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 132001, message: `Template not found; token ${TOKEN}` } }),
    }));
    const channel = whatsapp(fetchMock);
    expect(await channel.send(created)).toEqual({ ok: false, error: 'HTTP_400_META_132001' });
    await expect(emitOrderEvent(created, { channels: () => [channel] })).resolves.toBeUndefined();
    expect(getMemoryDeliveries()).toEqual([
      expect.objectContaining({ channel: 'whatsapp', status: 'FAILED', lastError: 'HTTP_400_META_132001' }),
    ]);
    const output = logs.join('\n') + JSON.stringify(getMemoryDeliveries());
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain('Bearer');
  });

  it('network error and missing order are short codes', async () => {
    const throwing = whatsapp(async () => {
      throw new Error(`connect failed Authorization: Bearer ${TOKEN}`);
    });
    expect(await throwing.send(created)).toEqual({ ok: false, error: 'NETWORK_ERROR' });
    const { fetchMock } = metaMock(async () => ({ ok: true, status: 200 }));
    expect(await whatsapp(fetchMock).send({ ...created, orderNumber: 'MS-UNKNOWN' })).toEqual({ ok: false, error: 'ORDER_NOT_FOUND' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a hanging Meta request is aborted after the bounded timeout', async () => {
    const hanging = whatsapp(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      READY,
      { timeoutMs: 20 },
    );
    const started = Date.now();
    expect(await hanging.send(created)).toEqual({ ok: false, error: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('duplicate dispatch: an order.created already SENT on WhatsApp is not sent again (emit or retry)', async () => {
    const { calls, fetchMock } = metaMock(async () => ({ ok: true, status: 200 }));
    const deps = { channels: () => [whatsapp(fetchMock)] };
    await emitOrderEvent(created, deps);
    await emitOrderEvent(created, deps);
    expect(calls).toHaveLength(1);
    expect(getMemoryDeliveries()).toHaveLength(1);
    expect(logs.some((l) => l.includes('reason=ALREADY_SENT') && l.includes('channel=whatsapp'))).toBe(true);
    expect(await retryFailedDeliveries(deps)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('a FAILED WhatsApp delivery is retried once and then not duplicated', async () => {
    let healthy = false;
    let now = new Date('2026-09-21T10:00:00.000Z');
    const { calls, fetchMock } = metaMock(async () => (healthy ? { ok: true, status: 200 } : { ok: false, status: 503 }));
    const deps = { channels: () => [whatsapp(fetchMock)], now: () => now };
    await emitOrderEvent(created, deps);
    healthy = true;
    now = new Date(now.getTime() + 60_000);
    expect(await retryFailedDeliveries(deps)).toBe(1);
    expect(await retryFailedDeliveries(deps)).toBe(0);
    await emitOrderEvent(created, deps);
    expect(calls).toHaveLength(2);
    expect(getMemoryDeliveries()).toEqual([expect.objectContaining({ status: 'SENT', attempts: 2 })]);
  });

  it('Telegram still delivers every event without the once-per-order rule', async () => {
    const sent: string[] = [];
    const telegram = createTelegramChannel({
      botToken: 'bot-token',
      chatId: '1',
      fetch: async (url) => {
        sent.push(url);
        return { ok: true, status: 200 };
      },
    });
    await emitOrderEvent(created, { channels: () => [telegram] });
    await emitOrderEvent(created, { channels: () => [telegram] });
    expect(sent).toHaveLength(2);
    expect(telegram.events).toBeUndefined();
    expect(telegram.oncePerOrder).toBeUndefined();
  });
});

describe('WhatsApp secrets never reach client/public config', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it('publicEnv carries no WhatsApp API variable and no NEXT_PUBLIC_ alias exists', () => {
    expect(Object.keys(publicEnv).filter((k) => /WHATSAPP_(ACCESS|TOKEN|PHONE_NUMBER_ID|ADMIN|TEMPLATE|GRAPH)/.test(k))).toEqual([]);
    const all = sourceFiles(path.join(process.cwd(), 'src')).map((f) => readFileSync(f, 'utf8'));
    for (const text of all) {
      expect(text).not.toMatch(/NEXT_PUBLIC_WHATSAPP_(ACCESS|TOKEN|PHONE_NUMBER_ID|ADMIN|TEMPLATE|GRAPH)/);
    }
    expect(readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')).not.toMatch(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('no client component imports the provider, its config or the server env', () => {
    const clientFiles = sourceFiles(path.join(process.cwd(), 'src')).filter((f) =>
      /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const text = readFileSync(file, 'utf8');
      expect({ file, leaks: /notifications\/providers|WHATSAPP_ACCESS_TOKEN|import \{[^}]*\benv\b[^}]*\} from '@\/lib\/env'/.test(text) }).toEqual({
        file,
        leaks: false,
      });
    }
  });
});

describe('WhatsApp through the real POST /api/orders flow', () => {
  let ip = 0;

  beforeEach(() => {
    for (const [name, value] of Object.entries(WHATSAPP_ENV)) vi.stubEnv(name, value);
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function postOrder() {
    const { POST } = await import('@/app/api/orders/route');
    ip += 1;
    return POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.8.0.' + ip },
        body: JSON.stringify({
          fullName: 'Тест Тестов',
          phone: '+77001234567',
          email: 'test@example.com',
          city: 'Алматы',
          customerType: 'INDIVIDUAL',
          paymentPreference: 'BANK_TRANSFER',
          items: [
            {
              configuration: {
                modelSlug: 'ms-standard',
                depth: 500,
                sections: [{ id: 'sec-1', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false }],
                loadCapacity: 150,
                shelfType: 'STANDARD',
                colorId: 'color-grey',
                accessories: [],
                assemblyId: 'assembly-self',
                deliveryId: 'delivery-pickup',
                quantity: 1,
              },
            },
          ],
        }),
      }),
    );
  }

  it('order.created dispatches WhatsApp with the saved order fields', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        if (!url.startsWith('https://graph.facebook.com/')) throw new Error('unexpected network call ' + url);
        bodies.push(JSON.parse(init.body));
        return new Response('{"messages":[{"id":"wamid.X"}]}', { status: 200 });
      }),
    );
    const response = await postOrder();
    expect(response.status).toBe(201);
    const { orderNumber } = (await response.json()) as { orderNumber: string };
    const store = await import('@/lib/notifications/store');
    await vi.waitFor(() => expect(store.getMemoryDeliveries().some((d) => d.channel === 'whatsapp')).toBe(true));
    expect(store.getMemoryDeliveries().find((d) => d.channel === 'whatsapp')).toMatchObject({ status: 'SENT', orderNumber });
    expect(bodies).toHaveLength(1);
    const texts = (bodies[0].template as { components: { parameters: { text: string }[] }[] }).components[0].parameters.map((p) => p.text);
    expect(texts[0]).toBe(orderNumber);
    expect(texts.slice(1, 4)).toEqual(['Тест Тестов', '+77001234567', 'Алматы']);
    expect(texts[5]).not.toBe('—');
  });

  it.each([
    ['Meta 500', async () => new Response('{"error":{"code":131000}}', { status: 500 })],
    ['network failure', async () => Promise.reject(new Error('ECONNRESET'))],
  ])('WhatsApp failure (%s) does not fail order creation', async (_label, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const response = await postOrder();
    expect(response.status).toBe(201);
    const { orderNumber } = (await response.json()) as { orderNumber: string };
    const orders = await import('@/lib/orders/store');
    expect(await orders.getOrderByNumber(orderNumber)).toBeDefined();
    const store = await import('@/lib/notifications/store');
    await vi.waitFor(() =>
      expect(store.getMemoryDeliveries().find((d) => d.channel === 'whatsapp')).toMatchObject({ status: 'FAILED' }),
    );
  });
});
