import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_DEFAULT_GRAPH_API_VERSION,
  normalizeWhatsAppRecipient,
  resolveWhatsAppConfig,
  type WhatsAppEnvInput,
} from '@/lib/notifications/providers/whatsapp-config';
import { checkProductionConfig, type ProductionConfigInput } from '@/lib/startup/production-config';

const TOKEN = 'EAAG-SECRET-ACCESS-TOKEN-xyz';

const ENABLED: WhatsAppEnvInput = {
  WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ADMIN_RECIPIENT: '+7 (707) 123-45-67',
  WHATSAPP_TEMPLATE_NAME: 'new_order_admin',
  WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
};

const PRODUCTION_BASE: ProductionConfigInput = {
  DATABASE_URL: 'postgresql://ms_shelving:0123456789abcdef@postgres:5432/ms_shelving?schema=public',
  AUTH_SECRET: 'q3Xv1mZ8pL2sT9wK4yB7nC6dF0gH5jR2uE8iO1aS3zQ=',
  APP_URL: 'https://ms-stellazh.kz',
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-real-ip',
  REDIS_URL: 'redis://:0123456789abcdef@redis:6379/0',
  NEXT_PUBLIC_WHATSAPP_NUMBER: '77071234567',
};

describe('normalizeWhatsAppRecipient', () => {
  it.each([
    ['+7 (707) 123-45-67', '77071234567'],
    ['77071234567', '77071234567'],
    ['+7.707.123.45.67', '77071234567'],
    ['00 7 707 123 45 67', '77071234567'],
    [' +49 151 2345 6789 ', '4915123456789'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeWhatsAppRecipient(raw)).toBe(expected);
  });

  it.each([undefined, '', '   ', '12345', 'abc', '+7 707 ABC 45 67', '+0 707 123 45 67', '1234567890123456', '7707;1234567'])(
    'rejects %j',
    (raw) => {
      expect(normalizeWhatsAppRecipient(raw)).toBeNull();
    },
  );
});

describe('resolveWhatsAppConfig', () => {
  it('is disabled unless the flag is exactly "true" — credentials are then irrelevant', () => {
    for (const flag of [undefined, 'false', 'TRUE', '1', 'yes', '']) {
      expect(resolveWhatsAppConfig({ WHATSAPP_NOTIFICATIONS_ENABLED: flag })).toEqual({ state: 'disabled' });
    }
  });

  it('is ready with a normalised recipient and the default Graph API version', () => {
    expect(resolveWhatsAppConfig(ENABLED)).toEqual({
      state: 'ready',
      config: {
        accessToken: TOKEN,
        phoneNumberId: '123456789012345',
        recipient: '77071234567',
        templateName: 'new_order_admin',
        templateLanguage: 'ru',
        graphApiVersion: WHATSAPP_DEFAULT_GRAPH_API_VERSION,
      },
    });
    const custom = resolveWhatsAppConfig({ ...ENABLED, WHATSAPP_GRAPH_API_VERSION: 'v25.0' });
    expect(custom.state === 'ready' && custom.config.graphApiVersion).toBe('v25.0');
  });

  it.each([
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ADMIN_RECIPIENT',
    'WHATSAPP_TEMPLATE_NAME',
    'WHATSAPP_TEMPLATE_LANGUAGE',
  ] as const)('enabled without %s is invalid', (name) => {
    const result = resolveWhatsAppConfig({ ...ENABLED, [name]: undefined });
    expect(result.state).toBe('invalid');
    expect(result.state === 'invalid' && result.problems.join(' ')).toContain(name);
  });

  it.each([
    [{ WHATSAPP_PHONE_NUMBER_ID: 'abc' }, 'WHATSAPP_PHONE_NUMBER_ID'],
    [{ WHATSAPP_ADMIN_RECIPIENT: '8 707' }, 'WHATSAPP_ADMIN_RECIPIENT'],
    [{ WHATSAPP_TEMPLATE_NAME: 'New Order' }, 'WHATSAPP_TEMPLATE_NAME'],
    [{ WHATSAPP_TEMPLATE_LANGUAGE: 'russian' }, 'WHATSAPP_TEMPLATE_LANGUAGE'],
    [{ WHATSAPP_GRAPH_API_VERSION: '24' }, 'WHATSAPP_GRAPH_API_VERSION'],
  ])('rejects a malformed value %j', (override, name) => {
    const result = resolveWhatsAppConfig({ ...ENABLED, ...override });
    expect(result.state === 'invalid' && result.problems.join(' ')).toContain(name);
  });
});

describe('production startup check (WhatsApp)', () => {
  it('does not fail when WhatsApp is disabled or unset, whatever credentials are missing', () => {
    expect(checkProductionConfig(PRODUCTION_BASE)).toEqual({ errors: [], warnings: [] });
    expect(checkProductionConfig({ ...PRODUCTION_BASE, WHATSAPP_NOTIFICATIONS_ENABLED: 'false' })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('accepts a complete enabled configuration', () => {
    expect(checkProductionConfig({ ...PRODUCTION_BASE, ...ENABLED })).toEqual({ errors: [], warnings: [] });
  });

  it('fails clearly when enabled with missing credentials, naming variables but never values', () => {
    const { errors } = checkProductionConfig({
      ...PRODUCTION_BASE,
      ...ENABLED,
      WHATSAPP_PHONE_NUMBER_ID: undefined,
      WHATSAPP_TEMPLATE_NAME: undefined,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/WHATSAPP_NOTIFICATIONS_ENABLED is true/);
    expect(errors[0]).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(errors[0]).toMatch(/WHATSAPP_TEMPLATE_NAME/);
    expect(errors[0]).not.toContain(TOKEN);
  });

  it('warns (and stays disabled) on an ambiguous flag value', () => {
    const { errors, warnings } = checkProductionConfig({ ...PRODUCTION_BASE, WHATSAPP_NOTIFICATIONS_ENABLED: 'yes' });
    expect(errors).toEqual([]);
    expect(warnings.join('\n')).toMatch(/WHATSAPP_NOTIFICATIONS_ENABLED/);
  });
});
