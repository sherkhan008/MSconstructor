import { beforeEach, describe, expect, it } from 'vitest';
import {
  PAYABLE_ORDER_STATUSES,
  confirmPaymentWithProvider,
  createPaymentIntent,
  isPayableOrderStatus,
  orderStatusAfterPaymentCreated,
  type PaymentServiceDeps,
} from '@/lib/payments/service';
import { clearMemoryPayments, countMemoryPayments, getPaymentsByOrderId } from '@/lib/payments/store';
import { resolvePaymentProvider } from '@/lib/payments/config';
import type { PaymentProvider, PaymentProviderIntent, PaymentProviderResult } from '@/lib/payments/provider';
import type { PaymentStatus } from '@/lib/payments/types';
import type { OrderRecord } from '@/lib/orders/types';
import { checkOrderStatusTransition } from '@/lib/orders/status-transitions';
import type { OrderStatus } from '@/lib/types/domain';

/**
 * The payment flow's two guarantees, proven against a FAKE provider — because
 * the real registry is empty, and must stay empty, so the shipped default can
 * never take a payment.
 *
 *   1. The amount is the order's. There is no input through which a caller
 *      could propose one; the tests below try to and cannot even express it.
 *   2. PAID comes only from a provider answer, never from a caller.
 */

const ORDER_ID = 'order-abc';
const ORDER_NUMBER = 'MS-20260920-QWERT';
const ORDER_TOTAL = 412_500;

function orderAt(status: OrderStatus, grandTotal = ORDER_TOTAL): OrderRecord {
  return {
    id: ORDER_ID,
    orderNumber: ORDER_NUMBER,
    status,
    customer: {
      fullName: 'Тест Тестов',
      phone: '77001234567',
      city: 'Алматы',
      type: 'INDIVIDUAL',
    },
    paymentPreference: 'BANK_TRANSFER',
    items: [],
    netTotal: grandTotal,
    vatTotal: 0,
    discountTotal: 0,
    grandTotal,
    createdAt: new Date().toISOString(),
  };
}

interface FakeProviderOptions {
  intent?: PaymentProviderResult<PaymentProviderIntent>;
  status?: PaymentProviderResult<{ status: PaymentStatus; failureReason?: string }>;
}

function fakeProvider(options: FakeProviderOptions = {}) {
  const createCalls: { amount: number; currency: string; paymentId: string }[] = [];
  const provider: PaymentProvider = {
    id: 'fake',
    async createPayment(input) {
      createCalls.push({ amount: input.amount, currency: input.currency, paymentId: input.paymentId });
      return options.intent ?? { ok: true, value: { externalId: 'ext-1', redirectUrl: 'https://provider.example/pay' } };
    },
    async getPaymentStatus() {
      return options.status ?? { ok: true, value: { status: 'PENDING' } };
    },
  };
  return { provider, createCalls };
}

interface FakeDeps extends PaymentServiceDeps {
  moves: { orderId: string; to: OrderStatus }[];
  createCalls: { amount: number; currency: string; paymentId: string }[];
}

function deps(order: OrderRecord | undefined, options: FakeProviderOptions = {}): FakeDeps {
  const { provider, createCalls } = fakeProvider(options);
  const moves: { orderId: string; to: OrderStatus }[] = [];
  return {
    resolveProvider: () => ({ ok: true, provider }),
    getOrderByNumber: async (orderNumber) => (order && order.orderNumber === orderNumber ? order : undefined),
    moveOrderStatus: async (move) => {
      moves.push(move);
      return true;
    },
    moves,
    createCalls,
  };
}

beforeEach(() => {
  clearMemoryPayments();
});

/* -------------------------------------------------------------------------- */

