import { Prisma } from '@prisma/client';
import {
  MAX_PRICE_VALUE,
  validatePriceString,
  type PriceInputErrorCode,
} from '@/lib/admin/price-format';

/**
 * Admin price input parsing — the server boundary.
 *
 * Prices are authoritative commercial data stored as Decimal(12, 2). They are
 * deliberately NOT routed through src/lib/money.ts: those helpers are
 * float-based integer-tenge arithmetic for *display and pricing math*, and
 * `Number('0.1') + Number('0.2')` is exactly the class of bug that must never
 * touch a value that gets written to the catalog.
 *
 * So the boundary accepts a decimal **string** and converts it straight to a
 * Prisma.Decimal — the value never becomes a JS float on the way in. Anything
 * that is not an exact, in-range decimal is rejected; nothing is rounded,
 * clamped or "helpfully" corrected, because silently turning an admin's
 * mistyped price into a different valid price is worse than refusing it.
 *
 * The accept/reject rules themselves live in src/lib/admin/price-format.ts so
 * that the admin UI can apply the identical contract in the browser without
 * pulling Prisma into the client bundle. This module is the only place that
 * turns an accepted string into a Decimal.
 */

export { MAX_PRICE_VALUE };
export type { PriceInputErrorCode };

export interface PriceInputFailure {
  ok: false;
  code: PriceInputErrorCode;
  message: string;
}

export interface PriceInputSuccess {
  ok: true;
  value: Prisma.Decimal;
}

export type PriceInputResult = PriceInputSuccess | PriceInputFailure;

/**
 * Parses one admin-supplied price. Accepts only a plain decimal string with a
 * dot separator ("12000", "12000.5", "12000.50"); a comma separator, a
 * thousands separator, a leading `+`/`-`, `1e5`, `NaN`, `Infinity`, an empty
 * string or a non-string are all rejected rather than normalised.
 */
export function parsePriceInput(raw: unknown): PriceInputResult {
  const parsed = validatePriceString(raw);
  if (!parsed.ok) return parsed;
  return { ok: true, value: new Prisma.Decimal(parsed.value) };
}

/** Canonical wire/display form of a stored price: always exactly 2 decimals. */
export function formatPriceDecimal(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
