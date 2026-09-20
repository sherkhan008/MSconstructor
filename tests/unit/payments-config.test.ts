import { describe, expect, it } from 'vitest';
import {
  isOnlinePaymentAvailable,
  resolvePaymentProvider,
  resolvePaymentsAvailability,
} from '@/lib/payments/config';
import { createPaymentProviderById, isKnownPaymentProviderId, listPaymentProviderIds } from '@/lib/payments/registry';
import { createUnavailablePaymentProvider } from '@/lib/payments/provider';
import { checkProductionConfig } from '@/lib/startup/production-config';
import {
  PAYMENT_CURRENCY,
  PAYMENT_FAILURE_REASON_MAX_LENGTH,
  PAYMENT_STATUSES,
  isSettledPaymentStatus,
  pendingPaymentKey,
  sanitizeFailureReason,
} from '@/lib/payments/types';

/**
 * Online payment is OFF, and this file is what keeps it off. Every way a
 * misconfiguration could accidentally switch it on — a truthy-looking flag,
 * an unregistered provider name, an adapter that fails to build — is pinned
 * to "unavailable" here.
 */

describe('resolvePaymentsAvailability — disabled by default', () => {
  it('is disabled when nothing is configured', () => {
    expect(resolvePaymentsAvailability({})).toEqual({ available: false, reason: 'DISABLED' });
  });

  it('is disabled for every value that is not the exact string "true"', () => {
    for (const value of ['false', '', ' ', '1', 'yes', 'on', 'True', 'TRUE', 'enabled']) {
      expect(resolvePaymentsAvailability({ PAYMENTS_ENABLED: value, PAYMENTS_PROVIDER: 'kaspi' })).toEqual({
        available: false,
        reason: 'DISABLED',
      });
    }
  });

  it('is not configured when enabled without a provider name', () => {
    expect(resolvePaymentsAvailability({ PAYMENTS_ENABLED: 'true' })).toEqual({
      available: false,
      reason: 'NOT_CONFIGURED',
    });
  });

  it('is not configured when enabled with a provider this build has no adapter for', () => {
    expect(resolvePaymentsAvailability({ PAYMENTS_ENABLED: 'true', PAYMENTS_PROVIDER: 'kaspi' })).toEqual({
      available: false,
      reason: 'NOT_CONFIGURED',
      providerId: 'kaspi',
    });
  });
});

describe('payment provider registry', () => {
  it('registers no adapter — online payment cannot be enabled by configuration alone', () => {
    expect(listPaymentProviderIds()).toEqual([]);
    expect(isKnownPaymentProviderId('kaspi')).toBe(false);
    expect(createPaymentProviderById('kaspi')).toBeNull();
  });

  it('does not resolve an adapter from a prototype key', () => {
    // Object.hasOwn, not `in`: "constructor"/"toString" must not look known.
    expect(isKnownPaymentProviderId('constructor')).toBe(false);
    expect(isKnownPaymentProviderId('toString')).toBe(false);
  });
});

describe('resolvePaymentProvider — the running process', () => {
  it('reports payment as unavailable with the repository defaults', () => {
    const resolution = resolvePaymentProvider();
    expect(resolution.ok).toBe(false);
    expect(isOnlinePaymentAvailable()).toBe(false);
  });

  it('still returns a provider, and that provider refuses everything', async () => {
    const resolution = resolvePaymentProvider();
    const created = await resolution.provider.createPayment({
      paymentId: 'p1',
      orderNumber: 'MS-20260920-AAAAA',
      amount: 100_000,
      currency: PAYMENT_CURRENCY,
      description: 'test',
    });
    const status = await resolution.provider.getPaymentStatus({ paymentId: 'p1' });

    expect(created.ok).toBe(false);
    expect(status.ok).toBe(false);
    // The critical property: there is no shape an unavailable provider can
    // return that a caller could read as "the customer has paid".
    expect(created).not.toHaveProperty('value');
    expect(status).not.toHaveProperty('value');
  });
});

