import { describe, expect, it } from 'vitest';
import {
  amountInWordsRu,
  DocumentAmountError,
  formatAmount,
  formatAmountWithCurrency,
  integerToWordsRu,
  toTiyn,
} from '@/lib/documents/money';

describe('toTiyn — persisted Decimal(14,2) → exact integer tiyn', () => {
  it('reads Decimal-like objects, numbers and strings without float drift', () => {
    expect(toTiyn({ toFixed: () => '445392.00' })).toBe(44539200n);
    expect(toTiyn('0.1')).toBe(10n);
    expect(toTiyn('0.07')).toBe(7n);
    expect(toTiyn(191979)).toBe(19197900n);
    expect(toTiyn('999999999999.99')).toBe(99999999999999n);
  });

  it('rejects anything that is not a plain decimal amount', () => {
    for (const bad of ['', 'abc', '1e5', '1.234', '12,50', 'NaN']) {
      expect(() => toTiyn(bad)).toThrow(DocumentAmountError);
    }
  });
});

describe('formatAmount', () => {
  it('uses space-grouped thousands, a comma and two decimals', () => {
    expect(formatAmount(44539200n)).toBe('445 392,00');
    expect(formatAmount(5n)).toBe('0,05');
    expect(formatAmount(123456789012n)).toBe('1 234 567 890,12');
    expect(formatAmountWithCurrency(100000n)).toBe('1 000,00 ₸');
  });
});

describe('amount in words (сумма прописью)', () => {
  it.each([
    [0n, 'ноль'],
    [1n, 'один'],
    [2n, 'два'],
    [11n, 'одиннадцать'],
    [21n, 'двадцать один'],
    [100n, 'сто'],
    [1000n, 'одна тысяча'],
    [2000n, 'две тысячи'],
    [5000n, 'пять тысяч'],
    [11000n, 'одиннадцать тысяч'],
    [21000n, 'двадцать одна тысяча'],
    [22000n, 'двадцать две тысячи'],
    [1000000n, 'один миллион'],
    [2000001n, 'два миллиона один'],
    [445392n, 'четыреста сорок пять тысяч триста девяносто два'],
    [6249398n, 'шесть миллионов двести сорок девять тысяч триста девяносто восемь'],
    [1000000000n, 'один миллиард'],
  ])('%s → %s', (value, words) => {
    expect(integerToWordsRu(value)).toBe(words);
  });

  it('capitalises and appends tenge and tiyn', () => {
    expect(amountInWordsRu(44539200n)).toBe('Четыреста сорок пять тысяч триста девяносто два тенге 00 тиын');
    expect(amountInWordsRu(105n)).toBe('Один тенге 05 тиын');
  });

  it('refuses a negative amount', () => {
    expect(() => amountInWordsRu(-1n)).toThrow(DocumentAmountError);
  });
});
