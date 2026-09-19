import { describe, expect, it } from 'vitest';
import {
  IMPORT_PROFILES,
  MS_STANDARD_IMPORT_PROFILE,
  SUPPLIER_IMPORT_ACTOR_NAME,
  SUPPLIER_PRICE_COLUMNS,
  SupplierPriceFileError,
  expectedRowCount,
  expectedSellingPrice,
  parseSupplierPriceCsv,
  supplierImportSourceLabel,
  supplierRowComponentWhere,
  supplierRowIdentity,
  supplierRowKey,
  validateSupplierPriceFile,
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

  it('accepts a model-agnostic row or one that names the model, like findComponent does', () => {
    const where = supplierRowComponentWhere(row({}));
    expect(where.OR).toEqual([{ models: { isEmpty: true } }, { models: { has: 'ms-standard' } }]);
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

describe('supplier price import — audit trail identity', () => {
  it('names a system import, never a human admin account', () => {
    expect(SUPPLIER_IMPORT_ACTOR_NAME).toContain('система');
    const label = supplierImportSourceLabel(MS_STANDARD_IMPORT_PROFILE, 'private-data/pricing/ms-standard.csv');
    expect(label).toContain('MS Стандарт');
    expect(label).toContain('private-data/pricing/ms-standard.csv');
  });
});
