import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_PROFILES,
  MS_STANDARD_IMPORT_PROFILE,
  SUPPLIER_IMPORT_ACTOR_NAME,
  SUPPLIER_PRICE_COLUMNS,
  SupplierPriceFileError,
  expectedRowCount,
  expectedSellingPrice,
  genericRestoreReason,
  parseSupplierPriceCsv,
  planGenericRestore,
  planScopedComponent,
  scopedComponentSku,
  supplierImportReasonPrefix,
  supplierImportSourceLabel,
  supplierRowComponentWhere,
  supplierRowGenericTemplateWhere,
  supplierRowIdentity,
  supplierRowKey,
  validateSupplierPriceFile,
  type PriceHistoryEntry,
  type SupplierPriceRow,
} from '@/lib/admin/supplier-price-import';
import {
  MS_STANDARD_HEIGHTS,
  MS_STANDARD_WIDTHS,
  getAllowedDepthsForWidth,
} from '@/lib/pricing/ms-standard-compatibility';

/**
 * Supplier price import — parsing, validation, coverage and matching rules.
 *
 * EVERY price in this file is INVENTED. Real supplier purchase prices live
 * only in the private, gitignored input file (see
 * docs/supplier-price-import.md) and must never reach this repository, tests
 * included.
 */

const UPLIFT = 15;
const OPTIONS = { upliftPercent: UPLIFT, checkUplift: true };

/** An invented supplier price, derived from the row's own dimensions so each
 * generated row differs — no relation to any real price list. */
function fakePurchase(seed: number): number {
  return 1000 + seed;
}

function upliftOf(purchase: number): number {
  return expectedSellingPrice(purchase, UPLIFT);
}

/** A complete, valid MS Standard price file built from the authoritative
 * configuration matrix, with invented figures. */
function completeCsv(overrides: { extraLines?: string[]; drop?: (line: string) => boolean } = {}): string {
  const lines: string[] = [SUPPLIER_PRICE_COLUMNS.join(',')];
  MS_STANDARD_HEIGHTS.forEach((height, i) => {
    const purchase = fakePurchase(i * 100);
    lines.push(`ms-standard,UPRIGHT,${height},,,${purchase},${upliftOf(purchase)}`);
  });
  let seed = 0;
  for (const width of MS_STANDARD_WIDTHS) {
    for (const depth of getAllowedDepthsForWidth(width)) {
      seed += 1;
      const purchase = fakePurchase(seed * 10);
      lines.push(`ms-standard,SHELF_STANDARD,,${width},${depth},${purchase},${upliftOf(purchase)}`);
    }
  }
  const kept = overrides.drop ? lines.filter((l, i) => i === 0 || !overrides.drop!(l)) : lines;
  return [...kept, ...(overrides.extraLines ?? [])].join('\n');
}

function problems(csv: string): string[] {
  return validateSupplierPriceFile(parseSupplierPriceCsv(csv), MS_STANDARD_IMPORT_PROFILE, OPTIONS);
}

