import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildContactLeadEvent, formatContactLeadText } from '@/lib/notifications/events';
import { createTelegramChannel, type NotificationChannel } from '@/lib/notifications/channels';
import {
  WHATSAPP_CONTACT_TEMPLATE_PARAMETERS,
  buildWhatsAppContactTemplateParameters,
  createWhatsAppChannel,
  type WhatsAppChannelOptions,
} from '@/lib/notifications/providers/whatsapp';
import { resolveWhatsAppConfig } from '@/lib/notifications/providers/whatsapp-config';
import { RETRY_CLAIM_LEASE_MS, isTransientDeliveryError } from '@/lib/notifications/retry-policy';
import { emitContactLeadEvent, retryFailedDeliveries } from '@/lib/notifications/service';
import { clearMemoryDeliveries, createPendingDelivery, getMemoryDeliveries } from '@/lib/notifications/store';
import { clearMemoryContactLeads, getMemoryContactLeads, saveContactLead, type ContactLeadRecord } from '@/lib/contact-leads/store';

/**
 * Contact form → ContactLead (authoritative) → manager alert through the
 * notification outbox. Meta and Telegram are always mocked at the HTTP
 * boundary: the global fetch throws unless a test replaces it, so an
 * accidental real network call fails the test. Runs on the in-memory stores
 * (no DATABASE_URL); tests/integration/contact-leads-db.test.ts covers the
 * same flow against real PostgreSQL.
 */

const TOKEN = 'EAAG-SECRET-ACCESS-TOKEN-contact';
const SENDER_PHONE_NUMBER_ID = '109876543210987';
const MANAGER_NUMBER = '+7 (701) 555-44-33';
const MANAGER_DIGITS = '77015554433';

const WHATSAPP_ENV = {
  WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: SENDER_PHONE_NUMBER_ID,
  WHATSAPP_ADMIN_RECIPIENT: MANAGER_NUMBER,
  WHATSAPP_TEMPLATE_NAME: 'new_order_notification',
  WHATSAPP_CONTACT_TEMPLATE_NAME: 'new_contact_lead',
  WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
};

const READY = resolveWhatsAppConfig(WHATSAPP_ENV);

const VALID = { name: 'Айгерим Тестова', phone: '8 (777) 123-45-67', message: 'Нужен стеллаж 2000×1000 на склад.' };

const LEAD: ContactLeadRecord = {
  id: 'lead-1',
  name: 'Айгерим Тестова',
  phone: '+77771234567',
  message: 'Нужен стеллаж\nна склад.',
  locale: 'ru',
  createdAt: new Date('2026-09-30T10:00:00.000Z'),
};

let ip = 0;
function request(body: unknown, options: { locale?: 'ru' | 'kk'; raw?: string; ip?: string } = {}) {
  ip += 1;
  return new NextRequest('http://localhost/api/contact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': options.ip ?? `10.77.${Math.floor(ip / 250)}.${ip % 250}`,
      ...(options.locale ? { 'x-site-locale': options.locale } : {}),
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

async function route() {
  return (await import('@/app/api/contact/route')).POST;
}

interface MetaCall {
  url: string;
  headers: Record<string, string>;
  body: { to: string; template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] } };
}

function templateTexts(call: MetaCall): string[] {
  return call.body.template.components[0].parameters.map((p) => p.text);
}

