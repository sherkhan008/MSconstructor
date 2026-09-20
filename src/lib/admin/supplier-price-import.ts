import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatPriceDecimal, parsePriceInput } from '@/lib/admin/price-input';
import { roundTenge } from '@/lib/money';
import {
  MS_STANDARD_HEIGHTS,
  MS_STANDARD_WIDTHS,
  getAllowedDepthsForWidth,
} from '@/lib/pricing/ms-standard-compatibility';

/**
 * Supplier price import — the pure half.
 *
 * Parsing, validation, coverage rules and the database WHERE clause that
 * identifies the component a supplier row prices. No I/O: the executable half
 * (database reads, the review table, the transactional apply) lives in
 * scripts/import-supplier-prices.ts, which is what an operator runs.
 *
 * Nothing here — and nothing in the script, in seed-data.ts or in any test —
 * contains a real supplier price. The approved list itself is a LOCAL PRIVATE
 * file under `private-data/` (gitignored and dockerignored), supplied
 * out-of-band; this repository is public. See docs/supplier-price-import.md.
 *
 * ADMIN-ONLY: everything this module describes concerns purchase prices and
 * must never be reachable from a customer-facing endpoint.
 */

export type SupplierRowKind = 'UPRIGHT' | 'SHELF_STANDARD';

export interface ModelImportProfile {
  slug: string;
  /** Human label used in the price-history / audit trail. */
  label: string;
  /**
   * True when the list's selling column ALREADY contains the agreed uplift,
   * so the pricing engine must add no further model markup on top of it —
   * that would be a second markup on the same sale.
   */
  sellingPriceIncludesModelMarkup: boolean;
  /**
   * The VAT rate the supplier quotes at. The import refuses to run against a
   * different stored rate rather than silently repricing at one.
   */
  expectedVatPercent: number;
  /** SKU prefix of this model's scoped supplier-priced components (see scopedComponentSku). */
  scopedSkuPrefix: string;
  /** Every upright height the list must price, from the authoritative matrix. */
  requiredUprightHeights: number[];
  /** Every ordinary (STANDARD) shelf width×depth the list must price. */
  requiredShelfSizes: { width: number; depth: number }[];
}

/**
 * MS Standard's coverage requirement is DERIVED from the authoritative
 * configuration matrix (src/lib/pricing/ms-standard-compatibility.ts), never
 * restated here: exactly the heights the model offers, and exactly the
 * width×depth pairs it can actually be configured in. A price list missing one
 * of them — or carrying a size the model cannot be built in — is rejected.
 */
export const MS_STANDARD_IMPORT_PROFILE: ModelImportProfile = {
  slug: 'ms-standard',
  label: 'MS Стандарт',
  sellingPriceIncludesModelMarkup: true,
  expectedVatPercent: 16,
  scopedSkuPrefix: 'MSS',
  requiredUprightHeights: [...MS_STANDARD_HEIGHTS],
  requiredShelfSizes: MS_STANDARD_WIDTHS.flatMap((width) =>
    getAllowedDepthsForWidth(width).map((depth) => ({ width, depth })),
  ),
};

export const IMPORT_PROFILES: Record<string, ModelImportProfile> = {
  [MS_STANDARD_IMPORT_PROFILE.slug]: MS_STANDARD_IMPORT_PROFILE,
};

/** How many rows a complete price list for this model must contain. */
export function expectedRowCount(profile: ModelImportProfile): number {
  return profile.requiredUprightHeights.length + profile.requiredShelfSizes.length;
}

/* -------------------------------------------------------------------------- */
/* File format                                                                 */
/* -------------------------------------------------------------------------- */

export const SUPPLIER_PRICE_COLUMNS = [
  'model',
  'kind',
  'height',
  'width',
  'depth',
  'purchasePrice',
  'sellingPrice',
] as const;

/**
 * A price cell. Routed through the admin price boundary
 * (src/lib/admin/price-input.ts) so a file price is validated by exactly the
 * same contract as an admin-typed one and never becomes a JS float on its way
 * into the catalog.
 */
