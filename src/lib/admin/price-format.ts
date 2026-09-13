/**
 * Price input rules and display formatting, shared by the server boundary
 * (src/lib/admin/price-input.ts, which turns an accepted string into a
 * Prisma.Decimal) and by the admin browser UI.
 *
 * It deliberately contains NO Prisma import, so the exact same accept/reject
 * contract can run in a Client Component: the /admin/prices dialog must give
 * the same answer as the server for "12,500", "1.234" or "1e5" instead of
 * re-implementing a looser guess of those rules. The server stays
 * authoritative — this only moves the feedback earlier.
 *
 * Money is a decimal **string** everywhere here. Nothing in this file parses a
 * price into a JS number: `Number('0.1') + Number('0.2')` is exactly the class
 * of bug that must never touch an editable catalog price.
 */

/**
 * Shape only: no sign (negatives rejected), no exponent, no `NaN`/`Infinity`
 * spelling, no thousands separator, at most 2 fractional digits. The magnitude
 * is checked separately against the column's range so that an admin who types
 * one zero too many is told the value is out of range, not that it is
 * "malformed".
 */
const PRICE_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/** Decimal(12, 2) holds 12 significant digits, 2 of them after the point. */
export const MAX_PRICE_VALUE = '9999999999.99';

/** Digits the integer part of MAX_PRICE_VALUE has — the range test below. */
const MAX_INTEGER_DIGITS = 10;

/** Guards against pathological input reaching the decimal parser at all. */
const MAX_INPUT_LENGTH = 32;

/** Mirrors `reason` in updatePricesSchema (src/lib/admin/schema.ts). */
export const PRICE_REASON_MAX_LENGTH = 500;

export type PriceInputErrorCode =
  | 'NOT_A_STRING'
  | 'EMPTY'
  | 'MALFORMED'
  | 'TOO_MANY_DECIMALS'
  | 'OUT_OF_RANGE';

export interface PriceStringFailure {
  ok: false;
  code: PriceInputErrorCode;
  message: string;
}

export interface PriceStringSuccess {
  ok: true;
  /** The trimmed, canonical decimal string — never a number. */
  value: string;
}

export type PriceStringResult = PriceStringSuccess | PriceStringFailure;

/**
 * Validates one admin-supplied price as a string. Accepts only a plain decimal
 * with a dot separator ("12000", "12000.5", "12000.50"); a comma separator, a
 * thousands separator, a leading `+`/`-`, `1e5`, `NaN`, `Infinity`, an empty
 * string or a non-string are all rejected rather than normalised — silently
 * turning a mistyped price into a different valid price is worse than refusing
 * it.
 */
export function validatePriceString(raw: unknown): PriceStringResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'NOT_A_STRING', message: 'Цена должна передаваться строкой.' };
  }

  const value = raw.trim();
  if (value === '') {
    return { ok: false, code: 'EMPTY', message: 'Цена не может быть пустой.' };
  }
  if (value.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      code: 'OUT_OF_RANGE',
      message: `Цена должна быть в диапазоне от 0 до ${MAX_PRICE_VALUE}.`,
    };
  }

  // Report the "too many decimals" case separately: it is the one malformed
  // input an admin is most likely to produce by accident, and the generic
  // message would not tell them what is wrong.
  const fractional = value.includes('.') ? value.slice(value.indexOf('.') + 1) : '';
  if (/^\d+\.\d{3,}$/.test(value)) {
    return {
      ok: false,
      code: 'TOO_MANY_DECIMALS',
      message: `Цена не может содержать больше 2 знаков после запятой (получено ${fractional.length}).`,
    };
  }

  if (!PRICE_PATTERN.test(value)) {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'Цена должна быть неотрицательным числом с точкой в качестве разделителя, например «12000.50».',
    };
  }

  // The pattern already guarantees a non-negative number with at most 2
  // decimals, so magnitude is decided entirely by the integer part's digit
  // count — compared as digits, never by converting to a float.
  const integerDigits = value.split('.')[0].replace(/^0+(?=\d)/, '');
  if (integerDigits.length > MAX_INTEGER_DIGITS) {
    return {
      ok: false,
      code: 'OUT_OF_RANGE',
      message: `Цена должна быть в диапазоне от 0 до ${MAX_PRICE_VALUE}.`,
    };
  }

  return { ok: true, value };
}

/** "", "0" and "00" all mean "no tiyn" — every other fraction is significant. */
function isZeroFraction(fraction: string): boolean {
  return fraction === '' || /^0+$/.test(fraction);
}

const THOUSANDS_SEPARATOR = ' ';

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
}

/**
 * Display form of a stored price: "12500.00" → "12 500 ₸", "12500.50" →
 * "12 500.50 ₸". The fractional part is kept verbatim whenever it is not all
 * zeros, so a price with tiyn stays distinguishable from a whole one. Pure string work — the value is never
 * rounded through `Number`, unlike formatPrice() in src/lib/money.ts, which is
 * float-based integer-tenge display math for the customer-facing pricing
 * engine and must not touch an editable catalog price.
 */
export function formatPriceKzt(decimal: string): string {
  const [integer, fraction = ''] = decimal.trim().split('.');
  const grouped = groupDigits(integer.replace(/^0+(?=\d)/, ''));
  // Only a fraction that is entirely zeros is dropped; a real one is shown
  // exactly as stored, so "12 500 ₸" and "12 500.50 ₸" never look alike.
  return isZeroFraction(fraction) ? `${grouped} ₸` : `${grouped}.${fraction} ₸`;
}

/**
 * The value to put in an edit field for a stored price. "12000.00" → "12000"
 * (an admin types whole tenge), "12000.50" → "12000.50" verbatim. Both are accepted by
 * validatePriceString() and both compare decimal-equal to what is stored, so
 * an untouched field is still recognised as "unchanged" by the server.
 */
export function toPriceInputValue(decimal: string): string {
  const [integer, fraction = ''] = decimal.trim().split('.');
  return isZeroFraction(fraction) ? integer : `${integer}.${fraction}`;
}

/**
 * Canonical comparison form of a price string: "12000" and "12000.00" are the
 * same money, and an edit dialog must not report the second as a change just
 * because it is spelled differently. Padding digits, never `Number`.
 */
export function canonicalPriceString(value: string): string {
  const [integer, fraction = ''] = value.trim().split('.');
  const digits = integer.replace(/^0+(?=\d)/, '') || '0';
  return `${digits}.${`${fraction}00`.slice(0, 2)}`;
}
