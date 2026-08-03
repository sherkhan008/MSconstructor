import { describe, expect, it } from 'vitest';
import { addVat, extractVat, formatPrice, multiply, percentOf, roundTenge, sum } from '@/lib/money';

describe('money helpers', () => {
  it('rounds half-up to whole tenge', () => {
    expect(roundTenge(100.4)).toBe(100);
    expect(roundTenge(100.5)).toBe(101);
    expect(roundTenge(-100.5)).toBe(-101);
  });

  it('multiplies and rounds', () => {
    expect(multiply(1000, 3)).toBe(3000);
    expect(multiply(333.333, 3)).toBe(1000);
  });

  it('computes percentages', () => {
    expect(percentOf(10_000, 16)).toBe(1600);
    expect(percentOf(10_000, 0)).toBe(0);
  });

  it('sums a list of amounts with independent rounding', () => {
    expect(sum([100.4, 100.4, 100.4])).toBe(300);
  });

  it('adds VAT on top of a net amount', () => {
    const { gross, vat } = addVat(10_000, 16);
    expect(vat).toBe(1600);
    expect(gross).toBe(11_600);
  });

  it('extracts VAT from a gross amount consistently with addVat', () => {
    const { gross } = addVat(10_000, 16);
    const { net, vat } = extractVat(gross, 16);
    expect(net + vat).toBe(gross);
    expect(net).toBe(10_000);
  });

  it('formats prices with grouped digits and the tenge sign', () => {
    expect(formatPrice(1234567)).toBe('1 234 567 ₸');
    expect(formatPrice(0)).toBe('0 ₸');
  });
});
