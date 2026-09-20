import { describe, expect, it } from 'vitest';
import {
  checkOrderStatusTransition,
  isAllowedOrderStatusTransition,
  isTerminalOrderStatus,
  mayChannelSetOrderStatus,
  nextOrderStatuses,
  type OrderStatusChannel,
} from '@/lib/orders/status-transitions';
import { ORDER_STATUS_LABEL_RU, ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';
import type { OrderStatus } from '@/lib/types/domain';

/**
 * The transition policy is the whole workflow rule, so it is pinned here
 * exhaustively: every pair of statuses is asserted, not just the happy path.
 * If someone adds an edge to the graph, this file fails until the edge is
 * declared here too — which is the point.
 */

/** The forward path the business runs on. */
const FORWARD: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  ['NEW', 'CONFIRMED'],
  ['CONFIRMED', 'AWAITING_PAYMENT'],
  ['AWAITING_PAYMENT', 'PAID'],
  ['PAID', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'READY'],
  ['READY', 'DELIVERED'],
];

/** Cancellation is allowed from every state still being worked. */
const CANCELLABLE: readonly OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'AWAITING_PAYMENT',
  'PAID',
  'IN_PROGRESS',
  'READY',
];

const TERMINAL: readonly OrderStatus[] = ['DELIVERED', 'CANCELLED'];

const ALLOWED_EDGES = new Set<string>([
  ...FORWARD.map(([from, to]) => `${from}->${to}`),
  ...CANCELLABLE.map((from) => `${from}->CANCELLED`),
]);

describe('the order status vocabulary', () => {
  it('is exactly the eight business states', () => {
    expect([...ORDER_STATUS_VALUES]).toEqual([
      'NEW',
      'CONFIRMED',
      'AWAITING_PAYMENT',
      'PAID',
      'IN_PROGRESS',
      'READY',
      'DELIVERED',
      'CANCELLED',
    ]);
  });

  it('gives every state a Russian label for the admin UI', () => {
    for (const status of ORDER_STATUS_VALUES) {
      expect(ORDER_STATUS_LABEL_RU[status]).toBeTruthy();
    }
  });
});