describe('supplier price import — file format', () => {
  it('parses a complete file and ignores comments and blank lines', () => {
    const csv = `# private list, never committed\n\n${completeCsv()}\n`;
    const rows = parseSupplierPriceCsv(csv);
    expect(rows).toHaveLength(expectedRowCount(MS_STANDARD_IMPORT_PROFILE));
    expect(rows.filter((r) => r.kind === 'UPRIGHT')).toHaveLength(MS_STANDARD_HEIGHTS.length);
    expect(rows.filter((r) => r.kind === 'SHELF_STANDARD')).toHaveLength(
      MS_STANDARD_IMPORT_PROFILE.requiredShelfSizes.length,
    );
  });

  it('reports the real line number of a bad row, counting comments and blanks', () => {
    const csv = ['# comment', '', SUPPLIER_PRICE_COLUMNS.join(','), 'ms-standard,UPRIGHT,2000,,,abc,2300'].join('\n');
    expect(() => parseSupplierPriceCsv(csv)).toThrowError(/line 4/);
  });

  it('rejects a header that is not exactly the expected columns', () => {
    const csv = 'model,kind,height,width,depth,sellingPrice,purchasePrice\nms-standard,UPRIGHT,2000,,,1,2';
    expect(() => parseSupplierPriceCsv(csv)).toThrowError(SupplierPriceFileError);
  });

  it('rejects a file with no rows and a file with no header', () => {
    expect(() => parseSupplierPriceCsv(SUPPLIER_PRICE_COLUMNS.join(','))).toThrowError(/no price rows/);
    expect(() => parseSupplierPriceCsv('# only a comment\n')).toThrowError(/no header row/);
  });

  it('rejects a price that is not a plain decimal string — never rounds or "fixes" it', () => {
    for (const bad of ['1 234', '1234,00', '1e3', '-1234', 'NaN', '']) {
      const csv = `${SUPPLIER_PRICE_COLUMNS.join(',')}\nms-standard,UPRIGHT,2000,,,${bad},2300`;
      expect(() => parseSupplierPriceCsv(csv), bad).toThrowError(SupplierPriceFileError);
    }
  });

  it('rejects a row whose dimensions do not match its kind', () => {
    const header = SUPPLIER_PRICE_COLUMNS.join(',');
    expect(() => parseSupplierPriceCsv(`${header}\nms-standard,UPRIGHT,,,,1000,1150`)).toThrowError(/needs a height/);
    expect(() => parseSupplierPriceCsv(`${header}\nms-standard,UPRIGHT,2000,700,300,1000,1150`)).toThrowError(
      /must not carry a width or depth/,
    );
    expect(() => parseSupplierPriceCsv(`${header}\nms-standard,SHELF_STANDARD,,700,,1000,1150`)).toThrowError(
      /needs a width and a depth/,
    );
    expect(() => parseSupplierPriceCsv(`${header}\nms-standard,SHELF_STANDARD,2000,700,300,1000,1150`)).toThrowError(
      /must not carry a height/,
    );
  });

  it('rejects an unknown kind', () => {
    const csv = `${SUPPLIER_PRICE_COLUMNS.join(',')}\nms-standard,SHELF_CORNER,,700,300,1000,1150`;
    expect(() => parseSupplierPriceCsv(csv)).toThrowError(SupplierPriceFileError);
  });
});

describe('supplier price import — rounding', () => {
  it('rounds the uplift half-up to whole tenge, like the rest of the project', () => {
    // 1500 × 1.15 = 1725 exactly; 1510 × 1.15 = 1736.5 → 1737 (half-up).
    expect(expectedSellingPrice(1500, 15)).toBe(1725);
    expect(expectedSellingPrice(1510, 15)).toBe(1737);
    expect(expectedSellingPrice(1000, 0)).toBe(1000);
  });

  it('flags a selling price that is not the purchase price plus the uplift', () => {
    const csv = completeCsv().replace(
      `ms-standard,UPRIGHT,${MS_STANDARD_HEIGHTS[0]},,,${fakePurchase(0)},${upliftOf(fakePurchase(0))}`,
      `ms-standard,UPRIGHT,${MS_STANDARD_HEIGHTS[0]},,,${fakePurchase(0)},${upliftOf(fakePurchase(0)) + 1}`,
    );
    expect(problems(csv).some((p) => p.includes('+15%'))).toBe(true);
  });

  it('accepts any selling price when the uplift check is switched off', () => {
    const csv = completeCsv().replace(
      `,${fakePurchase(0)},${upliftOf(fakePurchase(0))}`,
      `,${fakePurchase(0)},${upliftOf(fakePurchase(0)) + 1}`,
    );
    const rows = parseSupplierPriceCsv(csv);
    expect(validateSupplierPriceFile(rows, MS_STANDARD_IMPORT_PROFILE, { upliftPercent: 15, checkUplift: false })).toEqual(
      [],
    );
  });
});