const priceCell = z.string().transform((raw, ctx) => {
  const parsed = parsePriceInput(raw);
  if (!parsed.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${parsed.message} (${JSON.stringify(raw)})` });
    return z.NEVER;
  }
  return parsed.value;
});

/** A dimension cell: a positive whole number of millimetres, or empty. */
const dimensionCell = z
  .string()
  .transform((raw) => raw.trim())
  .transform((raw, ctx) => {
    if (raw === '') return null;
    if (!/^\d+$/.test(raw)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not a whole number of mm: ${JSON.stringify(raw)}` });
      return z.NEVER;
    }
    return Number(raw);
  });

export const supplierPriceRowSchema = z
  .object({
    model: z.string().trim().min(1),
    kind: z.enum(['UPRIGHT', 'SHELF_STANDARD']),
    height: dimensionCell,
    width: dimensionCell,
    depth: dimensionCell,
    purchasePrice: priceCell,
    sellingPrice: priceCell,
  })
  .superRefine((row, ctx) => {
    if (row.kind === 'UPRIGHT') {
      if (row.height === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'UPRIGHT needs a height' });
      if (row.width !== null || row.depth !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'UPRIGHT must not carry a width or depth' });
      }
    } else {
      if (row.width === null || row.depth === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SHELF_STANDARD needs a width and a depth' });
      }
      if (row.height !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SHELF_STANDARD must not carry a height' });
      }
    }
  });

export interface SupplierPriceRow {
  lineNumber: number;
  model: string;
  kind: SupplierRowKind;
  height: number | null;
  width: number | null;
  depth: number | null;
  purchasePrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
}

export class SupplierPriceFileError extends Error {
  readonly problems: string[];

  constructor(message: string, problems: string[] = []) {
    super(problems.length > 0 ? `${message}\n  ${problems.join('\n  ')}` : message);
    this.name = 'SupplierPriceFileError';
    this.problems = problems;
  }
}

/**
 * Minimal, strict CSV reader: comma-separated, no quoting, `#` comments and
 * blank lines ignored, header row required and matched against
 * SUPPLIER_PRICE_COLUMNS exactly. Deliberately not a general CSV parser — an
 * approved price list is a small machine-generated table, and anything that
 * does not look exactly like one must fail loudly rather than be guessed at.
 */
export function parseSupplierPriceCsv(text: string): SupplierPriceRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rows: SupplierPriceRow[] = [];
  const problems: string[] = [];
  let header: string[] | null = null;

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    const cells = line.split(',').map((cell) => cell.trim());

    if (!header) {
      header = cells;
      const mismatch =
        cells.length !== SUPPLIER_PRICE_COLUMNS.length ||
        SUPPLIER_PRICE_COLUMNS.some((column, i) => cells[i] !== column);
      if (mismatch) {
        throw new SupplierPriceFileError(
          `Header mismatch.\n  expected: ${SUPPLIER_PRICE_COLUMNS.join(',')}\n  found:    ${cells.join(',')}`,
        );
      }
      return;
    }

    if (cells.length !== SUPPLIER_PRICE_COLUMNS.length) {
      problems.push(`line ${lineNumber}: expected ${SUPPLIER_PRICE_COLUMNS.length} columns, found ${cells.length}`);
      return;
    }

    const record = Object.fromEntries(SUPPLIER_PRICE_COLUMNS.map((column, i) => [column, cells[i]]));
    const parsed = supplierPriceRowSchema.safeParse(record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`line ${lineNumber}: ${issue.path.join('.') || 'row'}: ${issue.message}`);
      }
      return;
    }

    rows.push({ lineNumber, ...parsed.data });
  });

  if (!header) throw new SupplierPriceFileError('The price file contains no header row.');
  if (problems.length > 0) throw new SupplierPriceFileError('Invalid price file:', problems);
  if (rows.length === 0) throw new SupplierPriceFileError('The price file contains no price rows.');
  return rows;
}

/** Stable identity key of one supplier row — used for duplicate detection. */
export function supplierRowKey(row: SupplierPriceRow): string {
  return row.kind === 'UPRIGHT'
    ? `${row.model}/UPRIGHT/${row.height}`
    : `${row.model}/SHELF_STANDARD/${row.width}x${row.depth}`;
}

