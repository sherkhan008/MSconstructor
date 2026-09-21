import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildOrderEvent } from '@/lib/notifications/events';
import type { ChannelSendResult, NotificationChannel } from '@/lib/notifications/channels';
import { createWhatsAppChannel } from '@/lib/notifications/providers/whatsapp';
import { resolveWhatsAppConfig } from '@/lib/notifications/providers/whatsapp-config';
import {
  MAX_DELIVERY_ATTEMPTS,
  RETRY_DELAYS_MS,
  RETRY_MAX_AGE_MS,
  RETRY_UNAVAILABLE_POSTPONE_MS,
  isTransientDeliveryError,
  nextRetryAt,
} from '@/lib/notifications/retry-policy';
import { runRetryLoop } from '@/lib/notifications/retry-worker';
import { emitOrderEvent, retryFailedDeliveries } from '@/lib/notifications/service';
import { clearMemoryDeliveries, getMemoryDeliveries } from '@/lib/notifications/store';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * Automatic retry of FAILED notification deliveries
 * (src/lib/notifications/retry-policy.ts, service.ts `retryFailedDeliveries`,
 * the notifications-worker loop). Time is an injected clock; Meta is mocked.
 */

const START = new Date('2026-09-21T10:00:00.000Z');
const created = buildOrderEvent({ event: 'order.created', orderNumber: 'MS-1', status: 'NEW', grandTotal: 1000 });