describe('supplier price import — coverage against the MS Standard matrix', () => {
  it('accepts a file that covers the matrix exactly', () => {
    expect(problems(completeCsv())).toEqual([]);
  });

  it('requires exactly 7 uprights + 19 standard shelves for MS Standard', () => {
    // Derived from the authoritative matrix, and asserted as the concrete
    // count the approved supplier list must have.
    expect(MS_STANDARD_IMPORT_PROFILE.requiredUprightHeights).toHaveLength(7);
    expect(MS_STANDARD_IMPORT_PROFILE.requiredShelfSizes).toHaveLength(19);
    expect(expectedRowCount(MS_STANDARD_IMPORT_PROFILE)).toBe(26);
  });

  it('never requires a shelf size the model cannot be configured in (e.g. 700×700)', () => {
    const sizes = MS_STANDARD_IMPORT_PROFILE.requiredShelfSizes.map((s) => `${s.width}x${s.depth}`);
    expect(sizes).not.toContain('700x700');
    expect(sizes).not.toContain('1200x700');
    expect(sizes).not.toContain('1500x800');
    expect(sizes).toContain('700x800');
    expect(sizes).toContain('1000x700');
  });

  it('rejects a file that is missing one upright height', () => {
    const csv = completeCsv({ drop: (line) => line.startsWith('ms-standard,UPRIGHT,2500,') });
    expect(problems(csv)).toContain('missing UPRIGHT price for height 2500 mm');
  });

  it('rejects a file that is missing one shelf size', () => {
    const csv = completeCsv({ drop: (line) => line.startsWith('ms-standard,SHELF_STANDARD,,1500,600,') });
    expect(problems(csv)).toContain('missing SHELF_STANDARD price for 1500×600');
  });

  it('rejects an upright height the model does not offer (e.g. 2550, not 2500)', () => {
    const csv = completeCsv({ extraLines: ['ms-standard,UPRIGHT,2550,,,1000,1150'] });
    expect(problems(csv).some((p) => p.includes('2550 mm is not a valid ms-standard height'))).toBe(true);
  });

  it('rejects a shelf size the model cannot be configured in', () => {
    const csv = completeCsv({ extraLines: ['ms-standard,SHELF_STANDARD,,700,700,1000,1150'] });
    expect(problems(csv).some((p) => p.includes('700×700 is not a valid ms-standard shelf size'))).toBe(true);
  });

  it('rejects a duplicated row rather than letting the last one win', () => {
    const duplicate = `ms-standard,SHELF_STANDARD,,700,300,${fakePurchase(10)},${upliftOf(fakePurchase(10))}`;
    const csv = completeCsv({ extraLines: [duplicate] });
    expect(problems(csv).some((p) => p.includes('duplicate of line'))).toBe(true);
  });

  it('rejects a file that mixes two models', () => {
    const csv = completeCsv({ extraLines: ['ms-strong,UPRIGHT,2400,,,1000,1150'] });
    expect(problems(csv).some((p) => p.includes('one model only'))).toBe(true);
  });

  it('knows an import profile only for the models with an approved list', () => {
    expect(Object.keys(IMPORT_PROFILES)).toEqual(['ms-standard']);
    expect(IMPORT_PROFILES['ms-strong']).toBeUndefined();
    expect(IMPORT_PROFILES['archive-ms']).toBeUndefined();
  });

  it('records MS Standard as a list whose selling column already carries the uplift', () => {
    expect(MS_STANDARD_IMPORT_PROFILE.sellingPriceIncludesModelMarkup).toBe(true);
    expect(MS_STANDARD_IMPORT_PROFILE.expectedVatPercent).toBe(16);
  });
});

