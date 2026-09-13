/**
 * Money for commercial documents.
 *
 * Order amounts are persisted as Decimal(14, 2). A document must print them
 * exactly as stored, so they are carried as integer tiyn (1 ₸ = 100 tiyn) in
 * a bigint — never as a JS float and never re-rounded to whole tenge the way
 * the configurator's display helpers (src/lib/money.ts) do.
 */

export type Tiyn = bigint;

export class DocumentAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentAmountError';
  }
}

/** Anything a persisted money column can arrive as: a Prisma.Decimal (which
 * has toFixed), a plain number in tests, or a numeric string. */
export type DecimalLike = { toFixed(digits: number): string } | number | string;

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function toTiyn(value: DecimalLike): Tiyn {
  const text =
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? value.toFixed(2) : value.toFixed(2);
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new DocumentAmountError(`Некорректная денежная сумма: ${text.slice(0, 32)}`);
  const [, sign, whole, fraction = ''] = match;
  const magnitude = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign === '-' ? -magnitude : magnitude;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "445 392,00" — the Kazakhstan accounting convention: space-grouped
 * thousands, comma decimal separator, always two decimals. */
export function formatAmount(value: Tiyn): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = groupThousands((abs / 100n).toString());
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '−' : ''}${whole},${fraction}`;
}

/** "445 392,00 ₸" */
export function formatAmountWithCurrency(value: Tiyn): string {
  return `${formatAmount(value)} ₸`;
}

/* -------------------------------------------------------------------------- */
/* Amount in words (сумма прописью)                                            */
/* -------------------------------------------------------------------------- */

const UNITS_MASCULINE = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const UNITS_FEMININE = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** [one, few, many] forms, feminine flag. Index 0 is the bare units group. */
const SCALES: { forms: [string, string, string]; feminine: boolean }[] = [
  { forms: ['', '', ''], feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
  { forms: ['триллион', 'триллиона', 'триллионов'], feminine: false },
];

function pluralIndex(n: number): 0 | 1 | 2 {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 2;
  if (mod10 === 1) return 0;
  if (mod10 >= 2 && mod10 <= 4) return 1;
  return 2;
}

function tripletToWords(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens) words.push(TENS[tens]);
    if (units) words.push((feminine ? UNITS_FEMININE : UNITS_MASCULINE)[units]);
  }
  return words;
}

/** Whole non-negative number in Russian words, lower case: 445392 →
 * "четыреста сорок пять тысяч триста девяносто два". */
export function integerToWordsRu(value: bigint): string {
  if (value < 0n) throw new DocumentAmountError('Отрицательная сумма не может быть записана прописью.');
  if (value === 0n) return 'ноль';

  const groups: number[] = [];
  let rest = value;
  while (rest > 0n) {
    groups.push(Number(rest % 1000n));
    rest /= 1000n;
  }
  if (groups.length > SCALES.length) {
    throw new DocumentAmountError('Сумма слишком велика для записи прописью.');
  }

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    if (group === 0) continue;
    const scale = SCALES[i];
    words.push(...tripletToWords(group, scale.feminine));
    if (i > 0) words.push(scale.forms[pluralIndex(group)]);
  }
  return words.join(' ');
}

/** "Четыреста сорок пять тысяч триста девяносто два тенге 00 тиын".
 * "тенге" and "тиын" do not decline in Russian, so no plural forms are
 * needed for the currency itself. */
export function amountInWordsRu(value: Tiyn): string {
  if (value < 0n) throw new DocumentAmountError('Отрицательная сумма не может быть записана прописью.');
  const words = integerToWordsRu(value / 100n);
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} тенге ${fraction} тиын`;
}
