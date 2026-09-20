import { hasDatabase } from '@/lib/env';
import type { OrderRecord } from '@/lib/orders/types';
import type { OrderStatus } from '@/lib/types/domain';
import { resolvePaymentProvider, type PaymentProviderResolution } from './config';
import {
  attachPaymentExternalId,
  createOrReusePendingPayment,
  getPaymentById,
  settlePayment,
} from './store';
import { PAYMENT_CURRENCY, type PaymentCurrency, type PaymentRecord, type PaymentStatus } from './types';

/**
 * The payment flow, and the trust boundary around it.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 *
 * 1. The amount is the server's. `createPaymentIntent` takes an order NUMBER
 *    and nothing else — there is no parameter, on this function or on the
 *    route that calls it, through which a client could propose a figure. The
 *    amount is read from the order's own stored total.
 *
 * 2. PAID is not something a request can assert. Only
 *    `confirmPaymentWithProvider` can produce it, and only after a
 *    server-to-server `getPaymentStatus` call says so. It then moves the order
 *    through the existing workflow on the PAYMENT_PROVIDER channel
 *    (src/lib/orders/status-transitions.ts), which is the same policy, CAS and
 *    audit path the admin panel uses — nothing here weakens or bypasses it.
 *
 * Both are moot today: no adapter is registered, so every provider call
 * returns a typed failure and nothing is ever created or confirmed. They are
 * written now so the adapter that arrives later inherits them.
 */

/* -------------------------------------------------------------------------- */
/* Order eligibility                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Orders that may be paid for online.
 *
 * NEW is excluded deliberately: an order is priced from the catalog at
 * submission but is not a commitment until a manager has confirmed it, and
 * taking money for something nobody has checked is the wrong default.
 * AWAITING_PAYMENT is included because that is exactly the state a customer
 * returns to after abandoning an attempt.
 */
export const PAYABLE_ORDER_STATUSES: readonly OrderStatus[] = ['CONFIRMED', 'AWAITING_PAYMENT'];

export function isPayableOrderStatus(status: OrderStatus): boolean {
  return PAYABLE_ORDER_STATUSES.includes(status);
}

/**
 * The status an order should move to once an attempt is open, or null when it
 * is already there. Pure, so the "creating a payment moves a confirmed order
 * to AWAITING_PAYMENT" rule is one testable thing rather than a branch buried
 * in the flow. Returns a status only — whether the move is permitted is still
 * decided by the transition policy at the moment of writing.
 */
