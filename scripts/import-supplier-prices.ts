import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatPriceDecimal } from '../src/lib/admin/price-input';
import {
  IMPORT_PROFILES,
  SUPPLIER_IMPORT_ACTOR_NAME,
  expectedRowCount,
  parseSupplierPriceCsv,
  supplierImportSourceLabel,
  supplierRowComponentWhere,
  supplierRowIdentity,
  validateSupplierPriceFile,
  type ModelImportProfile,
  type SupplierPriceRow,
} from '../src/lib/admin/supplier-price-import';

/**
 * Supplier price import / sync — the executable half.
 *
 * Reads an approved supplier price list from a LOCAL PRIVATE file and writes
 * the resulting catalog prices into PostgreSQL. Real purchase prices are
 * commercially sensitive and this repository is public, so the file itself
 * lives under `private-data/` (gitignored AND dockerignored) and is supplied
 * out-of-band — nothing in this script, in src/lib/admin/supplier-price-import.ts,
 * in seed-data.ts, or in any test contains a real supplier figure.
 *
 * The parsing, validation, coverage and matching rules live in
 * src/lib/admin/supplier-price-import.ts, where they are unit-tested with
 * invented prices. Everything here is I/O: reading the file, printing the
 * review table and the transactional apply.
 *
 * Usage:
 *   npm run db:import-supplier-prices                # DRY RUN, zero writes
 *   npm run db:import-supplier-prices -- --apply     # transactional apply
 *
 * Options:
 *   --file <path>        input CSV (default: private-data/pricing/ms-standard.csv)
 *   --apply              actually write (otherwise dry run)
 *   --uplift-percent <n> expected selling uplift over the supplier price (default 15)
 *   --no-uplift-check    accept selling prices that do not match that uplift
 *
 * Safety properties, all deliberate:
 *   - DRY RUN BY DEFAULT. `--apply` is the only thing that opens a write.
 *   - Rows are matched by STABLE STRUCTURAL IDENTITY, never by display name.
 *     Zero matches or more than one match fails the WHOLE import — never a
 *     guess, never a partial write.
 *   - The apply runs in ONE transaction: the complete approved set is written
 *     or nothing is. Each component update is a compare-and-swap on
 *     `updatedAt`, so a concurrent admin edit is never silently overwritten.
 *   - It writes ONLY Component.sellingPrice/purchasePrice, the imported
 *     model's markup, and — if and only if it does not already hold — the
 *     VAT-inclusive flag. It never touches Order / OrderItem /
 *     OrderStatusHistory / OrderDocument / Payment / Customer, never reprices
 *     history, never creates or deletes a Component, and never touches
 *     another model's markup.
 *   - Every price change is appended to PriceHistory (field, old value, new
 *     value, source description) plus one AuditLog row for the import as a
 *     whole, recorded as a SYSTEM import — see SUPPLIER_IMPORT_ACTOR_NAME.
 *
 * See docs/supplier-price-import.md, including how to run the same import
 * against production.
 */

const prisma = new PrismaClient();

const DEFAULT_FILE = 'private-data/pricing/ms-standard.csv';

/* -------------------------------------------------------------------------- */
/* Matching against the live catalog                                           */
/* -------------------------------------------------------------------------- */

type MatchStatus = 'MATCH' | 'NO MATCH' | 'AMBIGUOUS';

interface MatchedComponent {
  id: string;
  sku: string;
  nameRu: string;
  inStock: boolean;
  sellingPrice: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  updatedAt: Date;
}

interface Match {
  row: SupplierPriceRow;
  status: MatchStatus;
  component: MatchedComponent | null;
  candidates: string[];
}

const MATCH_SELECT = {
  id: true,
  sku: true,
  nameRu: true,
  inStock: true,
  sellingPrice: true,
  purchasePrice: true,
  updatedAt: true,
} satisfies Prisma.ComponentSelect;