describe('POST /api/contact — persistence, validation, locale', () => {
  let logs: string[];

  beforeEach(() => {
    vi.resetModules();
    logs = [];
    for (const level of ['warn', 'error', 'info', 'log'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network must not be used');
      }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/contact-leads/store');
    vi.resetModules();
  });

  it('a valid submission is stored (normalised phone, locale) BEFORE success is returned', async () => {
    const POST = await route();
    const response = await POST(request({ ...VALID, email: 'not-collected@example.com' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, message: 'Заявка отправлена' });

    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    expect(leads()).toHaveLength(1);
    const [lead] = leads();
    expect(lead).toMatchObject({ name: VALID.name, phone: '+77771234567', message: VALID.message, locale: 'ru' });
    // Only what the form asks for is stored.
    expect(Object.keys(lead).sort()).toEqual(['createdAt', 'id', 'locale', 'message', 'name', 'phone']);
  });

  it.each([
    ['+7 777 123 45 67', '+77771234567'],
    ['77771234567', '+77771234567'],
    ['8-777-123-45-67', '+77771234567'],
  ])('phone %s is stored as %s', async (phone, stored) => {
    const POST = await route();
    expect((await POST(request({ ...VALID, phone }))).status).toBe(201);
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    expect(leads()[0].phone).toBe(stored);
  });

  it('KK: success message and stored locale follow the page locale', async () => {
    const POST = await route();
    const response = await POST(request(VALID, { locale: 'kk' }));
    expect(response.status).toBe(201);
    expect((await response.json()).message).toBe('Өтінім жіберілді');
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    expect(leads()[0].locale).toBe('kk');
  });

  it.each([
    ['name too short', { ...VALID, name: 'А' }, 'name'],
    ['name too long', { ...VALID, name: 'А'.repeat(201) }, 'name'],
    ['name missing', { phone: VALID.phone, message: VALID.message }, 'name'],
    ['invalid phone', { ...VALID, phone: '12345' }, 'phone'],
    ['foreign phone', { ...VALID, phone: '+49 151 2345 6789' }, 'phone'],
    ['empty message', { ...VALID, message: '   ' }, 'message'],
    ['oversized message', { ...VALID, message: 'x'.repeat(2001) }, 'message'],
    ['wrong types', { name: 42, phone: true, message: ['a'] }, 'name'],
  ])('%s → 400 with a field error, nothing stored, nothing sent', async (_label, body, field) => {
    const POST = await route();
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({ ok: false, code: 'VALIDATION_ERROR', message: 'Проверьте правильность заполнения формы' });
    expect(json.fieldErrors.map((e: { field: string }) => e.field)).toContain(field);
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    expect(leads()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validation messages are localised (KK)', async () => {
    const POST = await route();
    const response = await POST(request({ ...VALID, phone: '1' }, { locale: 'kk' }));
    const json = await response.json();
    expect(json.message).toBe('Форманың дұрыс толтырылғанын тексеріңіз');
    expect(json.fieldErrors).toEqual([{ field: 'phone', message: 'Дұрыс телефон нөмірін көрсетіңіз' }]);
  });

  it.each([
    ['ru', 'Некорректное тело запроса'],
    ['kk', 'Сұраныс деректері дұрыс емес'],
  ] as const)('malformed JSON → 400 (%s)', async (locale, message) => {
    const POST = await route();
    const response = await POST(request(null, { raw: '{"name": "broken', locale }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(message);
  });

  it.each([
    ['ru', 'Слишком много обращений. Попробуйте через минуту.'],
    ['kk', 'Өтініштер тым көп. Бір минуттан кейін қайталап көріңіз.'],
  ] as const)('rate limit: the 6th submission from one client within a minute → 429 (%s)', async (locale, message) => {
    const POST = await route();
    const client = `10.99.0.${locale === 'ru' ? 1 : 2}`;
    for (let i = 0; i < 5; i += 1) {
      expect((await POST(request({ ...VALID, message: `Сообщение ${i}` }, { ip: client, locale }))).status).toBe(201);
    }
    const limited = await POST(request({ ...VALID, message: 'ещё одно' }, { ip: client, locale }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED', message });
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    expect(leads()).toHaveLength(5);
    // Another client is unaffected.
    expect((await POST(request(VALID, { ip: '10.99.0.3' }))).status).toBe(201);
  });

  it('database failure → generic 500, never a false success, no notification attempted', async () => {
    vi.doMock('@/lib/contact-leads/store', () => ({
      saveContactLead: vi.fn(async () => {
        throw Object.assign(new Error(`connect ECONNREFUSED ${VALID.phone}`), { code: 'P1001' });
      }),
    }));
    for (const [name, value] of Object.entries(WHATSAPP_ENV)) vi.stubEnv(name, value);
    const POST = await route();
    const response = await POST(request(VALID));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера. Попробуйте позже.',
    });
    expect(fetch).not.toHaveBeenCalled();
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    expect(deliveries()).toHaveLength(0);
  });

  it('an identical resend is answered as stored: one lead, one alert', async () => {
    for (const [name, value] of Object.entries(WHATSAPP_ENV)) vi.stubEnv(name, value);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('{"messages":[{"id":"wamid.1"}]}', { status: 200 });
      }),
    );
    const POST = await route();
    const client = '10.98.0.1';
    const [first, second] = await Promise.all([POST(request(VALID, { ip: client })), POST(request(VALID, { ip: client }))]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await POST(request({ ...VALID, phone: '+7 777 123 45 67' }, { ip: client }))).status).toBe(201);

    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    expect(leads()).toHaveLength(1);
    await vi.waitFor(() => expect(deliveries().filter((d) => d.status === 'SENT')).toHaveLength(1));
    expect(calls).toHaveLength(1);

    // A different message from the same person is a new lead.
    expect((await POST(request({ ...VALID, message: 'И ещё полки' }, { ip: client }))).status).toBe(201);
    expect(leads()).toHaveLength(2);
  });
});

describe('POST /api/contact — manager WhatsApp alert', () => {
  let logs: string[];

  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries(WHATSAPP_ENV)) vi.stubEnv(name, value);
    logs = [];
    for (const level of ['warn', 'error', 'info', 'log'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function captureMeta(respond: () => Promise<Response>) {
    const calls: MetaCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
        if (!url.startsWith('https://graph.facebook.com/')) throw new Error('unexpected network call');
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return respond();
      }),
    );
    return calls;
  }

  it('sends the contact template FROM the technical sender TO the manager number', async () => {
    const calls = captureMeta(async () => new Response('{"messages":[{"id":"wamid.X"}]}', { status: 200 }));
    const POST = await route();
    expect((await POST(request(VALID))).status).toBe(201);

    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    const [lead] = leads();
    await vi.waitFor(() =>
      expect(deliveries()).toEqual([
        expect.objectContaining({ event: 'contact.created', channel: 'whatsapp', status: 'SENT', contactLeadId: lead.id, attempts: 1 }),
      ]),
    );
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // Sender: the Cloud API phone-number id in the URL. Recipient: the manager.
    expect(call.url).toBe(`https://graph.facebook.com/v24.0/${SENDER_PHONE_NUMBER_ID}/messages`);
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.body.to).toBe(MANAGER_DIGITS);
    expect(call.body.to).not.toBe('77771234567');
    expect(call.body.template).toMatchObject({ name: 'new_contact_lead', language: { code: 'ru' } });
    expect(templateTexts(call)).toEqual([VALID.name, '+77771234567', VALID.message]);
    // The outbox keeps only the lead id — no name, phone or message.
    const stored = JSON.stringify(deliveries());
    for (const value of [VALID.name, '77771234567', VALID.message]) expect(stored).not.toContain(value);
  });

  it.each([
    ['Meta 500', async () => new Response('{"error":{"code":131000,"message":"x"}}', { status: 500 })],
    ['Meta 429', async () => new Response('{"error":{"code":130429}}', { status: 429 })],
    ['network failure', async () => Promise.reject(new Error(`ECONNRESET Bearer ${TOKEN}`))],
  ])('WhatsApp failure after the lead is stored (%s): still 201, lead kept, retry scheduled', async (_label, respond) => {
    captureMeta(respond);
    const POST = await route();
    const response = await POST(request(VALID));
    expect(response.status).toBe(201);
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    expect(leads()).toHaveLength(1);
    await vi.waitFor(() => expect(deliveries()[0]).toMatchObject({ channel: 'whatsapp', status: 'FAILED' }));
    expect(deliveries()[0].nextAttemptAt).not.toBeNull();
    expect(isTransientDeliveryError(deliveries()[0].lastError!)).toBe(true);
    // Logs name the event, channel, opaque lead id and a code — never the
    // customer's data, the token or Meta's message text.
    const output = logs.join('\n');
    for (const value of [VALID.name, '77771234567', VALID.message, TOKEN, 'Bearer']) expect(output).not.toContain(value);
    expect(output).toContain(`lead=${leads()[0].id}`);
  });

  it('the response never waits for Meta: 201 while the send is still in flight, PENDING row already durable', async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    const POST = await route();
    const response = await POST(request(VALID));
    expect(response.status).toBe(201);
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    // Written with the lead, before the response — not after it.
    expect(deliveries()).toEqual([
      expect.objectContaining({ status: 'PENDING', attempts: 0, channel: 'whatsapp', contactLeadId: leads()[0].id }),
    ]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    release(new Response('{}', { status: 200 }));
    await vi.waitFor(() => expect(deliveries()[0]).toMatchObject({ status: 'SENT', attempts: 1, nextAttemptAt: null }));
  });

  it('notifications disabled: lead stored, zero network calls, nothing recorded', async () => {
    vi.stubEnv('WHATSAPP_NOTIFICATIONS_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network must not be used');
      }),
    );
    const POST = await route();
    expect((await POST(request(VALID))).status).toBe(201);
    const { getMemoryContactLeads: leads } = await import('@/lib/contact-leads/store');
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    expect(leads()).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).not.toHaveBeenCalled();
    expect(deliveries()).toHaveLength(0);
  });

  it('Telegram (secondary) receives the lead in parallel and is unaffected by a WhatsApp failure', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tg-secret-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100123');
    const telegramTexts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.startsWith('https://api.telegram.org/')) {
          const body = JSON.parse(init.body);
          expect(body.parse_mode).toBeUndefined();
          telegramTexts.push(body.text);
          return new Response('{"ok":true}', { status: 200 });
        }
        return new Response('{"error":{"code":131000}}', { status: 503 });
      }),
    );
    const POST = await route();
    expect((await POST(request(VALID))).status).toBe(201);
    const { getMemoryDeliveries: deliveries } = await import('@/lib/notifications/store');
    await vi.waitFor(() => expect(deliveries().every((d) => d.status !== 'PENDING') && deliveries().length === 2).toBe(true));
    expect(Object.fromEntries(deliveries().map((d) => [d.channel, d.status]))).toEqual({ telegram: 'SENT', whatsapp: 'FAILED' });
    expect(telegramTexts).toEqual([`Новая заявка с сайта\nИмя: ${VALID.name}\nТелефон: +77771234567\nСообщение: ${VALID.message}`]);
    expect(logs.join('\n')).not.toContain('tg-secret-token');
  });
});