describe('payments are unavailable by default', () => {
  it('creates nothing at all with the real (empty) registry', async () => {
    const result = await createPaymentIntent({ orderNumber: ORDER_NUMBER });
    expect(result).toEqual({ ok: false, reason: 'PAYMENTS_UNAVAILABLE' });
    expect(countMemoryPayments()).toBe(0);
  });

  it('cannot confirm anything either', async () => {
    await expect(confirmPaymentWithProvider('any-id')).resolves.toEqual({
      ok: false,
      reason: 'PAYMENTS_UNAVAILABLE',
    });
  });

  it('short-circuits before reading the order', async () => {
    let orderReads = 0;
    const result = await createPaymentIntent(
      { orderNumber: ORDER_NUMBER },
      {
        resolveProvider: resolvePaymentProvider,
        getOrderByNumber: async () => {
          orderReads += 1;
          return orderAt('CONFIRMED');
        },
        moveOrderStatus: async () => true,
      },
    );
    expect(result.ok).toBe(false);
    expect(orderReads).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('the expected amount comes from the server order', () => {
  it('uses the order grand total, and hands the provider the same figure', async () => {
    const d = deps(orderAt('CONFIRMED'));
    const result = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.amount).toBe(ORDER_TOTAL);
    expect(result.payment.currency).toBe('KZT');
    expect(d.createCalls).toEqual([{ amount: ORDER_TOTAL, currency: 'KZT', paymentId: result.payment.paymentId }]);

    const [stored] = await getPaymentsByOrderId(ORDER_ID);
    expect(stored.amount).toBe(ORDER_TOTAL);
    expect(stored.currency).toBe('KZT');
  });

  it('follows the order when the order total is different', async () => {
    const d = deps(orderAt('CONFIRMED', 77_000));
    const result = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);
    expect(result.ok && result.payment.amount).toBe(77_000);
  });

  it('accepts no client-supplied amount — the input has no such field', async () => {
    const result = await createPaymentIntent(
      // Inline literal on purpose: excess-property checking makes this a
      // TYPE error, so widening the service's input to accept a caller's
      // amount would fail the build, not just this assertion.
      // @ts-expect-error createPaymentIntent accepts { orderNumber } only.
      { orderNumber: ORDER_NUMBER, amount: 1, grandTotal: 1, status: 'PAID' },
      deps(orderAt('CONFIRMED')),
    );
    expect(result.ok && result.payment.amount).toBe(ORDER_TOTAL);
    expect(result.ok && result.payment.status).toBe('PENDING');
  });
});

/* -------------------------------------------------------------------------- */

describe('duplicate payment creation is idempotent', () => {
  it('returns the same attempt instead of opening a second payable transaction', async () => {
    const order = orderAt('CONFIRMED');
    const first = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    const second = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    const third = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));

    expect(first.ok && first.reused).toBe(false);
    expect(second.ok && second.reused).toBe(true);
    expect(third.ok && third.reused).toBe(true);
    expect(first.ok && second.ok && first.payment.paymentId).toBe(second.ok ? second.payment.paymentId : '');
    expect(countMemoryPayments()).toBe(1);
  });

  it('does not call the provider again for a re-used attempt', async () => {
    const order = orderAt('CONFIRMED');
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    const d = deps(order);
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);
    expect(d.createCalls).toEqual([]);
  });

  it('concurrent requests still produce exactly one attempt', async () => {
    const order = orderAt('CONFIRMED');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(countMemoryPayments()).toBe(1);
  });

  it('allows a fresh attempt once the previous one has settled', async () => {
    const order = orderAt('CONFIRMED');
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    const [first] = await getPaymentsByOrderId(ORDER_ID);

    const { settlePayment } = await import('@/lib/payments/store');
    await settlePayment(first.id, 'CANCELLED', 'customer closed the page');

    const retry = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    expect(retry.ok && retry.reused).toBe(false);
    // One order, two attempts — the history of the first is kept.
    const all = await getPaymentsByOrderId(ORDER_ID);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.status).sort()).toEqual(['CANCELLED', 'PENDING']);
  });
});

/* -------------------------------------------------------------------------- */