describe('supplier price import — component matching', () => {
  const row = (over: Partial<SupplierPriceRow>): SupplierPriceRow =>
    ({
      lineNumber: 2,
      model: 'ms-standard',
      kind: 'UPRIGHT',
      height: 2000,
      width: null,
      depth: null,
      purchasePrice: 0 as never,
      sellingPrice: 0 as never,
      ...over,
    }) as SupplierPriceRow;

  it('identifies an upright structurally: type + height + the standard (non-heavy) variant', () => {
    const where = supplierRowComponentWhere(row({ kind: 'UPRIGHT', height: 2500 }));
    expect(where).toMatchObject({
      type: 'UPRIGHT',
      height: 2500,
      // The heavy variant is exactly the one carrying an explicit load rating,
      // so "standard" is loadCapacity IS NULL — never a name match.
      loadCapacity: null,
      width: null,
      depth: null,
      shelfType: null,
      variant: null,
      active: true,
    });
  });

  it('identifies an ordinary shelf structurally: type + STANDARD + width × depth', () => {
    const where = supplierRowComponentWhere(
      row({ kind: 'SHELF_STANDARD', height: null, width: 1200, depth: 600 }),
    );
    expect(where).toMatchObject({
      type: 'SHELF',
      shelfType: 'STANDARD',
      width: 1200,
      depth: 600,
      height: null,
      loadCapacity: null,
      variant: null,
      active: true,
    });
  });

  it('writes only to a row scoped to EXACTLY the imported model — never a generic or shared row', () => {
    const where = supplierRowComponentWhere(row({}));
    expect(where.models).toEqual({ equals: ['ms-standard'] });
    expect(where.OR).toBeUndefined();
  });

  it('takes the physical attributes of a new scoped row from the generic row of the same structure', () => {
    const shelf = row({ kind: 'SHELF_STANDARD', height: null, width: 1200, depth: 600 });
    const template = supplierRowGenericTemplateWhere(shelf);
    expect(template.models).toEqual({ isEmpty: true });
    const { models: _scopedModels, ...scopedStructure } = supplierRowComponentWhere(shelf);
    const { models: _genericModels, ...templateStructure } = template;
    expect(templateStructure).toEqual(scopedStructure);
  });

  it('never matches on a display name', () => {
    const where = supplierRowComponentWhere(row({}));
    expect(JSON.stringify(where)).not.toMatch(/name/i);
  });

  it('gives each row a stable identity key and a readable label', () => {
    expect(supplierRowKey(row({ kind: 'UPRIGHT', height: 1800 }))).toBe('ms-standard/UPRIGHT/1800');
    expect(supplierRowKey(row({ kind: 'SHELF_STANDARD', height: null, width: 700, depth: 300 }))).toBe(
      'ms-standard/SHELF_STANDARD/700x300',
    );
    expect(supplierRowIdentity(row({ kind: 'UPRIGHT', height: 1800 }))).toBe('UPRIGHT h=1800');
  });
});

describe('supplier price import — model-scoped rows', () => {
  const rows = parseSupplierPriceCsv(completeCsv());
  const upright = rows.find((r) => r.kind === 'UPRIGHT' && r.height === 2000)!;
  const shelf = rows.find((r) => r.kind === 'SHELF_STANDARD' && r.width === 1000 && r.depth === 300)!;
  const P = MS_STANDARD_IMPORT_PROFILE;

  it('derives a deterministic SKU from structural identity only', () => {
    expect(scopedComponentSku(P, upright)).toBe('MSS-UPR-H2000');
    expect(scopedComponentSku(P, shelf)).toBe('MSS-SHF-1000X300');
    expect(scopedComponentSku(P, { ...shelf, purchasePrice: 0 as never, lineNumber: 99 })).toBe('MSS-SHF-1000X300');
  });

  it('gives each of the 26 approved rows its own SKU (7 uprights + 19 shelves)', () => {
    const skus = rows.map((r) => scopedComponentSku(P, r));
    expect(skus).toHaveLength(26);
    expect(new Set(skus).size).toBe(26);
    expect(skus.filter((s) => s.startsWith('MSS-UPR-'))).toHaveLength(7);
    expect(skus.filter((s) => s.startsWith('MSS-SHF-'))).toHaveLength(19);
  });

  const generic = { sku: 'SHF-0033' };
  const own = { sku: 'MSS-SHF-1000X300' };

  it('first import: creates the scoped row from the single generic template', () => {
    expect(planScopedComponent(P, shelf, [], [generic], false)).toEqual({
      action: 'CREATE',
      template: generic,
      sku: 'MSS-SHF-1000X300',
    });
  });

  it('repeated import: updates the same scoped row instead of creating a duplicate', () => {
    expect(planScopedComponent(P, shelf, [own], [generic], true)).toEqual({ action: 'UPDATE', component: own });
  });

  it('blocks rather than guesses', () => {
    const blocked = (plan: { action: string }) => expect(plan.action).toBe('BLOCKED');
    blocked(planScopedComponent(P, shelf, [own, { sku: 'MSS-OTHER' }], [generic], true)); // two scoped rows
    blocked(planScopedComponent(P, shelf, [{ sku: 'HAND-MADE-1' }], [generic], false)); // non-deterministic SKU
    blocked(planScopedComponent(P, shelf, [], [generic], true)); // SKU held by an unrelated/inactive row
    blocked(planScopedComponent(P, shelf, [], [], false)); // nothing to scope
    blocked(planScopedComponent(P, shelf, [], [generic, { sku: 'SHF-9999' }], false)); // ambiguous template
  });
});

