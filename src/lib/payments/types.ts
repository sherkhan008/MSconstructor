/**
 * The payment domain: what one payment ATTEMPT is, separately from the order
 * it belongs to.
 *
 * Why the two are separate: an order is a commercial commitment that exists
 * once; paying for it can be tried more than once (a customer abandons the
 * provider's page, a card is declined, an attempt times out). Folding
 * "have we been paid" into Order alone would lose that history, so an Order
 * has many Payments and at most one of them is open at a time per provider.
 *
 * Nothing creates a Payment yet. Online payment is DISABLED by default
 * (src/lib/payments/config.ts) and no provider adapter is registered
 * (src/lib/payments/registry.ts), so every current checkout still runs
 * through the three manager-confirmed offline methods in
 * src/lib/orders/payment-methods.ts. This module exists so that when a real
 * provider arrives it implements an already-reviewed shape instead of
 * inventing its own fields and its own trust boundary.
 */

/**
 * The lifecycle of one attempt — mirrors the Prisma `PaymentStatus` enum.
 * PENDING is the only open state; the other four are terminal.
 */
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Attempts that are over. An attempt in one of these never moves again. */
export const SETTLED_PAYMENT_STATUSES = ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;

export type SettledPaymentStatus = (typeof SETTLED_PAYMENT_STATUSES)[number];

export function isSettledPaymentStatus(status: PaymentStatus): status is SettledPaymentStatus {
  return status !== 'PENDING';
}

/** Every amount in this system is tenge. Kept as a constant rather than a
 * literal at each call site so the currency written to the database and the
 * currency reported to a provider can never drift apart. */
export const PAYMENT_CURRENCY = 'KZT';

export type PaymentCurrency = typeof PAYMENT_CURRENCY;

export interface PaymentRecord {
  /** Internal payment id — ours, never the provider's. */
  id: string;
  /** The order this attempt pays for. */
  orderId: string;
  /** Registry key of the provider handling this attempt. */
  provider: string;
  status: PaymentStatus;
  /**
   * The amount the customer is expected to pay, in tenge. ALWAYS derived on
   * the server from the order's own stored total — there is deliberately no
   * code path, and no field on any request schema, through which a browser
   * can propose this number.
   */
  amount: number;
  currency: PaymentCurrency;
  /** The provider's identifier for this attempt; absent until one is issued. */
  externalId?: string;
  invoiceNumber?: string;
  /** Short, secret-free reason a settled attempt is not PAID. */
  failureReason?: string;
  /** Set only when a trusted path confirmed the money arrived. */
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Creating an attempt takes no status, no id, no timestamps and — crucially —
 * no caller-chosen currency: the store fills all of them. The amount is a
 * required input because only the caller can read the order, but the only
 * caller is src/lib/payments/service.ts, which reads it from the order.
 */
export interface CreatePaymentInput {
  orderId: string;
  provider: string;
  amount: number;
  invoiceNumber?: string;
}

/**
 * The idempotency key of an OPEN attempt, and the whole rule in one line:
 * one order + one provider = at most one payable transaction at a time. It is
 * stored on the row while the attempt is PENDING and cleared when it settles,
 * behind a unique index — so a duplicate request loses at the database, not at
 * a read-then-write race in application code. Derived from server-side values
 * only; a client has no say in it.
 */
export function pendingPaymentKey(orderId: string, provider: string): string {
  return `${orderId}:${provider}`;
}

/** Longest failure reason we will store. Long enough to stay useful, short
 * enough that an accidental payload dump is truncated rather than persisted. */
export const PAYMENT_FAILURE_REASON_MAX_LENGTH = 200;

/**
 * Makes a failure reason safe to persist and to show.
 *
 * A provider error can carry an access token, a signed callback body or a
 * customer's card details in its message, and this column is read by the
 * admin panel. So the reason is treated as untrusted text: control characters
 * (which could forge log lines) are stripped, whitespace is collapsed, and
 * the result is truncated. Callers should pass a short provider-neutral code
 * of their own — never a raw provider response.
 */
export function sanitizeFailureReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const cleaned = reason
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, PAYMENT_FAILURE_REASON_MAX_LENGTH);
}
