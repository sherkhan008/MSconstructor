/**
 * Money handling.
 *
 * All internal money values are integers in tenge (₸). Kazakhstani retail
 * pricing does not use a subunit in practice, and integer arithmetic removes
 * every floating-point rounding class of bug from the pricing engine.
 *
 * Rule: never multiply/divide raw JS floats to derive a price. Always route
 * through these helpers so rounding is applied exactly once, half-up.
 */

export type Tenge = number;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Round half-up to a whole tenge. */
export function roundTenge(value: number): Tenge {
  if (!isFiniteNumber(value)) return 0;
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Multiply a money amount by a unitless factor (e.g. quantity). */
export function multiply(amount: Tenge, factor: number): Tenge {
  return roundTenge(amount * factor);
}

/** Apply a percentage to an amount, e.g. percentOf(10_000, 16) === 1600. */
export function percentOf(amount: Tenge, percent: number): Tenge {
  if (!isFiniteNumber(percent) || percent === 0) return 0;
  return roundTenge((amount * percent) / 100);
}

export function sum(values: readonly Tenge[]): Tenge {
  return values.reduce<Tenge>((acc, value) => acc + roundTenge(value), 0);
}

export function clampMin(value: Tenge, min: Tenge): Tenge {
  return value < min ? min : value;
}

const THOUSANDS_SEPARATOR = ' ';

/** Group digits with a plain space: 1234567 -> "1 234 567". */
export function formatNumber(value: number): string {
  const rounded = roundTenge(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
  return negative ? `−${digits}` : digits;
}

/** Format as a price string, e.g. "1 234 567 ₸". */
export function formatPrice(value: Tenge): string {
  return `${formatNumber(value)} ₸`;
}

/** Format a millimetre dimension, e.g. "2000 мм". */
export function formatMm(value: number): string {
  return `${formatNumber(value)} мм`;
}

/** Format a kilogram value with at most one decimal. */
export function formatKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded)
    ? formatNumber(rounded)
    : rounded.toFixed(1).replace('.', ',');
  return `${text} кг`;
}

/**
 * Split a VAT-inclusive gross amount into net + VAT.
 * gross = net + vat, vat = round(gross * rate / (100 + rate))
 */
export function extractVat(gross: Tenge, ratePercent: number): { net: Tenge; vat: Tenge } {
  if (ratePercent <= 0) return { net: gross, vat: 0 };
  const vat = roundTenge((gross * ratePercent) / (100 + ratePercent));
  return { net: gross - vat, vat };
}

/** Add VAT on top of a net amount. */
export function addVat(net: Tenge, ratePercent: number): { gross: Tenge; vat: Tenge } {
  const vat = percentOf(net, ratePercent);
  return { gross: net + vat, vat };
}
