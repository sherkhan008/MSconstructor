import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { MAX_PRICE_VALUE, formatPriceDecimal, parsePriceInput } from '@/lib/admin/price-input';

/**
 * Prices are written to Decimal(12, 2) and are authoritative commercial data.
 * The boundary must accept exact decimal strings only — never a float, never a
 * silently rounded or clamped value (spec: "Do not silently round malformed
 * admin input").
 */

describe('parsePriceInput — accepted values', () => {
  it.each([
    ['0', '0.00'],
    ['1', '1.00'],
    ['12000', '12000.00'],
    ['12000.5', '12000.50'],
    ['12000.50', '12000.50'],
    ['  12000.50  ', '12000.50'],
    ['0.01', '0.01'],
    [MAX_PRICE_VALUE, '9999999999.99'],
  ])('accepts %j', (input, expected) => {
    const result = parsePriceInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(formatPriceDecimal(result.value)).toBe(expected);
  });

  it('produces a Prisma.Decimal, not a JS number', () => {
    const result = parsePriceInput('0.30');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeInstanceOf(Prisma.Decimal);
  });

  it('keeps exact decimal arithmetic that floats would corrupt', () => {
    const a = parsePriceInput('0.10');
    const b = parsePriceInput('0.20');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // 0.1 + 0.2 === 0.30000000000000004 as floats.
    expect(formatPriceDecimal(a.value.plus(b.value))).toBe('0.30');
  });
});

describe('parsePriceInput — rejected values', () => {
  it.each([
    ['-1', 'negative'],
    ['-0.01', 'negative fraction'],
    ['12000.123', 'three decimals'],
    ['12000.1234', 'four decimals'],
    ['NaN', 'NaN spelling'],
    ['Infinity', 'Infinity spelling'],
    ['-Infinity', 'negative Infinity spelling'],
    ['1e5', 'exponent notation'],
    ['12 000', 'thousands space'],
    ['12,000.50', 'thousands comma'],
    ['12000,50', 'comma decimal separator'],
    ['+100', 'leading plus'],
    ['abc', 'not a number'],
    ['', 'empty string'],
    ['   ', 'blank string'],
    ['.5', 'missing integer part'],
    ['5.', 'trailing dot'],
    ['10000000000', 'above Decimal(12,2) range'],
    ['99999999999.99', 'far above range'],
  ])('rejects %j (%s)', (input) => {
    expect(parsePriceInput(input).ok).toBe(false);
  });

  it.each([
    [null],
    [undefined],
    [12000],
    [12000.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [true],
    [{ value: '100' }],
    [['100']],
  ])('rejects the non-string %j', (input) => {
    const result = parsePriceInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_A_STRING');
  });

  it('never rounds a too-precise value into a valid one', () => {
    const result = parsePriceInput('100.999');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOO_MANY_DECIMALS');
  });

  it('reports out-of-range separately from malformed', () => {
    const result = parsePriceInput('10000000000.00');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUT_OF_RANGE');
  });
});
