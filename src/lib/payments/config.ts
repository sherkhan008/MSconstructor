import { env } from '@/lib/env';
import { createUnavailablePaymentProvider, type PaymentProvider } from './provider';
import { createPaymentProviderById, isKnownPaymentProviderId } from './registry';

/**
 * Whether online payment is available, and which adapter serves it.
 *
 * Pure with respect to its input so every rule is unit-testable and so the
 * production preflight can ask the same question the runtime asks. The
 * default is OFF at every step: an unset flag, a misspelled flag, a missing
 * provider name and an unknown provider name all resolve to "unavailable".
 */

export interface PaymentsConfigInput {
  PAYMENTS_ENABLED?: string;
  PAYMENTS_PROVIDER?: string;
}

export type PaymentsAvailability =
  /** PAYMENTS_ENABLED is not the literal "true". The default. */
  | { available: false; reason: 'DISABLED' }
  /** Switched on, but PAYMENTS_PROVIDER is unset or names no known adapter. */
  | { available: false; reason: 'NOT_CONFIGURED'; providerId?: string }
  | { available: true; providerId: string };

/**
 * Strict equality with "true" on purpose. A feature that moves money must be
 * turned on by an unambiguous act, so none of "1", "yes", "TRUE" or "on"
 * count — each of them leaves payment off rather than guessing at intent.
 */
export function resolvePaymentsAvailability(input: PaymentsConfigInput): PaymentsAvailability {
  if (input.PAYMENTS_ENABLED?.trim() !== 'true') {
    return { available: false, reason: 'DISABLED' };
  }
  const providerId = input.PAYMENTS_PROVIDER?.trim();
  if (!providerId) {
    return { available: false, reason: 'NOT_CONFIGURED' };
  }
  if (!isKnownPaymentProviderId(providerId)) {
    return { available: false, reason: 'NOT_CONFIGURED', providerId };
  }
  return { available: true, providerId };
}

/** The running process's answer. */
export function paymentsAvailability(): PaymentsAvailability {
  return resolvePaymentsAvailability({
    PAYMENTS_ENABLED: env.PAYMENTS_ENABLED,
    PAYMENTS_PROVIDER: env.PAYMENTS_PROVIDER,
  });
}

/**
 * True only when a real adapter would actually be used. Read this — never
 * `env.PAYMENTS_ENABLED` — to decide whether an online-payment entry point
 * exists at all.
 */
export function isOnlinePaymentAvailable(): boolean {
  return paymentsAvailability().available;
}

export type PaymentProviderResolution =
  | { ok: true; provider: PaymentProvider }
  | { ok: false; reason: 'DISABLED' | 'NOT_CONFIGURED'; provider: PaymentProvider };

/**
 * The provider for this process. Always returns a provider object, so no
 * caller has to special-case "none" and accidentally treat a missing provider
 * as success — but an unavailable one answers every call with a typed
 * failure. Never throws.
 */
export function resolvePaymentProvider(): PaymentProviderResolution {
  const availability = paymentsAvailability();

  if (!availability.available) {
    const message =
      availability.reason === 'DISABLED'
        ? 'Online payment is disabled (PAYMENTS_ENABLED).'
        : 'Online payment is enabled but no provider adapter is configured (PAYMENTS_PROVIDER).';
    return {
      ok: false,
      reason: availability.reason,
      provider: createUnavailablePaymentProvider(availability.reason, message),
    };
  }

  const provider = createPaymentProviderById(availability.providerId);
  if (!provider) {
    // Unreachable while isKnownPaymentProviderId gates the branch above; kept
    // so a future registry that can fail to build an adapter still fails
    // closed instead of returning undefined into the payment flow.
    return {
      ok: false,
      reason: 'NOT_CONFIGURED',
      provider: createUnavailablePaymentProvider('NOT_CONFIGURED', 'Payment provider adapter could not be created.'),
    };
  }

  return { ok: true, provider };
}