describe('WhatsApp contact template', () => {
  beforeEach(() => {
    clearMemoryDeliveries();
    clearMemoryContactLeads();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const channel = (fetchMock: NonNullable<WhatsAppChannelOptions['fetch']>, extra: WhatsAppChannelOptions = {}) =>
    createWhatsAppChannel({ config: READY, fetch: fetchMock, loadContactLead: async (id) => (id === LEAD.id ? LEAD : undefined), ...extra });

  it('maps {{1}} name, {{2}} phone, {{3}} message; Meta-safe (one line, never empty, capped)', () => {
    expect(WHATSAPP_CONTACT_TEMPLATE_PARAMETERS).toEqual(['customerName', 'phone', 'message']);
    expect(buildWhatsAppContactTemplateParameters(LEAD)).toEqual(['Айгерим Тестова', '+77771234567', 'Нужен стеллаж на склад.']);
    const long = buildWhatsAppContactTemplateParameters({ name: ' \n ', phone: '+77771234567', message: `a\t\tb    c ${'я'.repeat(900)}` });
    expect(long[0]).toBe('—');
    expect(long[2].startsWith('a b c ')).toBe(true);
    expect(long[2].length).toBeLessThanOrEqual(501);
    expect(long[2].endsWith('…')).toBe(true);
    for (const p of long) expect(p).not.toMatch(/[\n\t]| {4,}/);
  });

  it('uses the contact template, never the order template, and only name/phone/message', async () => {
    const bodies: MetaCall['body'][] = [];
    const send = await channel(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200 };
    }).send(buildContactLeadEvent(LEAD.id));
    expect(send).toEqual({ ok: true });
    expect(bodies[0].template.name).toBe('new_contact_lead');
    expect(bodies[0].template.components[0].parameters).toHaveLength(3);
    expect(JSON.stringify(bodies[0])).not.toContain(LEAD.id);
  });

  it('missing lead / lookup failure are short codes (permanent / transient)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await channel(fetchMock).send(buildContactLeadEvent('nope'))).toEqual({ ok: false, error: 'LEAD_NOT_FOUND' });
    const failing = channel(fetchMock, {
      loadContactLead: async () => {
        throw new Error('db down');
      },
    });
    expect(await failing.send(buildContactLeadEvent(LEAD.id))).toEqual({ ok: false, error: 'LEAD_LOOKUP_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isTransientDeliveryError('LEAD_LOOKUP_FAILED')).toBe(true);
    expect(isTransientDeliveryError('LEAD_NOT_FOUND')).toBe(false);
  });

  it('Meta timeout → TIMEOUT (transient); permanent template error → no retry', async () => {
    const hanging = channel(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { timeoutMs: 20 },
    );
    expect(await hanging.send(buildContactLeadEvent(LEAD.id))).toEqual({ ok: false, error: 'TIMEOUT' });

    const now = new Date('2026-09-30T10:00:00.000Z');
    const permanent = channel(async () => ({ ok: false, status: 404, json: async () => ({ error: { code: 132001 } }) }));
    await emitContactLeadEvent(buildContactLeadEvent(LEAD.id), { channels: () => [permanent], now: () => now });
    expect(getMemoryDeliveries()[0]).toMatchObject({ status: 'FAILED', lastError: 'HTTP_404_META_132001', nextAttemptAt: null });
    const auth = channel(async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 190 } }) }));
    expect(await auth.send(buildContactLeadEvent(LEAD.id))).toEqual({ ok: false, error: 'HTTP_401_META_190' });
    expect(isTransientDeliveryError('HTTP_401_META_190')).toBe(false);
  });

  it('transient failure is retried by the worker to SENT, then never sent again', async () => {
    let now = new Date('2026-09-30T10:00:00.000Z');
    let healthy = false;
    const fetchMock = vi.fn(async () => (healthy ? { ok: true, status: 200 } : { ok: false, status: 503 }));
    const deps = { channels: () => [channel(fetchMock)], now: () => now };
    const event = buildContactLeadEvent(LEAD.id);
    await emitContactLeadEvent(event, deps);
    expect(getMemoryDeliveries()[0]).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'HTTP_503' });
    healthy = true;
    now = new Date(now.getTime() + 60_000);
    expect(await retryFailedDeliveries(deps)).toBe(1);
    expect(await retryFailedDeliveries(deps)).toBe(0);
    await emitContactLeadEvent(event, deps);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getMemoryDeliveries()).toEqual([expect.objectContaining({ status: 'SENT', attempts: 2, contactLeadId: LEAD.id })]);
  });

  it('Telegram text for a lead is plain and complete; order events keep their redacted text', async () => {
    const texts: string[] = [];
    const telegram = createTelegramChannel({
      botToken: 't',
      chatId: '1',
      loadContactLead: async () => LEAD,
      fetch: async (_url, init) => {
        texts.push(JSON.parse(init.body).text);
        return { ok: true, status: 200 };
      },
    });
    expect(await telegram.send(buildContactLeadEvent(LEAD.id))).toEqual({ ok: true });
    expect(texts[0]).toBe(formatContactLeadText(LEAD));
    expect(texts[0]).toBe('Новая заявка с сайта\nИмя: Айгерим Тестова\nТелефон: +77771234567\nСообщение: Нужен стеллаж\nна склад.');
  });
});