function clock() {
  let now = START;
  return {
    now: () => now,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

/** A channel whose successive send results are scripted. */
function scriptedChannel(results: ChannelSendResult[], options: Partial<NotificationChannel> = {}) {
  const send = vi.fn(async (): Promise<ChannelSendResult> => results.shift() ?? { ok: true });
  const channel: NotificationChannel = { id: 'fake', availability: () => ({ ok: true }), send, ...options };
  return { channel, send };
}

const row = () => getMemoryDeliveries()[0];

describe('retry policy', () => {
  it.each(['TIMEOUT', 'NETWORK_ERROR', 'HTTP_429', 'HTTP_408', 'HTTP_500', 'HTTP_502', 'HTTP_503_META_131016', 'HTTP_400_META_130429', 'HTTP_400_META_131000', 'ADAPTER_ERROR', 'ORDER_LOOKUP_FAILED'])(
    '%s is transient',
    (code) => expect(isTransientDeliveryError(code)).toBe(true),
  );

  it.each(['HTTP_400', 'HTTP_400_META_132001', 'HTTP_401_META_190', 'HTTP_403', 'HTTP_404', 'ORDER_NOT_FOUND', 'NOT_CONFIGURED', 'UNSUPPORTED_EVENT', 'NO_TRANSPORT', 'SOMETHING_NEW'])(
    '%s is permanent',
    (code) => expect(isTransientDeliveryError(code)).toBe(false),
  );

  it('backs off 1 min, 5 min, 15 min, 1 h, 3 h and stops at the attempt limit', () => {
    const delays = [1, 2, 3, 4, 5].map((n) => nextRetryAt(n, 'HTTP_503', START)!.getTime() - START.getTime());
    expect(delays).toEqual([...RETRY_DELAYS_MS]);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(6);
    expect(nextRetryAt(MAX_DELIVERY_ATTEMPTS, 'HTTP_503', START)).toBeNull();
    expect(nextRetryAt(1, 'HTTP_400_META_132001', START)).toBeNull();
  });
});

describe('retryFailedDeliveries', () => {
  beforeEach(() => {
    clearMemoryDeliveries();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. a transient failure is stored as retryable with a future nextAttemptAt', async () => {
    const t = clock();
    const { channel } = scriptedChannel([{ ok: false, error: 'HTTP_503' }]);
    await emitOrderEvent(created, { channels: () => [channel], now: t.now });
    expect(row()).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'HTTP_503' });
    expect(row().nextAttemptAt?.getTime()).toBe(START.getTime() + RETRY_DELAYS_MS[0]);
  });

  it('2. a permanent Meta 4xx error is final: never scheduled, never re-sent', async () => {
    const t = clock();
    const { channel, send } = scriptedChannel([{ ok: false, error: 'HTTP_400_META_132001' }]);
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    expect(row()).toMatchObject({ status: 'FAILED', nextAttemptAt: null, lastError: 'HTTP_400_META_132001' });
    for (let i = 0; i < 10; i += 1) {
      t.advance(RETRY_DELAYS_MS[4]);
      expect(await retryFailedDeliveries(deps)).toBe(0);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('2b. a permanent error on a retry ends retrying', async () => {
    const t = clock();
    const { channel, send } = scriptedChannel([{ ok: false, error: 'TIMEOUT' }, { ok: false, error: 'HTTP_401_META_190' }]);
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    t.advance(RETRY_DELAYS_MS[0]);
    await retryFailedDeliveries(deps);
    expect(row()).toMatchObject({ status: 'FAILED', attempts: 2, nextAttemptAt: null });
    t.advance(RETRY_DELAYS_MS[4]);
    await retryFailedDeliveries(deps);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['3. timeout', 'TIMEOUT'],
    ['3. network error', 'NETWORK_ERROR'],
    ['4. HTTP 429', 'HTTP_429'],
    ['5. HTTP 5xx', 'HTTP_502'],
  ])('%s is retried and 9. the successful retry becomes SENT', async (_label, error) => {
    const t = clock();
    const { channel, send } = scriptedChannel([{ ok: false, error }, { ok: true }]);
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    t.advance(RETRY_DELAYS_MS[0]);
    expect(await retryFailedDeliveries(deps)).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(row()).toMatchObject({ status: 'SENT', attempts: 2, nextAttemptAt: null });
    expect(row().lastError).toBeUndefined();
  });

  it('6. a SENT notification is never resent', async () => {
    const t = clock();
    const { channel, send } = scriptedChannel([{ ok: true }]);
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    for (let i = 0; i < 5; i += 1) {
      t.advance(RETRY_DELAYS_MS[4]);
      expect(await retryFailedDeliveries(deps)).toBe(0);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({ status: 'SENT', attempts: 1, nextAttemptAt: null });
  });

  it('6b. two concurrent passes send a due row once (claim)', async () => {
    const t = clock();
    const { channel, send } = scriptedChannel([{ ok: false, error: 'HTTP_503' }, { ok: true }, { ok: true }]);
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    t.advance(RETRY_DELAYS_MS[0]);
    const results = await Promise.all([retryFailedDeliveries(deps), retryFailedDeliveries(deps)]);
    expect(results.sort()).toEqual([0, 1]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('7. the retry limit is enforced: 6 attempts in total, then final', async () => {
    const t = clock();
    const { channel, send } = scriptedChannel(Array.from({ length: 20 }, () => ({ ok: false as const, error: 'HTTP_503' })));
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    for (let i = 0; i < 20; i += 1) {
      t.advance(RETRY_DELAYS_MS[4]);
      await retryFailedDeliveries(deps);
    }
    expect(send).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
    expect(row()).toMatchObject({ status: 'FAILED', attempts: MAX_DELIVERY_ATTEMPTS, nextAttemptAt: null });
  });

  it('8. backoff: no retry before the delay, however often the worker runs', async () => {
    const t = clock();
    const { channel, send } = scriptedChannel(Array.from({ length: 10 }, () => ({ ok: false as const, error: 'NETWORK_ERROR' })));
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);

    // Many passes inside the 1-minute window: nothing is sent.
    for (let i = 0; i < 50; i += 1) {
      t.advance(1_000);
      await retryFailedDeliveries(deps);
    }
    expect(send).toHaveBeenCalledTimes(1);

    // Each later attempt waits for its own, growing delay.
    const sendTimes: number[] = [START.getTime()];
    for (let i = 0; i < 5 * 60 * 5; i += 1) {
      t.advance(60_000);
      const before = send.mock.calls.length;
      await retryFailedDeliveries(deps);
      if (send.mock.calls.length > before) sendTimes.push(t.now().getTime());
    }
    const gaps = sendTimes.slice(1).map((time, i) => time - sendTimes[i]);
    expect(gaps).toHaveLength(MAX_DELIVERY_ATTEMPTS - 1);
    gaps.forEach((gap, i) => expect(gap).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[i]));
    expect(gaps[0]).toBeLessThan(RETRY_DELAYS_MS[1]);
  });

  it('a channel unavailable at retry time is postponed without spending an attempt; old rows expire', async () => {
    const t = clock();
    let available = true;
    const { channel, send } = scriptedChannel([{ ok: false, error: 'TIMEOUT' }, { ok: true }], {
      availability: () => (available ? { ok: true } : { ok: false, reason: 'NOT_CONFIGURED' }),
    });
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    available = false;
    t.advance(RETRY_DELAYS_MS[0]);
    await retryFailedDeliveries(deps);
    expect(row()).toMatchObject({ attempts: 1 });
    expect(row().nextAttemptAt?.getTime()).toBe(t.now().getTime() + RETRY_UNAVAILABLE_POSTPONE_MS);
    available = true;
    t.advance(RETRY_MAX_AGE_MS);
    await retryFailedDeliveries(deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({ status: 'FAILED', nextAttemptAt: null });
  });

  it('WhatsApp end to end: Meta 503 then 200 is retried to SENT with the same admin template', async () => {
    const t = clock();
    const statuses = [503, 200];
    const bodies: string[] = [];
    const channel = createWhatsAppChannel({
      config: resolveWhatsAppConfig({
        WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
        WHATSAPP_ACCESS_TOKEN: 'EAAG-SECRET',
        WHATSAPP_PHONE_NUMBER_ID: '123',
        WHATSAPP_ADMIN_RECIPIENT: '77010000001',
        WHATSAPP_TEMPLATE_NAME: 'new_order_admin',
        WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
      }),
      loadOrder: async () =>
        ({
          orderNumber: 'MS-1',
          customer: { fullName: 'Тест', phone: '+7', city: 'Алматы' },
          items: [],
          grandTotal: 1000,
        }) as unknown as OrderRecord,
      fetch: async (_url, init) => {
        bodies.push(init.body);
        const status = statuses.shift() ?? 200;
        return { ok: status < 400, status };
      },
    });
    const deps = { channels: () => [channel], now: t.now };
    await emitOrderEvent(created, deps);
    expect(row()).toMatchObject({ status: 'FAILED', lastError: 'HTTP_503' });
    t.advance(RETRY_DELAYS_MS[0]);
    expect(await retryFailedDeliveries(deps)).toBe(1);
    expect(row()).toMatchObject({ channel: 'whatsapp', status: 'SENT', attempts: 2 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[1]).to).toBe('77010000001');
  });
});

describe('notifications worker loop', () => {
  it('runs passes on its interval, survives a failing pass, and stops on abort', async () => {
    const controller = new AbortController();
    const lines: string[] = [];
    let passes = 0;
    const loop = runRetryLoop({
      intervalMs: 5,
      signal: controller.signal,
      log: (line) => lines.push(line),
      tick: async () => {
        passes += 1;
        if (passes === 1) throw new Error('postgresql://user:secret@db/x unreachable');
        if (passes === 3) controller.abort();
        return 2;
      },
    });
    await loop;
    expect(passes).toBe(3);
    expect(lines).toContain('[notifications-worker] pass failed error=Error');
    expect(lines.join('\n')).not.toContain('secret');
  });
});

describe('10. order creation is unaffected by WhatsApp failures and never waits for retries', () => {
  const ENV = {
    WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'EAAG-SECRET',
    WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
    WHATSAPP_ADMIN_RECIPIENT: '77010000001',
    WHATSAPP_TEMPLATE_NAME: 'new_order_admin',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
  };

  beforeEach(() => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
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

  it.each([
    ['Meta 503', async () => new Response('{"error":{"code":131016}}', { status: 503 })],
    ['Meta 429', async () => new Response('{"error":{"code":130429}}', { status: 429 })],
    ['network failure', async () => Promise.reject(new Error('ECONNRESET'))],
    ['permanent Meta 400', async () => new Response('{"error":{"code":132001}}', { status: 400 })],
  ])('%s: POST /api/orders returns 201 and the failure is left to the worker', async (_label, respond) => {
    const fetchMock = vi.fn(respond);
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('@/app/api/orders/route');
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.7.0.' + Math.floor(Math.random() * 250) },
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
                height: 2000,
                depth: 500,
                shelves: 5,
                sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
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
    expect(response.status).toBe(201);
    const store = await import('@/lib/notifications/store');
    await vi.waitFor(() => expect(store.getMemoryDeliveries().find((d) => d.channel === 'whatsapp')).toBeDefined());
    // One send from the request; the request path never retries.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const delivery = store.getMemoryDeliveries().find((d) => d.channel === 'whatsapp')!;
    expect(delivery).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(delivery.nextAttemptAt === null).toBe(_label === 'permanent Meta 400');
  });
});
