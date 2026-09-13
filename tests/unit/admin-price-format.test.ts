import { describe, expect, it } from 'vitest';
import {
  canonicalPriceString,
  formatPriceKzt,
  toPriceInputValue,
  validatePriceString,
} from '@/lib/admin/price-format';
import { parsePriceInput } from '@/lib/admin/price-input';

/**
 * The admin price UI applies these helpers in the browser, where a price is
 * only ever a string. Two properties matter:
 *
 *   1. the client-side check gives the SAME verdict as the server boundary —
 *      both call validatePriceString(), so a value the dialog accepts is never
 *      rejected by PATCH and vice versa;
 *   2. no helper here converts money through `Number`, so "12000.50" survives
 *      display, round-trip into an input and back out without precision loss.
 */

describe('validatePriceString matches the server boundary', () => {
  it.each([
    '0',
    '12000',
    '12000.5',
    '12000.50',
    '  12000.50  ',
    '0.01',
    '9999999999.99',
    '-1',
    '-0.01',
    '1.234',
    '1e5',
    'NaN',
    'Infinity',
    '12,500',
    '12 500',
    '12000,50',
    '+100',
    '.5',
    '5.',
    '',
    '   ',
    'abc',
    '10000000000',
    '99999999999.99',
  ])('agrees with parsePriceInput for %j', (input) => {
    expect(validatePriceString(input).ok).toBe(parsePriceInput(input).ok);
  });

  it('reports the same error code as the server for each rejection class', () => {
    expect(validatePriceString('1.234')).toMatchObject({ ok: false, code: 'TOO_MANY_DECIMALS' });
    expect(validatePriceString('1e5')).toMatchObject({ ok: false, code: 'MALFORMED' });
    expect(validatePriceString('12,500')).toMatchObject({ ok: false, code: 'MALFORMED' });
    expect(validatePriceString('-1')).toMatchObject({ ok: false, code: 'MALFORMED' });
    expect(validatePriceString('10000000000')).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(validatePriceString('')).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(validatePriceString(12000)).toMatchObject({ ok: false, code: 'NOT_A_STRING' });
  });

  it('returns the trimmed string, never a number', () => {
    const result = validatePriceString('  12000.50 ');
    expect(result).toEqual({ ok: true, value: '12000.50' });
  });
});

describe('formatPriceKzt', () => {
  it.each([
    ['0.00', '0 ₸'],
    ['120.00', '120 ₸'],
    ['12500.00', '12 500 ₸'],
    ['145000.00', '145 000 ₸'],
    ['1234567.00', '1 234 567 ₸'],
    ['9999999999.99', '9 999 999 999.99 ₸'],
  ])('formats %j as %j', (input, expected) => {
    expect(formatPriceKzt(input)).toBe(expected);
  });

  it('keeps a real fractional part distinguishable from a whole price', () => {
    expect(formatPriceKzt('12500.50')).toBe('12 500.50 ₸');
    expect(formatPriceKzt('12500.05')).toBe('12 500.05 ₸');
    expect(formatPriceKzt('12500.00')).toBe('12 500 ₸');
    expect(formatPriceKzt('12500.50')).not.toBe(formatPriceKzt('12500.00'));
  });

  it('does not round a fractional price away', () => {
    // 0.1 + 0.2 float arithmetic never happens here: the digits are copied.
    expect(formatPriceKzt('0.30')).toBe('0.30 ₸');
    expect(formatPriceKzt('0.01')).toBe('0.01 ₸');
  });
});

describe('toPriceInputValue', () => {
  it('drops an empty fractional part so an admin edits whole tenge', () => {
    expect(toPriceInputValue('12000.00')).toBe('12000');
  });

  it('keeps a meaningful fractional part exactly', () => {
    expect(toPriceInputValue('12000.50')).toBe('12000.50');
    expect(toPriceInputValue('12000.05')).toBe('12000.05');
  });

  it('produces a value the boundary accepts and that is decimal-equal', () => {
    for (const stored of ['0.00', '12000.00', '12000.50', '9999999999.99']) {
      const editable = toPriceInputValue(stored);
      expect(validatePriceString(editable).ok).toBe(true);
      expect(canonicalPriceString(editable)).toBe(canonicalPriceString(stored));
    }
  });
});

describe('canonicalPriceString', () => {
  it('treats differently spelled equal prices as equal', () => {
    expect(canonicalPriceString('12000')).toBe(canonicalPriceString('12000.00'));
    expect(canonicalPriceString('12000.5')).toBe(canonicalPriceString('12000.50'));
    expect(canonicalPriceString('012000')).toBe(canonicalPriceString('12000.00'));
  });

  it('keeps genuinely different prices different', () => {
    expect(canonicalPriceString('12000')).not.toBe(canonicalPriceString('12000.01'));
    expect(canonicalPriceString('12000.50')).not.toBe(canonicalPriceString('12000.05'));
  });
});