describe('outbox durability: a send interrupted by a crash is recovered by the worker', () => {
  beforeEach(() => {
    clearMemoryDeliveries();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a PENDING row is left alone during its lease, then sent once by the worker', async () => {
    const start = new Date('2026-09-30T10:00:00.000Z');
    let now = start;
    const event = buildContactLeadEvent('lead-crash');
    // The request process wrote the durable row and died before recording a result.
    await createPendingDelivery({
      event: event.event,
      channel: 'fake',
      subject: { contactLeadId: 'lead-crash' },
      payload: event,
      leaseUntil: new Date(start.getTime() + RETRY_CLAIM_LEASE_MS),
      createdAt: start,
    });
    const send = vi.fn(async () => ({ ok: true as const }));
    const fake: NotificationChannel = { id: 'fake', oncePerSubject: true, availability: () => ({ ok: true }), send };
    const deps = { channels: () => [fake], now: () => now };

    now = new Date(start.getTime() + RETRY_CLAIM_LEASE_MS - 1);
    expect(await retryFailedDeliveries(deps)).toBe(0);
    expect(send).not.toHaveBeenCalled();

    now = new Date(start.getTime() + RETRY_CLAIM_LEASE_MS);
    expect(await retryFailedDeliveries(deps)).toBe(1);
    expect(getMemoryDeliveries()).toEqual([expect.objectContaining({ status: 'SENT', attempts: 1, contactLeadId: 'lead-crash' })]);
    now = new Date(now.getTime() + 24 * 60 * 60_000);
    expect(await retryFailedDeliveries(deps)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a stale PENDING row older than the retry age is closed as FAILED/EXPIRED, never sent', async () => {
    const start = new Date('2026-09-30T10:00:00.000Z');
    const event = buildContactLeadEvent('lead-old');
    await createPendingDelivery({
      event: event.event,
      channel: 'fake',
      subject: { contactLeadId: 'lead-old' },
      payload: event,
      leaseUntil: new Date(start.getTime() + RETRY_CLAIM_LEASE_MS),
      createdAt: start,
    });
    const send = vi.fn(async () => ({ ok: true as const }));
    const deps = {
      channels: () => [{ id: 'fake', availability: () => ({ ok: true as const }), send }],
      now: () => new Date(start.getTime() + 25 * 60 * 60_000),
    };
    expect(await retryFailedDeliveries(deps)).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(getMemoryDeliveries()[0]).toMatchObject({ status: 'FAILED', lastError: 'EXPIRED', nextAttemptAt: null });
  });
});

describe('contact lead store (memory)', () => {
  beforeEach(() => clearMemoryContactLeads());

  it('dedupes identical leads only within the window', async () => {
    const t0 = new Date('2026-09-30T10:00:00.000Z');
    const input = { name: 'Тест', phone: '+77770000000', message: 'Привет', locale: 'ru' as const };
    expect((await saveContactLead(input, t0)).duplicate).toBe(false);
    expect((await saveContactLead(input, new Date(t0.getTime() + 9 * 60_000))).duplicate).toBe(true);
    expect((await saveContactLead(input, new Date(t0.getTime() + 11 * 60_000))).duplicate).toBe(false);
    expect(getMemoryContactLeads()).toHaveLength(2);
  });
});