/** Short human identity of a supplier row, for the review table and errors. */
export function supplierRowIdentity(row: SupplierPriceRow): string {
  return row.kind === 'UPRIGHT' ? `UPRIGHT h=${row.height}` : `SHELF/STANDARD ${row.width}×${row.depth}`;
}

/* -------------------------------------------------------------------------- */
/* File-level validation                                                       */
/* -------------------------------------------------------------------------- */

export interface ValidateOptions {
  upliftPercent: number;
  checkUplift: boolean;
}

/**
 * Everything that must hold about the file as a whole, independent of the
 * database: one model only, no duplicate rows, exact two-way coverage of the
 * model's configuration matrix, and a selling column that really is the
 * supplier price plus the agreed uplift.
 *
 * Returns the list of problems; empty means the file is acceptable.
 */
export function validateSupplierPriceFile(
  rows: SupplierPriceRow[],
  profile: ModelImportProfile,
  options: ValidateOptions,
): string[] {
  const errors: string[] = [];

  for (const row of rows) {
    if (row.model !== profile.slug) {
      errors.push(
        `line ${row.lineNumber}: model ${JSON.stringify(row.model)} — this file must contain one model only`,
      );
    }
  }

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = supplierRowKey(row);
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push(`line ${row.lineNumber}: duplicate of line ${first} (${supplierRowIdentity(row)})`);
    } else {
      seen.set(key, row.lineNumber);
    }
  }

  // Coverage, checked in BOTH directions so neither a missing row nor an
  // unconfigurable extra row can slip through.
  const uprightHeights = new Set(rows.filter((r) => r.kind === 'UPRIGHT').map((r) => r.height));
  for (const height of profile.requiredUprightHeights) {
    if (!uprightHeights.has(height)) errors.push(`missing UPRIGHT price for height ${height} mm`);
  }
  for (const height of uprightHeights) {
    if (height !== null && !profile.requiredUprightHeights.includes(height)) {
      errors.push(`UPRIGHT height ${height} mm is not a valid ${profile.slug} height`);
    }
  }

  const sizeKey = (width: number | null, depth: number | null) => `${width}x${depth}`;
  const present = new Set(rows.filter((r) => r.kind === 'SHELF_STANDARD').map((r) => sizeKey(r.width, r.depth)));
  const required = new Set(profile.requiredShelfSizes.map((s) => sizeKey(s.width, s.depth)));
  for (const size of required) {
    if (!present.has(size)) errors.push(`missing SHELF_STANDARD price for ${size.replace('x', '×')}`);
  }
  for (const size of present) {
    if (!required.has(size)) {
      errors.push(`SHELF_STANDARD ${size.replace('x', '×')} is not a valid ${profile.slug} shelf size`);
    }
  }

  if (options.checkUplift) {
    for (const row of rows) {
      const expected = expectedSellingPrice(row.purchasePrice, options.upliftPercent);
      if (Number(row.sellingPrice) !== expected) {
        errors.push(
          `line ${row.lineNumber} (${supplierRowIdentity(row)}): selling ${formatPriceDecimal(row.sellingPrice)} ` +
            `is not purchase ${formatPriceDecimal(row.purchasePrice)} +${options.upliftPercent}% ` +
            `rounded to whole ₸ (expected ${expected})`,
        );
      }
    }
  }

  return errors;
}

/**
 * The approved customer price for a supplier price: the agreed uplift, then
 * the project's own half-up rounding to whole tenge (src/lib/money.ts) —
 * MSconstructor stores integer tenge, and a price must be rounded by exactly
 * the same rule everywhere.
 */