describe('isAllowedOrderStatusTransition', () => {
  it.each(FORWARD)('allows the normal step %s → %s', (from, to) => {
    expect(isAllowedOrderStatusTransition(from, to)).toBe(true);
  });

  it.each(CANCELLABLE)('allows cancelling from %s', (from) => {
    expect(isAllowedOrderStatusTransition(from, 'CANCELLED')).toBe(true);
  });

  it.each(TERMINAL)('treats %s as terminal — nothing follows it', (status) => {
    expect(isTerminalOrderStatus(status)).toBe(true);
    for (const to of ORDER_STATUS_VALUES) {
      expect(isAllowedOrderStatusTransition(status, to)).toBe(false);
    }
  });

  it('rejects every edge that is not in the documented graph', () => {
    for (const from of ORDER_STATUS_VALUES) {
      for (const to of ORDER_STATUS_VALUES) {
        expect({
          edge: `${from}->${to}`,
          allowed: isAllowedOrderStatusTransition(from, to),
        }).toEqual({
          edge: `${from}->${to}`,
          allowed: ALLOWED_EDGES.has(`${from}->${to}`),
        });
      }
    }
  });

  it('never allows skipping a step or moving backwards', () => {
    // Representative skips and rewinds, spelled out so the intent is readable.
    expect(isAllowedOrderStatusTransition('NEW', 'PAID')).toBe(false);
    expect(isAllowedOrderStatusTransition('NEW', 'DELIVERED')).toBe(false);
    expect(isAllowedOrderStatusTransition('CONFIRMED', 'PAID')).toBe(false);
    expect(isAllowedOrderStatusTransition('AWAITING_PAYMENT', 'IN_PROGRESS')).toBe(false);
    expect(isAllowedOrderStatusTransition('PAID', 'AWAITING_PAYMENT')).toBe(false);
    expect(isAllowedOrderStatusTransition('READY', 'IN_PROGRESS')).toBe(false);
    expect(isAllowedOrderStatusTransition('CANCELLED', 'NEW')).toBe(false);
    expect(isAllowedOrderStatusTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });
});

describe('the PAID security boundary', () => {
  it('refuses PAID from a public/client channel', () => {
    expect(mayChannelSetOrderStatus('PUBLIC', 'PAID')).toBe(false);
    expect(
      checkOrderStatusTransition({ from: 'AWAITING_PAYMENT', to: 'PAID', channel: 'PUBLIC' }),
    ).toEqual({ ok: false, reason: 'UNTRUSTED_CHANNEL' });
  });

  it('refuses a public channel EVERY status, not only PAID', () => {
    for (const status of ORDER_STATUS_VALUES) {
      expect(mayChannelSetOrderStatus('PUBLIC', status)).toBe(false);
    }
    for (const [from, to] of FORWARD) {
      expect(checkOrderStatusTransition({ from, to, channel: 'PUBLIC' })).toEqual({
        ok: false,
        reason: 'UNTRUSTED_CHANNEL',
      });
    }
  });

  it('offers a public channel no next step from any state', () => {
    for (const status of ORDER_STATUS_VALUES) {
      expect(nextOrderStatuses(status, 'PUBLIC')).toEqual([]);
    }
  });

  it('checks the channel before anything else, so a rejection leaks nothing', () => {
    // Same status, terminal source, impossible edge — all answered the same
    // way for an untrusted caller.
    expect(checkOrderStatusTransition({ from: 'PAID', to: 'PAID', channel: 'PUBLIC' })).toEqual({
      ok: false,
      reason: 'UNTRUSTED_CHANNEL',
    });
    expect(checkOrderStatusTransition({ from: 'DELIVERED', to: 'PAID', channel: 'PUBLIC' })).toEqual({
      ok: false,
      reason: 'UNTRUSTED_CHANNEL',
    });
  });

  it.each<OrderStatusChannel>(['ADMIN', 'PAYMENT_PROVIDER'])('trusts %s with PAID', (channel) => {
    expect(mayChannelSetOrderStatus(channel, 'PAID')).toBe(true);
    expect(checkOrderStatusTransition({ from: 'AWAITING_PAYMENT', to: 'PAID', channel })).toEqual({
      ok: true,
    });
  });

  it('still refuses a trusted channel an illegal step to PAID', () => {
    // Being trusted with the value is not being allowed the transition.
    expect(checkOrderStatusTransition({ from: 'NEW', to: 'PAID', channel: 'ADMIN' })).toEqual({
      ok: false,
      reason: 'INVALID_TRANSITION',
    });
    expect(
      checkOrderStatusTransition({ from: 'CANCELLED', to: 'PAID', channel: 'PAYMENT_PROVIDER' }),
    ).toEqual({ ok: false, reason: 'TERMINAL' });
  });
});

describe('checkOrderStatusTransition', () => {
  it('reports a re-post of the current status as a no-op, not a failure', () => {
    expect(checkOrderStatusTransition({ from: 'CONFIRMED', to: 'CONFIRMED', channel: 'ADMIN' })).toEqual({
      ok: false,
      reason: 'SAME_STATUS',
    });
  });

  it('distinguishes a finished order from a merely impossible step', () => {
    expect(checkOrderStatusTransition({ from: 'DELIVERED', to: 'READY', channel: 'ADMIN' })).toEqual({
      ok: false,
      reason: 'TERMINAL',
    });
    expect(checkOrderStatusTransition({ from: 'NEW', to: 'READY', channel: 'ADMIN' })).toEqual({
      ok: false,
      reason: 'INVALID_TRANSITION',
    });
  });

  it('accepts the whole normal path, step by step', () => {
    for (const [from, to] of FORWARD) {
      expect(checkOrderStatusTransition({ from, to, channel: 'ADMIN' })).toEqual({ ok: true });
    }
  });
});

describe('nextOrderStatuses — what the admin screen may offer', () => {
  it('offers the forward step and cancellation while the order is live', () => {
    expect(nextOrderStatuses('NEW', 'ADMIN')).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(nextOrderStatuses('CONFIRMED', 'ADMIN')).toEqual(['AWAITING_PAYMENT', 'CANCELLED']);
    expect(nextOrderStatuses('AWAITING_PAYMENT', 'ADMIN')).toEqual(['PAID', 'CANCELLED']);
    expect(nextOrderStatuses('PAID', 'ADMIN')).toEqual(['IN_PROGRESS', 'CANCELLED']);
    expect(nextOrderStatuses('IN_PROGRESS', 'ADMIN')).toEqual(['READY', 'CANCELLED']);
    expect(nextOrderStatuses('READY', 'ADMIN')).toEqual(['DELIVERED', 'CANCELLED']);
  });

  it.each(TERMINAL)('offers nothing from %s', (status) => {
    expect(nextOrderStatuses(status, 'ADMIN')).toEqual([]);
  });

  it('only ever offers steps the policy would actually accept', () => {
    for (const from of ORDER_STATUS_VALUES) {
      for (const to of nextOrderStatuses(from, 'ADMIN')) {
        expect(checkOrderStatusTransition({ from, to, channel: 'ADMIN' })).toEqual({ ok: true });
      }
    }
  });
});