async function resolveMatches(rows: SupplierPriceRow[]): Promise<Match[]> {
  const matches: Match[] = [];
  for (const row of rows) {
    const candidates = await prisma.component.findMany({
      where: supplierRowComponentWhere(row),
      select: MATCH_SELECT,
      orderBy: { sku: 'asc' },
    });

    if (candidates.length === 1) {
      matches.push({ row, status: 'MATCH', component: candidates[0], candidates: [] });
    } else {
      matches.push({
        row,
        status: candidates.length === 0 ? 'NO MATCH' : 'AMBIGUOUS',
        component: null,
        candidates: candidates.map((c) => `${c.sku} (${c.id})`),
      });
    }
  }
  return matches;
}

/* -------------------------------------------------------------------------- */
/* Review table                                                                */
/* -------------------------------------------------------------------------- */

const pad = (value: string, width: number) => (value.length >= width ? value : value + ' '.repeat(width - value.length));
const padLeft = (value: string, width: number) =>
  value.length >= width ? value : ' '.repeat(width - value.length) + value;

function printReviewTable(matches: Match[]): void {
  const header = [
    pad('IDENTITY', 20),
    pad('DIMENSIONS', 11),
    pad('DB ID', 27),
    pad('SKU', 9),
    pad('STOCK', 6),
    padLeft('OLD PURCH', 11),
    padLeft('NEW PURCH', 11),
    padLeft('OLD SELL', 11),
    padLeft('NEW SELL', 11),
    'MATCH',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const m of matches) {
    const dims = m.row.kind === 'UPRIGHT' ? `h ${m.row.height}` : `${m.row.width}×${m.row.depth}`;
    const identity = m.row.kind === 'UPRIGHT' ? 'UPRIGHT (standard)' : 'SHELF (STANDARD)';
    console.log(
      [
        pad(identity, 20),
        pad(dims, 11),
        pad(m.component?.id ?? '—', 27),
        pad(m.component?.sku ?? '—', 9),
        pad(m.component ? (m.component.inStock ? 'yes' : 'no') : '—', 6),
        padLeft(m.component ? formatPriceDecimal(m.component.purchasePrice) : '—', 11),
        padLeft(formatPriceDecimal(m.row.purchasePrice), 11),
        padLeft(m.component ? formatPriceDecimal(m.component.sellingPrice) : '—', 11),
        padLeft(formatPriceDecimal(m.row.sellingPrice), 11),
        m.status,
      ].join(' '),
    );
    if (m.candidates.length > 0) console.log(`    candidates: ${m.candidates.join(', ')}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

interface ApplySummary {
  componentsUpdated: number;
  priceHistoryRows: number;
  markupBefore: { percent: string; fixed: string } | null;
  vatChanged: boolean;
}

async function apply(matches: Match[], profile: ModelImportProfile, sourceLabel: string): Promise<ApplySummary> {
  return prisma.$transaction(async (tx) => {
    /* --- 1. VAT settings: verify, never blindly rewrite ------------------- */
    const settings = await tx.pricingSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) throw new Error('PricingSettings singleton row is missing — refusing to import.');
    if (Number(settings.vatPercent) !== profile.expectedVatPercent) {
      throw new Error(
        `PricingSettings.vatPercent is ${String(settings.vatPercent)}, but this price list is quoted at ` +
          `${profile.expectedVatPercent}%. Refusing to import rather than reprice at a different VAT rate.`,
      );
    }
    const vatChanged = settings.pricesIncludeVat !== true;
    if (vatChanged) {
      // The supplier's figures are VAT-inclusive; storing them while the
      // engine believes prices are net would add VAT a second time.
      await tx.pricingSettings.update({ where: { id: 'singleton' }, data: { pricesIncludeVat: true } });
    }

    /* --- 2. Component prices ---------------------------------------------- */
    const historyRows: Prisma.PriceHistoryCreateManyInput[] = [];
    let componentsUpdated = 0;

    for (const match of matches) {
      const seen = match.component!;
      // Re-read inside the transaction and compare-and-swap on updatedAt, so
      // an admin edit made since the dry run is never silently overwritten.
      const current = await tx.component.findUnique({ where: { id: seen.id }, select: MATCH_SELECT });
      if (!current) throw new Error(`Component ${seen.sku} (${seen.id}) disappeared mid-import.`);
      if (current.updatedAt.getTime() !== seen.updatedAt.getTime()) {
        throw new Error(`Component ${current.sku} changed since it was read — re-run the import.`);
      }

      const sellingChanged = !current.sellingPrice.equals(match.row.sellingPrice);
      const purchaseChanged = !current.purchasePrice.equals(match.row.purchasePrice);
      if (!sellingChanged && !purchaseChanged) continue;

      const updated = await tx.component.updateMany({
        where: { id: current.id, updatedAt: current.updatedAt },
        data: { sellingPrice: match.row.sellingPrice, purchasePrice: match.row.purchasePrice },
      });
      if (updated.count !== 1) throw new Error(`Component ${current.sku} changed concurrently — import rolled back.`);
      componentsUpdated += 1;

      // One PriceHistory row per changed field — the same shape the admin
      // price service writes for a manual edit.
      const base = {
        entityType: 'COMPONENT' as const,
        entityId: current.id,
        entitySku: current.sku,
        entityName: current.nameRu,
        adminId: null,
        adminName: SUPPLIER_IMPORT_ACTOR_NAME,
        reason: sourceLabel,
      };
      if (sellingChanged) {
        historyRows.push({
          ...base,
          field: 'SELLING_PRICE',
          oldValue: current.sellingPrice,
          newValue: match.row.sellingPrice,
        });
      }
      if (purchaseChanged) {
        historyRows.push({
          ...base,
          field: 'PURCHASE_PRICE',
          oldValue: current.purchasePrice,
          newValue: match.row.purchasePrice,
        });
      }
    }

    if (historyRows.length > 0) await tx.priceHistory.createMany({ data: historyRows });

    /* --- 3. Model markup --------------------------------------------------- */
    let markupBefore: ApplySummary['markupBefore'] = null;
    if (profile.sellingPriceIncludesModelMarkup) {
      const model = await tx.productModel.findUnique({ where: { slug: profile.slug } });
      if (!model) throw new Error(`ProductModel ${profile.slug} not found.`);
      if (Number(model.markupPercent) !== 0 || Number(model.markupFixed) !== 0) {
        markupBefore = { percent: String(model.markupPercent), fixed: String(model.markupFixed) };
        await tx.productModel.update({
          where: { id: model.id },
          data: { markupPercent: new Prisma.Decimal(0), markupFixed: new Prisma.Decimal(0) },
        });
      }
    }

    /* --- 4. One audit row describing the import as a whole ----------------- */
    await tx.auditLog.create({
      data: {
        userId: null,
        action: 'CATALOG_PRICE_IMPORTED',
        entityType: 'PRODUCT_MODEL',
        entityId: profile.slug,
        previousData: {
          markupPercent: markupBefore?.percent ?? null,
          markupFixed: markupBefore?.fixed ?? null,
          pricesIncludeVat: settings.pricesIncludeVat,
        },
        newData: {
          source: sourceLabel,
          actor: SUPPLIER_IMPORT_ACTOR_NAME,
          componentsUpdated,
          priceHistoryRows: historyRows.length,
          skus: matches.map((m) => m.component!.sku),
          markupPercent: profile.sellingPriceIncludesModelMarkup ? '0' : null,
          markupFixed: profile.sellingPriceIncludesModelMarkup ? '0' : null,
          pricesIncludeVat: true,
          vatPercent: profile.expectedVatPercent,
        },
      },
    });

    return { componentsUpdated, priceHistoryRows: historyRows.length, markupBefore, vatChanged };
  });
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

interface Options {
  file: string;
  apply: boolean;
  upliftPercent: number;
  checkUplift: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { file: DEFAULT_FILE, apply: false, upliftPercent: 15, checkUplift: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--no-uplift-check') options.checkUplift = false;
    else if (arg === '--file') options.file = argv[++i] ?? '';
    else if (arg === '--uplift-percent') options.upliftPercent = Number(argv[++i]);
    else throw new Error(`Unknown option ${JSON.stringify(arg)}`);
  }
  if (!options.file) throw new Error('--file needs a path');
  if (!Number.isFinite(options.upliftPercent) || options.upliftPercent < 0) {
    throw new Error('--uplift-percent must be a non-negative number');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const filePath = resolve(process.cwd(), options.file);

  console.log(`Supplier price import — ${options.apply ? 'APPLY' : 'DRY RUN (no database writes)'}`);
  console.log(`Input file: ${filePath}`);

  const rows = parseSupplierPriceCsv(readFileSync(filePath, 'utf8'));
  const modelSlug = rows[0].model;
  const profile = IMPORT_PROFILES[modelSlug];
  if (!profile) {
    throw new Error(
      `No approved import profile for model ${JSON.stringify(modelSlug)}. ` +
        `Known: ${Object.keys(IMPORT_PROFILES).join(', ')}.`,
    );
  }

  const sourceLabel = supplierImportSourceLabel(profile, options.file);
  const expected = expectedRowCount(profile);

  const fileErrors = validateSupplierPriceFile(rows, profile, {
    upliftPercent: options.upliftPercent,
    checkUplift: options.checkUplift,
  });
  const matches = await resolveMatches(rows);

  console.log(`Model: ${profile.slug} (${profile.label})`);
  console.log(`Rows in file: ${rows.length}; required by the ${profile.slug} matrix: ${expected}\n`);
  printReviewTable(matches);

  const matched = matches.filter((m) => m.status === 'MATCH');
  const uprights = matched.filter((m) => m.row.kind === 'UPRIGHT').length;
  const shelves = matched.filter((m) => m.row.kind === 'SHELF_STANDARD').length;
  console.log(`\nMatched: ${matched.length}/${rows.length}  (uprights ${uprights}, standard shelves ${shelves})`);

  const settings = await prisma.pricingSettings.findUnique({ where: { id: 'singleton' } });
  const model = await prisma.productModel.findUnique({ where: { slug: profile.slug } });
  const markupTarget = profile.sellingPriceIncludesModelMarkup ? '0' : 'unchanged';
  console.log(`${profile.slug} markupPercent: ${model ? String(model.markupPercent) : '—'} → ${markupTarget}`);
  console.log(`${profile.slug} markupFixed:   ${model ? String(model.markupFixed) : '—'} → ${markupTarget}`);
  console.log(
    `PricingSettings: vatPercent=${settings ? String(settings.vatPercent) : '—'} ` +
      `(required ${profile.expectedVatPercent}), pricesIncludeVat=${settings?.pricesIncludeVat} → true`,
  );

  const blockers = [
    ...fileErrors,
    ...matches
      .filter((m) => m.status !== 'MATCH')
      .map((m) => `line ${m.row.lineNumber} (${supplierRowIdentity(m.row)}): ${m.status}`),
  ];
  if (matched.length !== expected) {
    blockers.push(`expected ${expected} unique matches, got ${matched.length}`);
  }

  if (blockers.length > 0) {
    console.error(`\nSTOP — the import was not applied:\n  ${blockers.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  if (!options.apply) {
    console.log(`\nDry run OK: ${matched.length}/${expected} unique matches, zero database writes.`);
    console.log('Re-run with --apply to write these prices in one transaction.');
    return;
  }

  const summary = await apply(matches, profile, sourceLabel);
  console.log('\nApplied in one transaction:');
  console.log(`  components updated:  ${summary.componentsUpdated}`);
  console.log(`  price-history rows:  ${summary.priceHistoryRows} (actor: ${SUPPLIER_IMPORT_ACTOR_NAME}, adminId NULL)`);
  console.log(
    `  ${profile.slug} markup: ${
      summary.markupBefore
        ? `${summary.markupBefore.percent}% / ${summary.markupBefore.fixed} ₸ → 0% / 0 ₸`
        : 'already 0% / 0 ₸'
    }`,
  );
  console.log(`  pricesIncludeVat:    ${summary.vatChanged ? 'false → true' : 'already true'}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