describe('createUnavailablePaymentProvider', () => {
  it('never fabricates a success and never throws', async () => {
    const provider = createUnavailablePaymentProvider('NOT_CONFIGURED', 'nope');
    await expect(
      provider.getPaymentStatus({ paymentId: 'p1', externalId: 'x' }),
    ).resolves.toEqual({ ok: false, reason: 'NOT_CONFIGURED', message: 'nope' });
  });
});

describe('production preflight — payments', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@db:5432/app',
    AUTH_SECRET: 'a'.repeat(48),
    APP_URL: 'https://shelving.example',
    TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-real-ip',
    NEXT_PUBLIC_WHATSAPP_NUMBER: '77071234567',
  };

  it('accepts a production config with payments left off', () => {
    expect(checkProductionConfig({ ...base, PAYMENTS_ENABLED: 'false' }).errors).toEqual([]);
    expect(checkProductionConfig(base).errors).toEqual([]);
  });

  it('refuses to start when payments are enabled with no adapter behind them', () => {
    const report = checkProductionConfig({ ...base, PAYMENTS_ENABLED: 'true', PAYMENTS_PROVIDER: 'kaspi' });
    expect(report.errors.some((e) => e.includes('PAYMENTS_ENABLED'))).toBe(true);
  });

  it('refuses to start when payments are enabled with no provider named', () => {
    const report = checkProductionConfig({ ...base, PAYMENTS_ENABLED: 'true' });
    expect(report.errors.some((e) => e.includes('PAYMENTS_ENABLED'))).toBe(true);
  });

  it('warns — without failing — about an ambiguous flag value', () => {
    const report = checkProductionConfig({ ...base, PAYMENTS_ENABLED: 'yes' });
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => w.includes('PAYMENTS_ENABLED'))).toBe(true);
  });

  it('never repeats a variable value back into a log line', () => {
    const report = checkProductionConfig({
      ...base,
      PAYMENTS_ENABLED: 'true',
      PAYMENTS_PROVIDER: 'super-secret-provider-name',
    });
    for (const message of [...report.errors, ...report.warnings]) {
      expect(message).not.toContain('super-secret-provider-name');
    }
  });
});

describe('payment domain vocabulary', () => {
  it('has exactly the five states of the agreed lifecycle', () => {
    expect([...PAYMENT_STATUSES]).toEqual(['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED']);
  });

  it('treats PENDING as the only open state', () => {
    expect(isSettledPaymentStatus('PENDING')).toBe(false);
    for (const status of PAYMENT_STATUSES.filter((s) => s !== 'PENDING')) {
      expect(isSettledPaymentStatus(status)).toBe(true);
    }
  });

  it('prices everything in tenge', () => {
    expect(PAYMENT_CURRENCY).toBe('KZT');
  });

  it('derives the idempotency key from the order and provider only', () => {
    expect(pendingPaymentKey('order-1', 'kaspi')).toBe('order-1:kaspi');
    expect(pendingPaymentKey('order-1', 'kaspi')).toBe(pendingPaymentKey('order-1', 'kaspi'));
    expect(pendingPaymentKey('order-1', 'kaspi')).not.toBe(pendingPaymentKey('order-2', 'kaspi'));
  });
});

describe('sanitizeFailureReason', () => {
  it('drops empty and whitespace-only reasons', () => {
    expect(sanitizeFailureReason(undefined)).toBeUndefined();
    expect(sanitizeFailureReason('')).toBeUndefined();
    expect(sanitizeFailureReason('   \n  ')).toBeUndefined();
  });

  it('strips control characters so a reason cannot forge a log line', () => {
    expect(sanitizeFailureReason('declined\n[startup] FATAL: fake')).toBe('declined [startup] FATAL: fake');
    expect(sanitizeFailureReason('a\u0000b\tc')).toBe('a b c');
  });

  it('truncates, so an accidental payload dump is not persisted whole', () => {
    const long = `token=${'x'.repeat(5_000)}`;
    expect(sanitizeFailureReason(long)).toHaveLength(PAYMENT_FAILURE_REASON_MAX_LENGTH);
  });
});