export function expectedSellingPrice(purchasePrice: Prisma.Decimal | number, upliftPercent: number): number {
  return roundTenge((Number(purchasePrice) * (100 + upliftPercent)) / 100);
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * MODEL-SCOPED PRICE ROWS
 *
 * A supplier price list prices ONE model. The physical upright/shelf it
 * quotes is often the same generic catalog Component (`models = []`) that
 * other models (MS Strong, Archive MS, …) also resolve to, so writing the
 * supplier figure into that generic row would silently reprice every other
 * model. The import therefore writes ONLY to a component scoped to exactly
 * the imported model (`models = [slug]`), creating it from the generic row
 * on first import. findComponent() (src/lib/data/repository.ts) ranks a
 * model-scoped match above a generic one, so the imported model uses the
 * scoped price and every other model keeps the generic row untouched.
 *
 * The scoped row's SKU is DERIVED from the supplier row's structural identity
 * (see scopedComponentSku), so repeated imports always address the same row
 * and never create a duplicate.
 */

/**
 * The structural fingerprint of the component a supplier row prices — stable
 * identity only, never a display name (names are localized, editable, and not
 * an identity).
 *
 * UPRIGHT: the STANDARD (non-heavy) upright of that height. The heavy variant
 * is distinguished in the catalog by carrying an explicit `loadCapacity`, so
 * "standard" is exactly `loadCapacity IS NULL`. Every other discriminator must
 * also be absent, which is what makes the match unique.
 *
 * SHELF_STANDARD: the ordinary straight shelf of that width×depth.
 * `shelfType = 'STANDARD'` excludes the reinforced / extra-reinforced /
 * perforated / galvanised shelves this price list does not quote.
 */
function supplierRowStructuralWhere(row: SupplierPriceRow): Prisma.ComponentWhereInput {
  const common = { active: true };
  if (row.kind === 'UPRIGHT') {
    return {
      ...common,
      type: 'UPRIGHT',
      height: row.height,
      width: null,
      depth: null,
      loadCapacity: null,
      shelfType: null,
      variant: null,
    };
  }
  return {
    ...common,
    type: 'SHELF',
    shelfType: 'STANDARD',
    width: row.width,
    depth: row.depth,
    height: null,
    loadCapacity: null,
    variant: null,
  };
}

/**
 * The component a supplier row writes to: the structural match that is
 * scoped to EXACTLY the imported model. A generic row, or one shared with
 * any other model (`['ms-standard', 'archive-ms']`), is never an import
 * target — writing there would reprice the other model.
 */
export function supplierRowComponentWhere(row: SupplierPriceRow): Prisma.ComponentWhereInput {
  return { ...supplierRowStructuralWhere(row), models: { equals: [row.model] } };
}

/**
 * The generic (`models = []`) row a scoped component is first created from.
 * It supplies the physical attributes (names, weight, colours, lead time);
 * its prices are never written by the import.
 */
export function supplierRowGenericTemplateWhere(row: SupplierPriceRow): Prisma.ComponentWhereInput {
  return { ...supplierRowStructuralWhere(row), models: { isEmpty: true } };
}

/**
 * Deterministic SKU of the model-scoped component for a supplier row, derived
 * only from its structural identity: `MSS-UPR-H2000`, `MSS-SHF-1000X300`.
 */
export function scopedComponentSku(profile: ModelImportProfile, row: SupplierPriceRow): string {
  return row.kind === 'UPRIGHT'
    ? `${profile.scopedSkuPrefix}-UPR-H${row.height}`
    : `${profile.scopedSkuPrefix}-SHF-${row.width}X${row.depth}`;
}

export type ScopedComponentPlan<C> =
  | { action: 'UPDATE'; component: C }
  | { action: 'CREATE'; template: C; sku: string }
  | { action: 'BLOCKED'; reason: string };

/**
 * Decides, for one supplier row, whether the import updates the existing
 * model-scoped component, creates it from the generic template, or must stop.
 * Anything other than one clean answer blocks the whole import — never a
 * guess, never a duplicate.
 *
 * @param scoped     rows matching supplierRowComponentWhere
 * @param templates  rows matching supplierRowGenericTemplateWhere
 * @param skuTaken   whether ANY component already holds the deterministic SKU
 */
export function planScopedComponent<C extends { sku: string }>(
  profile: ModelImportProfile,
  row: SupplierPriceRow,
  scoped: C[],
  templates: C[],
  skuTaken: boolean,
): ScopedComponentPlan<C> {
  const sku = scopedComponentSku(profile, row);
  if (scoped.length > 1) {
    return { action: 'BLOCKED', reason: `AMBIGUOUS: ${scoped.length} ${row.model}-scoped rows (${scoped.map((c) => c.sku).join(', ')})` };
  }
  if (scoped.length === 1) {
    if (scoped[0].sku !== sku) {
      return { action: 'BLOCKED', reason: `scoped row ${scoped[0].sku} does not carry the deterministic SKU ${sku}` };
    }
    return { action: 'UPDATE', component: scoped[0] };
  }
  if (skuTaken) {
    return { action: 'BLOCKED', reason: `SKU ${sku} already exists but is not the ${row.model}-scoped row for this size` };
  }
  if (templates.length !== 1) {
    return {
      action: 'BLOCKED',
      reason: templates.length === 0 ? 'NO MATCH: no generic component to scope' : `AMBIGUOUS: ${templates.length} generic templates`,
    };
  }
  return { action: 'CREATE', template: templates[0], sku };
}

/* -------------------------------------------------------------------------- */
/* Restoring generic rows overwritten by earlier (pre-scoping) imports          */
/* -------------------------------------------------------------------------- */

/** Prefix of every PriceHistory.reason an import of this model has written. */
export function supplierImportReasonPrefix(profile: ModelImportProfile): string {
  return `Импорт прайс-листа поставщика — ${profile.label} (`;
}

/** PriceHistory.reason recorded when a generic row is given back its value. */
export function genericRestoreReason(profile: ModelImportProfile): string {
  return `Восстановление общей цены: импорт ${profile.label} перенесён на позиции модели`;
}

export interface PriceHistoryEntry {
  field: 'SELLING_PRICE' | 'PURCHASE_PRICE' | null;
  oldValue: Prisma.Decimal | null;
  newValue: Prisma.Decimal;
  adminName: string | null;
  reason: string | null;
  createdAt: Date;
}

export type GenericRestorePlan =
  | { action: 'RESTORE'; value: Prisma.Decimal; importedValue: Prisma.Decimal }
  | { action: 'SKIP'; reason: string }
  | { action: 'BLOCKED'; reason: string };

/**
 * Before scoping existed, imports wrote supplier figures straight into GENERIC
 * rows. For one generic row and one price field, decides whether that write
 * can be undone from VERIFIED evidence — its own PriceHistory row:
 *
 *   - the LATEST history entry for the field must be that import's write
 *     (anything later — an admin edit, or a previous restore — wins, SKIP);
 *   - the current value must still equal what the import wrote (otherwise
 *     something changed it without a trail — BLOCKED, value preserved);
 *   - the import must have recorded the previous value (otherwise there is
 *     nothing verified to restore — BLOCKED, never invented).
 *
 * A restore appends its own history row, so a second run finds that as the
 * latest entry and skips: the restoration is idempotent.
 */
export function planGenericRestore(
  profile: ModelImportProfile,
  field: 'SELLING_PRICE' | 'PURCHASE_PRICE',
  history: PriceHistoryEntry[],
  current: Prisma.Decimal,
): GenericRestorePlan {
  const entries = history
    .filter((h) => h.field === field)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = entries[entries.length - 1];
  const prefix = supplierImportReasonPrefix(profile);
  const isImport = (h: PriceHistoryEntry) =>
    h.adminName === SUPPLIER_IMPORT_ACTOR_NAME && (h.reason ?? '').startsWith(prefix);

  if (!entries.some(isImport)) return { action: 'SKIP', reason: 'never written by this import' };
  if (!isImport(latest)) return { action: 'SKIP', reason: 'changed after the import (restored or edited)' };
  if (!current.equals(latest.newValue)) {
    return { action: 'BLOCKED', reason: 'current value differs from the imported value, with no history of why' };
  }
  if (latest.oldValue === null) {
    return { action: 'BLOCKED', reason: 'the import recorded no previous value to restore' };
  }
  return { action: 'RESTORE', value: latest.oldValue, importedValue: latest.newValue };
}

/**
 * Actor label for the audit trail. `PriceHistory.adminId` stays NULL because
 * an import has no human admin behind it; the schema already allows that (the
 * column is nullable, and `adminName` exists precisely to keep the trail
 * readable without a live User row). Inventing a user account to sign an
 * automated import would put a false human name on a commercial audit trail.
 */
export const SUPPLIER_IMPORT_ACTOR_NAME = 'Импорт прайс-листа (система)';

/** The `reason` recorded on every PriceHistory row of one import run. */
export function supplierImportSourceLabel(profile: ModelImportProfile, filePath: string): string {
  return `${supplierImportReasonPrefix(profile)}${filePath})`;
}
