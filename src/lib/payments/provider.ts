import type { PaymentCurrency, PaymentStatus } from './types';

/**
 * The boundary a real online-payment provider (Kaspi, or anything else) will
 * be implemented behind.
 *
 * It is deliberately narrow — two methods — and deliberately empty of any
 * assumption about a specific provider. No endpoint, no credential shape, no
 * callback/webhook format and no service identifier appears anywhere in this
 * file, because none of those are known for Kaspi yet and guessing them would
 * produce an adapter that has to be rewritten rather than filled in.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 *
 * There is no `verifyCallback(payload)`. Verifying an inbound callback needs
 * the provider's signing scheme and payload layout; inventing a placeholder
 * for it would encode exactly the undocumented assumption we must not make.
 * Instead, confirmation always goes the other way round: something tells us
 * "attempt X may have moved", and the server asks the provider itself via
 * `getPaymentStatus`. That works whether the real Kaspi integration turns out
 * to be webhook-driven or polled, and it means the authoritative answer always
 * comes from a server-to-server call rather than from an inbound request body.
 */

/** Why a provider call could not produce a real answer. */
export type PaymentProviderFailureReason =
  /** Online payment is switched off (PAYMENTS_ENABLED). */
  | 'DISABLED'
  /** Switched on, but no usable adapter is configured for it. */
  | 'NOT_CONFIGURED'
  /** A configured adapter tried and failed (network, provider error). */
  | 'PROVIDER_ERROR';

/**
 * Every provider call returns one of these. A failure is a VALUE, not an
 * exception and never a fabricated success: there is no shape a disabled or
 * unconfigured provider can return that a caller could mistake for "the
 * customer has paid".
 */
export type PaymentProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PaymentProviderFailureReason; message: string };

/** What the server hands a provider to open an attempt. All server-derived. */
export interface PaymentProviderCreateInput {
  /** Our internal payment id — what a provider should echo back to us. */
  paymentId: string;
  /** Shown to the customer; never used as an authorisation token. */
  orderNumber: string;
  /** Tenge, taken from the order's own stored total. */
  amount: number;
  currency: PaymentCurrency;
  /** Short customer-facing description of what is being paid for. */
  description: string;
}

/** What a provider gives back. Both fields are optional because providers
 * differ: some return a hosted-checkout URL, some a QR payload, some only an
 * identifier. Nothing beyond these two is assumed. */
export interface PaymentProviderIntent {
  /** The provider's own id for the attempt, stored as Payment.externalId. */
  externalId?: string;
  /** Where the browser should send the customer, when the provider issues one. */
  redirectUrl?: string;
}

export interface PaymentProvider {
  /** Registry key; matches PAYMENTS_PROVIDER. */
  readonly id: string;

  /** Opens an attempt with the provider for an already-persisted Payment row. */
  createPayment(input: PaymentProviderCreateInput): Promise<PaymentProviderResult<PaymentProviderIntent>>;

  /**
   * Asks the provider what actually happened to an attempt. This is the only
   * source a PAID confirmation may come from — see
   * src/lib/payments/service.ts.
   */
  getPaymentStatus(input: {
    paymentId: string;
    externalId?: string;
  }): Promise<PaymentProviderResult<{ status: PaymentStatus; failureReason?: string }>>;
}

/**
 * The provider used when online payment is off or unconfigured. Every call
 * fails with the given reason, so a mis-wired feature flag can only ever make
 * payment unavailable — it can never make an unpaid order look paid.
 */
export function createUnavailablePaymentProvider(
  reason: Extract<PaymentProviderFailureReason, 'DISABLED' | 'NOT_CONFIGURED'>,
  message: string,
): PaymentProvider {
  const failure = async <T>(): Promise<PaymentProviderResult<T>> => ({ ok: false, reason, message });
  return {
    id: 'unavailable',
    createPayment: failure,
    getPaymentStatus: failure,
  };
}
