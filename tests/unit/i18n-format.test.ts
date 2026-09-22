import { describe, expect, it } from 'vitest';
import { pick, t } from '@/lib/i18n/format';
import { shelvesLabel } from '@/lib/plural';
import { ER, WA } from '@/lib/i18n/strings';
import { formatPrice } from '@/lib/money';

describe('t(): owner-reviewed text with placeholders', () => {
  it('fills placeholders written differently per language, in either order', () => {
    // ru "Высота {H} мм недоступна для модели «{модель}»" / kk "«{Модель}» … {H} мм …"
    const vars = { H: 2345, model: 'MS Стандарт' };
    expect(t(ER['ER-039'], 'ru', vars)).toBe('Высота 2345 мм недоступна для модели «MS Стандарт»');
    const kk = t(ER['ER-039'], 'kk', vars);
    expect(kk).toContain('2345');
    expect(kk).toContain('MS Стандарт');
    expect(kk).not.toMatch(/[{}]/);
  });

  it('leaves a placeholder without a value visible instead of dropping it', () => {
    expect(t(ER['ER-025'], 'ru', {})).toBe('Промокод «{код}» не найден или недействителен');
  });

  it('keeps the owner-approved greeting punctuation "Сәлеметсіз бе ?!" untouched', () => {
    expect(t(WA['WA-019'], 'kk')).toBe('Сәлеметсіз бе ?!');
    expect(t(WA['WA-001'], 'kk').startsWith('Сәлеметсіз бе ?! ')).toBe(true);
    expect(t(WA['WA-019'], 'ru')).toBe('Здравствуйте!');
  });
});

describe('pick(): catalog LocalizedText with an explicit fallback', () => {
  it('uses the Kazakh value on Kazakh pages and the Russian value on Russian pages', () => {
    const text = { ru: 'Доставка по городу', kk: 'Қала ішінде жеткізу' };
    expect(pick(text, 'kk')).toBe('Қала ішінде жеткізу');
    expect(pick(text, 'ru')).toBe('Доставка по городу');
  });

  it('falls back from a missing/blank Kazakh value to Russian — never the other way round', () => {
    expect(pick({ ru: 'Только русский', kk: '' }, 'kk')).toBe('Только русский');
    expect(pick({ ru: 'Только русский', kk: '   ' }, 'kk')).toBe('Только русский');
    expect(pick({ ru: 'Только русский' }, 'kk')).toBe('Только русский');
    expect(pick({ ru: '', kk: 'Тек қазақша' }, 'ru')).toBe('');
  });
});

describe('shelf counts', () => {
  it.each([
    [1, '1 полка'],
    [2, '2 полки'],
    [4, '4 полки'],
    [5, '5 полок'],
    [11, '11 полок'],
    [12, '12 полок'],
    [21, '21 полка'],
    [22, '22 полки'],
    [25, '25 полок'],
    [111, '111 полок'],
  ])('Russian agreement: %i → %s', (count, label) => {
    expect(shelvesLabel(count, 'ru')).toBe(label);
    expect(shelvesLabel(count)).toBe(label);
  });

  it.each([1, 2, 4, 5, 11, 21, 22, 25])('Kazakh is invariant after a numeral: %i → "%i сөре"', (count) => {
    expect(shelvesLabel(count, 'kk')).toBe(`${count} сөре`);
    expect(shelvesLabel(count, 'kk')).not.toMatch(/сөрелер|полк/);
  });
});

describe('money', () => {
  it('formats a price identically for every locale (KZT / ₸, space-grouped)', () => {
    expect(formatPrice(1234567)).toBe('1 234 567 ₸');
  });
});