export function orderStatusAfterPaymentCreated(current: OrderStatus): OrderStatus | null {
  return current === 'CONFIRMED' ? 'AWAITING_PAYMENT' : null;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

/** What is safe to hand back to a browser. No provider credentials, no
 * internal cost data, no order internals beyond what the customer already
 * knows from their own confirmation page. */
export interface PublicPaymentView {
  paymentId: string;
  orderNumber: string;
  status: PaymentStatus;
  amount: number;
  currency: PaymentCurrency;
  /** Where to send the customer, when the provider issued somewhere to go. */
  redirectUrl?: string;
}

export type CreatePaymentIntentResult =
  | { ok: true; payment: PublicPaymentView; reused: boolean }
  | { ok: false; reason: 'PAYMENTS_UNAVAILABLE' }
  | { ok: false; reason: 'ORDER_NOT_FOUND' }
  | { ok: false; reason: 'ORDER_NOT_PAYABLE'; status: OrderStatus }
  | { ok: false; reason: 'PROVIDER_ERROR' };

export type ConfirmPaymentResult =
  | { ok: true; status: PaymentStatus; orderStatusChanged: boolean }
  | { ok: false; reason: 'PAYMENTS_UNAVAILABLE' }
  | { ok: false; reason: 'PAYMENT_NOT_FOUND' }
  | { ok: false; reason: 'ALREADY_SETTLED'; status: PaymentStatus }
  | { ok: false; reason: 'PROVIDER_ERROR' };

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Seams, not configuration. Every default is the real implementation; the
 * parameter exists so tests can drive the flow with a fake provider without
 * the production code ever consulting a test-only switch, and so the
 * order-status move can be exercised without a database.
 */
export interface PaymentServiceDeps {
  resolveProvider: () => PaymentProviderResolution;
  getOrderByNumber: (orderNumber: string) => Promise<OrderRecord | undefined>;
  /** Moves the order through the workflow on the PAYMENT_PROVIDER channel. */
  moveOrderStatus: (input: { orderId: string; to: OrderStatus }) => Promise<boolean>;
}

/**
 * The order workflow lives in the admin service, which is PostgreSQL-only by
 * design (assertAdminDatabaseConfigured) — the in-memory development store
 * has no status history and never mutates an order. So without a database the
 * move is skipped rather than faked: the payment attempt is still recorded
 * correctly, and the order simply keeps the status it has.
 */
async function moveOrderStatusAsPaymentProvider(input: { orderId: string; to: OrderStatus }): Promise<boolean> {
  if (!hasDatabase) return false;
  const { updateOrderStatus, AdminOrderStatusTransitionNotAllowedError, AdminOrderConflictError } = await import(
    '@/lib/admin/orders'
  );
  try {
    const result = await updateOrderStatus({
      orderId: input.orderId,
      newStatus: input.to,
      // The one place in the codebase that uses this channel. It is asserted
      // here — after a server-to-server provider answer, never from a request
      // body — which is what makes the PAID boundary meaningful.
      channel: 'PAYMENT_PROVIDER',
      actor: { name: 'Платёжная система' },
    });
    return result.changed;
  } catch (error) {
    // The order moved underneath us (a manager cancelled it, or another
    // request got there first). The payment record is already correct and is
    // the thing that matters; the order's status is a human's call from here.
    if (error instanceof AdminOrderStatusTransitionNotAllowedError || error instanceof AdminOrderConflictError) {
      return false;
    }
    throw error;
  }
}

const defaultDeps: PaymentServiceDeps = {
  resolveProvider: resolvePaymentProvider,
  getOrderByNumber: async (orderNumber) => {
    const { getOrderByNumber } = await import('@/lib/orders/store');
    return getOrderByNumber(orderNumber);
  },
  moveOrderStatus: moveOrderStatusAsPaymentProvider,
};

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

function toPublicView(payment: PaymentRecord, orderNumber: string, redirectUrl?: string): PublicPaymentView {
  return {
    paymentId: payment.id,
    orderNumber,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    redirectUrl,
  };
}

/**
 * Opens (or re-uses) a payment attempt for an order.
 *
 * Note the signature: an order number is the only input. The amount, the
 * currency, the provider and the status are all decided here.
 */
export async function createPaymentIntent(
  input: { orderNumber: string },
  deps: PaymentServiceDeps = defaultDeps,
): Promise<CreatePaymentIntentResult> {
  // Asked first, so a disabled build touches neither the order table nor the
  // payment table — there is no side effect at all to observe.
  const resolution = deps.resolveProvider();
  if (!resolution.ok) return { ok: false, reason: 'PAYMENTS_UNAVAILABLE' };
  const provider = resolution.provider;

  const order = await deps.getOrderByNumber(input.orderNumber);
  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };
  if (!isPayableOrderStatus(order.status)) {
    return { ok: false, reason: 'ORDER_NOT_PAYABLE', status: order.status };
  }

  // THE server-authoritative amount: the order's own stored grand total, the
  // figure the pricing engine produced and the database kept. Order totals
  // are never recalculated after creation (see src/lib/admin/orders.ts), so
  // this is stable for the life of the order.
  const amount = order.grandTotal;

  // Persisted BEFORE the provider is contacted: if the provider call succeeds
  // but the response is lost, the attempt still exists and the next request
  // re-uses it rather than opening a second payable transaction.
  const { payment, created } = await createOrReusePendingPayment({
    orderId: order.id,
    provider: provider.id,
    amount,
  });

  if (!created) {
    // An attempt is already open for this order. Idempotent by design: the
    // customer is sent back to the same transaction, not given a new one.
    //
    // KNOWN GAP FOR THE FIRST REAL ADAPTER: no redirectUrl is returned here,
    // because none is stored — a provider's checkout URL can embed a
    // single-use token, and persisting one is a decision that needs the
    // provider's actual documentation (does it expire? may it be re-shown?).
    // Deliberately left as "no link" rather than guessed at: the customer
    // sees the attempt, not a URL that may be dead. Resolving it is part of
    // writing the adapter, not of this foundation.
    return { ok: true, payment: toPublicView(payment, order.orderNumber), reused: true };
  }

  const intent = await provider.createPayment({
    paymentId: payment.id,
    orderNumber: order.orderNumber,
    amount,
    currency: PAYMENT_CURRENCY,
    description: `Заказ ${order.orderNumber}`,
  });

  if (!intent.ok) {
    // Close the attempt we just opened so the order is not left holding an
    // open transaction that no provider knows about. The reason is our own
    // short code, never the provider's raw message.
    await settlePayment(payment.id, 'FAILED', `provider:${intent.reason}`);
    return { ok: false, reason: 'PROVIDER_ERROR' };
  }

  if (intent.value.externalId) {
    await attachPaymentExternalId(payment.id, intent.value.externalId);
  }

  const nextStatus = orderStatusAfterPaymentCreated(order.status);
  if (nextStatus) {
    await deps.moveOrderStatus({ orderId: order.id, to: nextStatus });
  }

  return {
    ok: true,
    payment: toPublicView(payment, order.orderNumber, intent.value.redirectUrl),
    reused: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Confirm                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY path in this application that can mark a payment PAID.
 *
 * It takes an internal payment id and nothing else — no amount, no status, no
 * provider payload. Whatever prompts a call (a future webhook, a scheduled
 * poll, an admin pressing "check"), the answer is fetched from the provider
 * server-to-server; an inbound request can at most make us ask the question,
 * never supply the answer. No public route calls this, and none should
 * without an authenticated or provider-verified trigger in front of it.
 */
export async function confirmPaymentWithProvider(
  paymentId: string,
  deps: PaymentServiceDeps = defaultDeps,
): Promise<ConfirmPaymentResult> {
  const resolution = deps.resolveProvider();
  if (!resolution.ok) return { ok: false, reason: 'PAYMENTS_UNAVAILABLE' };

  const payment = await getPaymentById(paymentId);
  if (!payment) return { ok: false, reason: 'PAYMENT_NOT_FOUND' };
  if (payment.status !== 'PENDING') return { ok: false, reason: 'ALREADY_SETTLED', status: payment.status };

  const answer = await resolution.provider.getPaymentStatus({
    paymentId: payment.id,
    externalId: payment.externalId,
  });
  if (!answer.ok) return { ok: false, reason: 'PROVIDER_ERROR' };

  // Still open at the provider: nothing to record, and emphatically not a
  // reason to assume anything either way.
  if (answer.value.status === 'PENDING') return { ok: true, status: 'PENDING', orderStatusChanged: false };

  const settled = await settlePayment(payment.id, answer.value.status, answer.value.failureReason);
  if (!settled) {
    const current = await getPaymentById(payment.id);
    return { ok: false, reason: 'ALREADY_SETTLED', status: current?.status ?? payment.status };
  }

  if (answer.value.status !== 'PAID') {
    return { ok: true, status: answer.value.status, orderStatusChanged: false };
  }

  const orderStatusChanged = await deps.moveOrderStatus({ orderId: payment.orderId, to: 'PAID' });
  return { ok: true, status: 'PAID', orderStatusChanged };
}