describe('supplier price import — restoring generic rows', () => {
  const P = MS_STANDARD_IMPORT_PROFILE;
  const D = (value: number) => new Prisma.Decimal(value);
  const importReason = supplierImportSourceLabel(P, 'private-data/pricing/ms-standard.csv');
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

  const importWrite: PriceHistoryEntry = {
    field: 'SELLING_PRICE',
    oldValue: D(5000),
    newValue: D(1234),
    adminName: SUPPLIER_IMPORT_ACTOR_NAME,
    reason: importReason,
    createdAt: at(10),
  };

  it('restores the verified pre-import value when the import is the latest change', () => {
    expect(planGenericRestore(P, 'SELLING_PRICE', [importWrite], D(1234))).toEqual({
      action: 'RESTORE',
      value: D(5000),
      importedValue: D(1234),
    });
  });

  it('only looks at the requested field', () => {
    expect(planGenericRestore(P, 'PURCHASE_PRICE', [importWrite], D(1234)).action).toBe('SKIP');
  });

  it('is idempotent: once a restore is recorded, a second run skips', () => {
    const restore: PriceHistoryEntry = {
      ...importWrite,
      oldValue: D(1234),
      newValue: D(5000),
      reason: genericRestoreReason(P),
      createdAt: at(20),
    };
    expect(planGenericRestore(P, 'SELLING_PRICE', [importWrite, restore], D(5000)).action).toBe('SKIP');
  });

  it('never overrides an admin edit made after the import', () => {
    const edit: PriceHistoryEntry = { ...importWrite, oldValue: D(1234), newValue: D(4000), adminName: 'Admin', reason: null, createdAt: at(30) };
    expect(planGenericRestore(P, 'SELLING_PRICE', [edit, importWrite], D(4000)).action).toBe('SKIP');
  });

  it('refuses to restore when the current value is unexplained or the old value is unknown', () => {
    expect(planGenericRestore(P, 'SELLING_PRICE', [importWrite], D(999)).action).toBe('BLOCKED');
    expect(planGenericRestore(P, 'SELLING_PRICE', [{ ...importWrite, oldValue: null }], D(1234)).action).toBe('BLOCKED');
  });

  it('ignores rows another model\'s import or a human wrote', () => {
    const human = { ...importWrite, adminName: 'Admin' };
    expect(planGenericRestore(P, 'SELLING_PRICE', [human], D(1234)).action).toBe('SKIP');
    expect(genericRestoreReason(P).startsWith(supplierImportReasonPrefix(P))).toBe(false);
  });
});

describe('supplier price import — audit trail identity', () => {
  it('names a system import, never a human admin account', () => {
    expect(SUPPLIER_IMPORT_ACTOR_NAME).toContain('система');
    const label = supplierImportSourceLabel(MS_STANDARD_IMPORT_PROFILE, 'private-data/pricing/ms-standard.csv');
    expect(label).toContain('MS Стандарт');
    expect(label).toContain('private-data/pricing/ms-standard.csv');
  });
});
