import type { PaymentProvider } from './provider';

/**
 * The provider adapters this build knows how to use.
 *
 * IT IS EMPTY, AND THAT IS THE CURRENT CORRECT STATE. No adapter can be
 * written until the official merchant details for a provider exist, and a
 * placeholder entry here would be worse than none: PAYMENTS_ENABLED=true
 * would then resolve to something that cannot actually take money, which is
 * precisely the fake availability this foundation is built to prevent. With
 * the map empty, online payment cannot be switched on by configuration alone
 * — the production preflight refuses to start a server whose PAYMENTS_ENABLED
 * names a provider that is not here (src/lib/startup/production-config.ts).
 *
 * TO PLUG IN A REAL ADAPTER LATER
 *
 *   1. Add src/lib/payments/providers/<name>.ts exporting a factory that
 *      returns a PaymentProvider (see src/lib/payments/provider.ts). Read its
 *      credentials from its own environment variables inside the factory —
 *      never from a literal in source, and never re-exported to the client.
 *   2. Register it below:  <name>: () => create<Name>PaymentProvider(),
 *   3. Set PAYMENTS_PROVIDER=<name> and PAYMENTS_ENABLED=true.
 *
 * Nothing else in the payment flow changes: the amount still comes from the
 * order, the PAID boundary still belongs to the PAYMENT_PROVIDER channel, and
 * the idempotency guard still lives in the database.
 */
const PAYMENT_PROVIDER_FACTORIES: Record<string, () => PaymentProvider> = {};

export function listPaymentProviderIds(): string[] {
  return Object.keys(PAYMENT_PROVIDER_FACTORIES);
}

export function isKnownPaymentProviderId(id: string): boolean {
  return Object.hasOwn(PAYMENT_PROVIDER_FACTORIES, id);
}

/** The adapter for `id`, or null when this build has none. */
export function createPaymentProviderById(id: string): PaymentProvider | null {
  const factory = PAYMENT_PROVIDER_FACTORIES[id];
  return factory ? factory() : null;
}
