import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { clearMemoryOrders, getOrderByNumber } from '@/lib/orders/store';
import { buildOrderEvent, formatOrderEventText } from '@/lib/notifications/events';
import { createTelegramChannel, type NotificationChannel } from '@/lib/notifications/channels';
import { emitOrderEvent, retryFailedDeliveries } from '@/lib/notifications/service';
import { clearMemoryDeliveries, getMemoryDeliveries } from '@/lib/notifications/store';

const PII = ['Тест Тестов', '+77001234567', 'test@example.com', 'Алматы'];
const SECRET = 'SECRET-BOT-TOKEN-123';

let ip = 0;
function postOrder(): Promise<Response> {
  ip += 1;
  return POST(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.0.' + ip },
      body: JSON.stringify({
        fullName: PII[0],
        phone: PII[1],
        email: PII[2],
        city: PII[3],
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

function fakeChannel(send: NotificationChannel['send'], id = 'fake'): NotificationChannel {
  return { id, availability: () => ({ ok: true }), send };
}

const created = buildOrderEvent({ event: 'order.created', orderNumber: 'MS-1', status: 'NEW', grandTotal: 1000 });

describe('order notifications', () => {
  let logs: string[];
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearMemoryOrders();
    clearMemoryDeliveries();
    logs = [];
    for (const level of ['warn', 'error', 'info', 'log'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
    }
    fetchSpy = vi.fn(async () => {
      throw new Error('network must not be used');
    });
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('order creation succeeds with notifications unconfigured: no network, skip is logged, no PII in logs', async () => {
    const response = await postOrder();
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(await getOrderByNumber(data.orderNumber)).toBeDefined();
    await vi.waitFor(() =>
      expect(logs.some((l) => l.includes('[notifications] skipped') && l.includes('event=order.created'))).toBe(true),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getMemoryDeliveries()).toHaveLength(0);
    for (const value of PII) expect(logs.join('\n')).not.toContain(value);
  });

  it('a configured adapter receives a redacted payload for created, status_changed and paid', async () => {
    const received: unknown[] = [];
    const channel = fakeChannel(async (payload) => {
      received.push(payload);
      return { ok: true };
    });
    const deps = { channels: () => [channel] };
    await emitOrderEvent(created, deps);
    const changed = buildOrderEvent({
      event: 'order.status_changed',
      orderNumber: 'MS-1',
      status: 'CONFIRMED',
      previousStatus: 'NEW',
      grandTotal: 1000,
    });
    await emitOrderEvent(changed, deps);
    await emitOrderEvent(
      buildOrderEvent({ event: 'order.paid', orderNumber: 'MS-1', status: 'PAID', previousStatus: 'AWAITING_PAYMENT', grandTotal: 1000 }),
      deps,
    );
    expect(received.map((p) => (p as { event: string }).event)).toEqual([
      'order.created',
      'order.status_changed',
      'order.paid',
    ]);
    expect(Object.keys(received[0] as object).sort()).toEqual(['event', 'grandTotal', 'occurredAt', 'orderNumber', 'status']);
    expect(getMemoryDeliveries().map((d) => d.status)).toEqual(['SENT', 'SENT', 'SENT']);
    expect(formatOrderEventText(changed)).toContain('Новый → Подтверждён');
  });

  it('a failing or throwing adapter never rejects, is recorded, and leaks no secret', async () => {
    const throwing = fakeChannel(async () => {
      throw new Error('boom https://api.telegram.org/bot' + SECRET + '/sendMessage');
    });
    const failing = fakeChannel(async () => ({ ok: false, error: 'HTTP_500' }), 'fake2');
    await expect(emitOrderEvent(created, { channels: () => [throwing, failing] })).resolves.toBeUndefined();
    expect(getMemoryDeliveries()).toEqual([
      expect.objectContaining({ channel: 'fake2', status: 'FAILED', lastError: 'HTTP_500' }),
    ]);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('retries stored failures once the channel works', async () => {
    let healthy = false;
    let now = new Date('2026-09-21T10:00:00.000Z');
    const later = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));
    const channel = fakeChannel(async () => (healthy ? { ok: true } : { ok: false, error: 'HTTP_500' }));
    const deps = { channels: () => [channel], now: () => now };
    await emitOrderEvent(created, deps);
    later(1);
    expect(await retryFailedDeliveries(deps)).toBe(0);
    healthy = true;
    later(5);
    expect(await retryFailedDeliveries(deps)).toBe(1);
    expect(getMemoryDeliveries()[0]).toMatchObject({ status: 'SENT', attempts: 3 });
  });

  it('telegram adapter uses only the injected fetch; errors are codes without the token', async () => {
    const calls: string[] = [];
    const ok = createTelegramChannel({
      botToken: SECRET,
      chatId: '1',
      fetch: async (url) => {
        calls.push(url);
        return { ok: true, status: 200 };
      },
    });
    expect(await ok.send(created)).toEqual({ ok: true });
    expect(calls[0]).toContain('api.telegram.org');
    const bad = createTelegramChannel({
      botToken: SECRET,
      chatId: '1',
      fetch: async () => {
        throw new Error(SECRET);
      },
    });
    expect(await bad.send(created)).toEqual({ ok: false, error: 'NETWORK_ERROR' });
    expect(createTelegramChannel({ botToken: '', chatId: '' }).availability()).toEqual({
      ok: false,
      reason: 'NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
