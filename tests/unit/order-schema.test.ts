import { describe, expect, it } from 'vitest';
import { orderFormSchema, orderRequestSchema, customerPaymentPreferenceSchema } from '@/lib/pricing/schema';

function baseIndividual(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Тест Тестов',
    phone: '+77001234567',
    email: 'test@example.com',
    city: 'Алматы',
    customerType: 'INDIVIDUAL' as const,
    paymentPreference: 'BANK_TRANSFER' as const,
    ...overrides,
  };
}

describe('orderFormSchema — individual customer checkout', () => {
  it('accepts a minimal valid individual submission', () => {
    const result = orderFormSchema.safeParse(baseIndividual());
    expect(result.success).toBe(true);
  });

  it('does not require companyName/binIin for an individual', () => {
    const result = orderFormSchema.safeParse(baseIndividual());
    expect(result.success).toBe(true);
  });
});

describe('orderFormSchema — required customer fields', () => {
  it('rejects an empty fullName', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ fullName: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only fullName', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ fullName: '   ' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.') === 'fullName')).toBe(true);
  });

  it('rejects a missing phone', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ phone: '' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.') === 'phone')).toBe(true);
  });

  it('rejects a structurally invalid phone', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ phone: '12345' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path.join('.') === 'phone')?.message).toBe('Укажите корректный номер телефона');
  });

  it.each(['+7 777 123 45 67', '+7 (777) 123-45-67', '87771234567'])('accepts the Kazakhstan phone format %s', (phone) => {
    const result = orderFormSchema.safeParse(baseIndividual({ phone }));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues) : undefined).toBe(true);
  });

  it('normalizes the domestic "8" prefix to "+7" without altering the rest of the number', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ phone: '87771234567' }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phone).toBe('+77771234567');
  });

  it('rejects a missing email', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ email: '' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path.join('.') === 'email')?.message).toBe('Укажите корректный email');
  });

  it('rejects a malformed email', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ email: 'abc' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path.join('.') === 'email')?.message).toBe('Укажите корректный email');
  });

  it('trims surrounding whitespace from email before validating', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ email: '  test@example.com  ' }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.email).toBe('test@example.com');
  });

  it('rejects a missing payment method', () => {
    const { paymentPreference: _omit, ...rest } = baseIndividual();
    const result = orderFormSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path.join('.') === 'paymentPreference')?.message).toBe('Выберите способ оплаты');
  });
});

describe('orderFormSchema — legal entity validation', () => {
  it('rejects a legal entity submission with no company name', () => {
    const result = orderFormSchema.safeParse(
      baseIndividual({ customerType: 'LEGAL_ENTITY', binIin: '123456789012' }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.') === 'companyName')).toBe(true);
  });

  it('rejects a legal entity submission with a missing BIN', () => {
    const result = orderFormSchema.safeParse(
      baseIndividual({ customerType: 'LEGAL_ENTITY', companyName: 'ТОО Ромашка' }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.') === 'binIin')).toBe(true);
  });

  it('rejects a BIN that is not exactly 12 digits', () => {
    const result = orderFormSchema.safeParse(
      baseIndividual({ customerType: 'LEGAL_ENTITY', companyName: 'ТОО Ромашка', binIin: '123' }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.') === 'binIin')).toBe(true);
  });

  it('accepts a legal entity submission with a valid company name and 12-digit BIN', () => {
    const result = orderFormSchema.safeParse(
      baseIndividual({ customerType: 'LEGAL_ENTITY', companyName: 'ТОО Ромашка', binIin: '123456789012' }),
    );
    expect(result.success).toBe(true);
  });
});

describe('orderFormSchema — optional WhatsApp normalization', () => {
  it('accepts a missing whatsapp field', () => {
    const result = orderFormSchema.safeParse(baseIndividual());
    expect(result.success).toBe(true);
  });

  it('normalizes a formatted whatsapp number to digits-with-plus', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ whatsapp: '+7 (700) 123-45-67' }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.whatsapp).toBe('+77001234567');
  });

  it('rejects a malformed whatsapp number', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ whatsapp: '12345' }));
    expect(result.success).toBe(false);
  });
});

describe('customerPaymentPreferenceSchema — only currently supported methods', () => {
  it.each(['BANK_TRANSFER', 'BANK_INVOICE', 'CASH'])('accepts %s', (method) => {
    expect(customerPaymentPreferenceSchema.safeParse(method).success).toBe(true);
  });

  it.each(['KASPI_PAY', 'KASPI_QR'])('rejects %s at the schema level', (method) => {
    expect(customerPaymentPreferenceSchema.safeParse(method).success).toBe(false);
  });

  it('rejects a checkout form submission that selects KASPI_PAY', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ paymentPreference: 'KASPI_PAY' }));
    expect(result.success).toBe(false);
  });

  it('rejects a checkout form submission that selects KASPI_QR', () => {
    const result = orderFormSchema.safeParse(baseIndividual({ paymentPreference: 'KASPI_QR' }));
    expect(result.success).toBe(false);
  });
});

describe('orderRequestSchema — full request (items included)', () => {
  function withItems(overrides: Record<string, unknown> = {}) {
    return {
      ...baseIndividual(overrides),
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
    };
  }

  it('accepts a full valid individual order request', () => {
    expect(orderRequestSchema.safeParse(withItems()).success).toBe(true);
  });

  it('rejects an empty items array', () => {
    expect(orderRequestSchema.safeParse({ ...withItems(), items: [] }).success).toBe(false);
  });

  it('rejects KASPI_PAY at the full-request boundary too', () => {
    expect(orderRequestSchema.safeParse(withItems({ paymentPreference: 'KASPI_PAY' })).success).toBe(false);
  });
});