describe('payment/order association', () => {
  it('attaches the attempt to the order it was created for', async () => {
    const result = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(orderAt('CONFIRMED')));
    const [stored] = await getPaymentsByOrderId(ORDER_ID);
    expect(stored.orderId).toBe(ORDER_ID);
    expect(result.ok && result.payment.orderNumber).toBe(ORDER_NUMBER);
    expect(await getPaymentsByOrderId('some-other-order')).toEqual([]);
  });

  it('refuses an order that does not exist', async () => {
    const result = await createPaymentIntent({ orderNumber: 'MS-00000000-XXXXX' }, deps(orderAt('CONFIRMED')));
    expect(result).toEqual({ ok: false, reason: 'ORDER_NOT_FOUND' });
    expect(countMemoryPayments()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('which orders may be paid for', () => {
  it('allows only a confirmed or already-awaiting order', () => {
    expect([...PAYABLE_ORDER_STATUSES]).toEqual(['CONFIRMED', 'AWAITING_PAYMENT']);
    for (const status of ['NEW', 'PAID', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'] as OrderStatus[]) {
      expect(isPayableOrderStatus(status)).toBe(false);
    }
  });

  it('creates nothing for an unconfirmed, paid or cancelled order', async () => {
    for (const status of ['NEW', 'PAID', 'DELIVERED', 'CANCELLED'] as OrderStatus[]) {
      clearMemoryPayments();
      const result = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(orderAt(status)));
      expect(result).toEqual({ ok: false, reason: 'ORDER_NOT_PAYABLE', status });
      expect(countMemoryPayments()).toBe(0);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('order status integration', () => {
  it('moves a CONFIRMED order to AWAITING_PAYMENT, and nothing else anywhere', () => {
    expect(orderStatusAfterPaymentCreated('CONFIRMED')).toBe('AWAITING_PAYMENT');
    for (const status of [
      'NEW',
      'AWAITING_PAYMENT',
      'PAID',
      'IN_PROGRESS',
      'READY',
      'DELIVERED',
      'CANCELLED',
    ] as OrderStatus[]) {
      expect(orderStatusAfterPaymentCreated(status)).toBeNull();
    }
  });

  it('asks for exactly that move when an attempt opens', async () => {
    const d = deps(orderAt('CONFIRMED'));
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);
    expect(d.moves).toEqual([{ orderId: ORDER_ID, to: 'AWAITING_PAYMENT' }]);
  });

  it('never asks for PAID when an attempt merely opens', async () => {
    const d = deps(orderAt('CONFIRMED'));
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);
    expect(d.moves.some((m) => m.to === 'PAID')).toBe(false);
  });

  it('does not re-move an order already awaiting payment', async () => {
    const d = deps(orderAt('AWAITING_PAYMENT'));
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);
    expect(d.moves).toEqual([]);
  });

  it('asks for a move the existing transition policy actually permits', () => {
    // The service never bypasses the policy; this pins that the move it asks
    // for is legal for the channel it asks on.
    expect(
      checkOrderStatusTransition({ from: 'CONFIRMED', to: 'AWAITING_PAYMENT', channel: 'PAYMENT_PROVIDER' }),
    ).toEqual({ ok: true });
    expect(checkOrderStatusTransition({ from: 'AWAITING_PAYMENT', to: 'PAID', channel: 'PAYMENT_PROVIDER' })).toEqual({
      ok: true,
    });
    // ...and that the public channel is refused both of them.
    expect(
      checkOrderStatusTransition({ from: 'CONFIRMED', to: 'AWAITING_PAYMENT', channel: 'PUBLIC' }).ok,
    ).toBe(false);
    expect(checkOrderStatusTransition({ from: 'AWAITING_PAYMENT', to: 'PAID', channel: 'PUBLIC' }).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('provider failure is never a silent success', () => {
  it('settles the attempt FAILED and reports an error when the provider refuses', async () => {
    const d = deps(orderAt('CONFIRMED'), {
      intent: { ok: false, reason: 'PROVIDER_ERROR', message: 'Authorization: Bearer super-secret-token' },
    });
    const result = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, d);

    expect(result).toEqual({ ok: false, reason: 'PROVIDER_ERROR' });
    const [stored] = await getPaymentsByOrderId(ORDER_ID);
    expect(stored.status).toBe('FAILED');
    // The provider's own message — which carried a token — is not persisted.
    expect(stored.failureReason).toBe('provider:PROVIDER_ERROR');
    expect(stored.failureReason).not.toContain('super-secret-token');
    // A failed attempt leaves the order where it was.
    expect(d.moves).toEqual([]);
  });

  it('leaves the order payable again after a failed attempt', async () => {
    const order = orderAt('CONFIRMED');
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order, {
      intent: { ok: false, reason: 'PROVIDER_ERROR', message: 'boom' },
    }));
    const retry = await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    expect(retry.ok && retry.reused).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('only a verified provider answer can produce PAID', () => {
  async function openAttempt(order = orderAt('CONFIRMED')) {
    await createPaymentIntent({ orderNumber: ORDER_NUMBER }, deps(order));
    const [payment] = await getPaymentsByOrderId(ORDER_ID);
    return payment;
  }

  it('marks PAID and moves the order when the provider says so', async () => {
    const payment = await openAttempt();
    const d = deps(orderAt('AWAITING_PAYMENT'), { status: { ok: true, value: { status: 'PAID' } } });

    const result = await confirmPaymentWithProvider(payment.id, d);

    expect(result).toEqual({ ok: true, status: 'PAID', orderStatusChanged: true });
    expect(d.moves).toEqual([{ orderId: ORDER_ID, to: 'PAID' }]);
    const [stored] = await getPaymentsByOrderId(ORDER_ID);
    expect(stored.status).toBe('PAID');
    expect(stored.paidAt).toBeTruthy();
  });

  it('records FAILED/EXPIRED without ever touching the order status', async () => {
    for (const status of ['FAILED', 'EXPIRED', 'CANCELLED'] as const) {
      clearMemoryPayments();
      const payment = await openAttempt();
      const d = deps(orderAt('AWAITING_PAYMENT'), { status: { ok: true, value: { status } } });

      const result = await confirmPaymentWithProvider(payment.id, d);
      expect(result).toEqual({ ok: true, status, orderStatusChanged: false });
      expect(d.moves).toEqual([]);
    }
  });

  it('does nothing when the provider says the attempt is still open', async () => {
    const payment = await openAttempt();
    const d = deps(orderAt('AWAITING_PAYMENT'), { status: { ok: true, value: { status: 'PENDING' } } });

    expect(await confirmPaymentWithProvider(payment.id, d)).toEqual({
      ok: true,
      status: 'PENDING',
      orderStatusChanged: false,
    });
    expect(d.moves).toEqual([]);
    expect((await getPaymentsByOrderId(ORDER_ID))[0].status).toBe('PENDING');
  });

  it('does not mark PAID when the provider cannot be reached', async () => {
    const payment = await openAttempt();
    const d = deps(orderAt('AWAITING_PAYMENT'), {
      status: { ok: false, reason: 'PROVIDER_ERROR', message: 'timeout' },
    });

    expect(await confirmPaymentWithProvider(payment.id, d)).toEqual({ ok: false, reason: 'PROVIDER_ERROR' });
    expect((await getPaymentsByOrderId(ORDER_ID))[0].status).toBe('PENDING');
    expect(d.moves).toEqual([]);
  });

  it('cannot settle the same attempt twice — PAID is a one-way door', async () => {
    const payment = await openAttempt();
    const paidDeps = deps(orderAt('AWAITING_PAYMENT'), { status: { ok: true, value: { status: 'PAID' } } });
    await confirmPaymentWithProvider(payment.id, paidDeps);

    // A replayed confirmation, and an attempt to walk PAID back to FAILED.
    const replay = await confirmPaymentWithProvider(payment.id, paidDeps);
    expect(replay).toEqual({ ok: false, reason: 'ALREADY_SETTLED', status: 'PAID' });

    const downgrade = await confirmPaymentWithProvider(
      payment.id,
      deps(orderAt('PAID'), { status: { ok: true, value: { status: 'FAILED' } } }),
    );
    expect(downgrade).toEqual({ ok: false, reason: 'ALREADY_SETTLED', status: 'PAID' });
    expect((await getPaymentsByOrderId(ORDER_ID))[0].status).toBe('PAID');
  });

  it('confirms nothing for an unknown payment id', async () => {
    const d = deps(orderAt('AWAITING_PAYMENT'), { status: { ok: true, value: { status: 'PAID' } } });
    expect(await confirmPaymentWithProvider('not-a-payment', d)).toEqual({
      ok: false,
      reason: 'PAYMENT_NOT_FOUND',
    });
    expect(d.moves).toEqual([]);
  });
});
