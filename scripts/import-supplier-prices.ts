import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatPriceDecimal } from '../src/lib/admin/price-input';
import {
  IMPORT_PROFILES,
  SUPPLIER_IMPORT_ACTOR_NAME,
  expectedRowCount,
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
  validateSupplierPriceFile,
  type GenericRestorePlan,
  type ModelImportProfile,
  type ScopedComponentPlan,
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
 * The parsing, validation, coverage, matching and restoration rules live in
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
 *   - MODEL-SCOPED WRITES ONLY. Supplier prices are written to components
 *     scoped to exactly the imported model (`models = [slug]`, deterministic
 *     SKU — see scopedComponentSku), created from the generic row on first
 *     import. A generic row that other models share is never given a
 *     supplier figure, so MS Strong / Archive MS / any future model sharing
 *     the physical part keep their own prices.
 *   - Rows are matched by STABLE STRUCTURAL IDENTITY, never by display name.
 *     Any ambiguity fails the WHOLE import — never a guess, never a partial
 *     write, never a duplicate.
 *   - GENERIC RESTORATION. Imports made before scoping existed wrote into the
 *     generic rows. Each such write is undone from its own PriceHistory row
 *     only when that row is still the latest change and the current value
 *     still equals what the import wrote (see planGenericRestore). Anything
 *     unverifiable is reported and left exactly as it is.
 *   - The apply runs in ONE transaction: scoped prices, generic restorations
 *     and the audit trail are written together or not at all. Every update
 *     is a compare-and-swap on `updatedAt`, so a concurrent admin edit is
 *     never silently overwritten.
 *   - It writes ONLY Component prices (plus creating the scoped rows), the
 *     imported model's markup, and — if and only if it does not already hold
 *     — the VAT-inclusive flag. It never touches Order / OrderItem /
 *     OrderStatusHistory / OrderDocument / Payment / Customer, never reprices
 *     history, never deletes a Component, and never touches another model's
 *     markup.
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
/* Planning against the live catalog                                           */
/* -------------------------------------------------------------------------- */

const COMPONENT_SELECT = {
  id: true,
  sku: true,
  type: true,
  nameRu: true,
  nameKk: true,
  sellingPrice: true,
  purchasePrice: true,
  weightKg: true,
  height: true,
  width: true,
  depth: true,
  loadCapacity: true,
  shelfType: true,
  variant: true,
  models: true,
  colors: true,
  inStock: true,
  leadTimeDays: true,
  supplierRef: true,
  active: true,
  updatedAt: true,
} satisfies Prisma.ComponentSelect;

type CatalogComponent = Prisma.ComponentGetPayload<{ select: typeof COMPONENT_SELECT }>;

interface RowPlan {
  row: SupplierPriceRow;
  sku: string;
  plan: ScopedComponentPlan<CatalogComponent>;
}

async function planRows(rows: SupplierPriceRow[], profile: ModelImportProfile): Promise<RowPlan[]> {
  const plans: RowPlan[] = [];
  for (const row of rows) {
    const sku = scopedComponentSku(profile, row);
    const [scoped, templates, bySku] = await Promise.all([
      prisma.component.findMany({ where: supplierRowComponentWhere(row), select: COMPONENT_SELECT, orderBy: { sku: 'asc' } }),
      prisma.component.findMany({
        where: supplierRowGenericTemplateWhere(row),
        select: COMPONENT_SELECT,
        orderBy: { sku: 'asc' },
      }),
      prisma.component.findUnique({ where: { sku }, select: { id: true } }),
    ]);
    plans.push({ row, sku, plan: planScopedComponent(profile, row, scoped, templates, bySku !== null) });
  }
  return plans;
}

interface RestorePlan {
  component: CatalogComponent;
  selling: GenericRestorePlan;
  purchase: GenericRestorePlan;
}

/** Every GENERIC component an import of this model has ever written a price into. */
async function planRestorations(profile: ModelImportProfile): Promise<RestorePlan[]> {
  const written = await prisma.priceHistory.findMany({
    where: {
      entityType: 'COMPONENT',
      adminName: SUPPLIER_IMPORT_ACTOR_NAME,
      reason: { startsWith: supplierImportReasonPrefix(profile) },
    },
    distinct: ['entityId'],
    select: { entityId: true },
  });
  const components = await prisma.component.findMany({
    where: { id: { in: written.map((w) => w.entityId) }, models: { isEmpty: true } },
    select: COMPONENT_SELECT,
    orderBy: { sku: 'asc' },
  });

  const plans: RestorePlan[] = [];
  for (const component of components) {
    const history = await prisma.priceHistory.findMany({
      where: { entityType: 'COMPONENT', entityId: component.id },
      select: { field: true, oldValue: true, newValue: true, adminName: true, reason: true, createdAt: true },
    });
    plans.push({
      component,
      selling: planGenericRestore(profile, 'SELLING_PRICE', history, component.sellingPrice),
      purchase: planGenericRestore(profile, 'PURCHASE_PRICE', history, component.purchasePrice),
    });
  }
  return plans;
}

/* -------------------------------------------------------------------------- */
/* Review tables                                                               */
/* -------------------------------------------------------------------------- */

const pad = (value: string, width: number) => (value.length >= width ? value : value + ' '.repeat(width - value.length));
const padLeft = (value: string, width: number) =>
  value.length >= width ? value : ' '.repeat(width - value.length) + value;

function printReviewTable(plans: RowPlan[]): void {
  const header = [
    pad('IDENTITY', 20),
    pad('DIMENSIONS', 11),
    pad('SCOPED SKU', 18),
    pad('FROM', 9),
    pad('STOCK', 6),
    padLeft('OLD PURCH', 11),
    padLeft('NEW PURCH', 11),
    padLeft('OLD SELL', 11),
    padLeft('NEW SELL', 11),
    'ACTION',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const { row, sku, plan } of plans) {
    const dims = row.kind === 'UPRIGHT' ? `h ${row.height}` : `${row.width}×${row.depth}`;
    const identity = row.kind === 'UPRIGHT' ? 'UPRIGHT (standard)' : 'SHELF (STANDARD)';
    const existing = plan.action === 'UPDATE' ? plan.component : null;
    const source = plan.action === 'UPDATE' ? plan.component : plan.action === 'CREATE' ? plan.template : null;
    console.log(
      [
        pad(identity, 20),
        pad(dims, 11),
        pad(sku, 18),
        pad(plan.action === 'CREATE' ? plan.template.sku : '—', 9),
        pad(source ? (source.inStock ? 'yes' : 'no') : '—', 6),
        padLeft(existing ? formatPriceDecimal(existing.purchasePrice) : '—', 11),
        padLeft(formatPriceDecimal(row.purchasePrice), 11),
        padLeft(existing ? formatPriceDecimal(existing.sellingPrice) : '—', 11),
        padLeft(formatPriceDecimal(row.sellingPrice), 11),
        plan.action === 'BLOCKED' ? `BLOCKED: ${plan.reason}` : plan.action,
      ].join(' '),
    );
  }
}

function describeRestore(plan: GenericRestorePlan): string {
  return plan.action === 'RESTORE' ? 'RESTORE' : `${plan.action}: ${plan.reason}`;
}

function printRestoreTable(plans: RestorePlan[]): void {
  if (plans.length === 0) {
    console.log('\nGeneric rows written by earlier imports: none.');
    return;
  }
  console.log('\nGeneric (shared) rows written by earlier imports of this model:');
  for (const { component, selling, purchase } of plans) {
    console.log(`  ${pad(component.sku, 9)} selling ${describeRestore(selling)}; purchase ${describeRestore(purchase)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

interface ApplySummary {
  componentsCreated: number;
  componentsUpdated: number;
  genericRestored: number;
  priceHistoryRows: number;
  markupBefore: { percent: string; fixed: string } | null;
  vatChanged: boolean;
}

async function apply(
  plans: RowPlan[],
  restorations: RestorePlan[],
  profile: ModelImportProfile,
  sourceLabel: string,
): Promise<ApplySummary> {
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

    const historyRows: Prisma.PriceHistoryCreateManyInput[] = [];
    const historyBase = (component: { id: string; sku: string; nameRu: string }, reason: string) => ({
      entityType: 'COMPONENT' as const,
      entityId: component.id,
      entitySku: component.sku,
      entityName: component.nameRu,
      adminId: null,
      adminName: SUPPLIER_IMPORT_ACTOR_NAME,
      reason,
    });

    /* --- 2. Model-scoped component prices --------------------------------- */
    let componentsCreated = 0;
    let componentsUpdated = 0;
    const scopedSkus: string[] = [];

    for (const { row, sku, plan } of plans) {
      scopedSkus.push(sku);
      if (plan.action === 'CREATE') {
        // Re-check inside the transaction: the SKU is the unique identity, so
        // a concurrent creator makes this create fail and rolls everything back.
        if (await tx.component.findUnique({ where: { sku }, select: { id: true } })) {
          throw new Error(`Component ${sku} appeared since it was planned — re-run the import.`);
        }
        const { template } = plan;
        const created = await tx.component.create({
          data: {
            sku,
            type: template.type,
            nameRu: template.nameRu,
            nameKk: template.nameKk,
            sellingPrice: row.sellingPrice,
            purchasePrice: row.purchasePrice,
            weightKg: template.weightKg,
            height: template.height,
            width: template.width,
            depth: template.depth,
            loadCapacity: template.loadCapacity,
            shelfType: template.shelfType,
            variant: template.variant,
            models: [profile.slug],
            colors: template.colors,
            inStock: template.inStock,
            leadTimeDays: template.leadTimeDays,
            supplierRef: template.supplierRef,
            active: template.active,
          },
          select: { id: true, sku: true, nameRu: true },
        });
        componentsCreated += 1;
        const base = historyBase(created, sourceLabel);
        historyRows.push({ ...base, field: 'SELLING_PRICE', oldValue: null, newValue: row.sellingPrice });
        historyRows.push({ ...base, field: 'PURCHASE_PRICE', oldValue: null, newValue: row.purchasePrice });
        continue;
      }
      if (plan.action !== 'UPDATE') throw new Error(`Row ${supplierRowIdentity(row)} is blocked — refusing to apply.`);

      const seen = plan.component;
      // Re-read inside the transaction and compare-and-swap on updatedAt, so
      // an admin edit made since the dry run is never silently overwritten.
      const current = await tx.component.findUnique({ where: { id: seen.id }, select: COMPONENT_SELECT });
      if (!current) throw new Error(`Component ${seen.sku} (${seen.id}) disappeared mid-import.`);
      if (current.updatedAt.getTime() !== seen.updatedAt.getTime()) {
        throw new Error(`Component ${current.sku} changed since it was read — re-run the import.`);
      }

      const sellingChanged = !current.sellingPrice.equals(row.sellingPrice);
      const purchaseChanged = !current.purchasePrice.equals(row.purchasePrice);
      if (!sellingChanged && !purchaseChanged) continue;

      const updated = await tx.component.updateMany({
        where: { id: current.id, updatedAt: current.updatedAt },
        data: { sellingPrice: row.sellingPrice, purchasePrice: row.purchasePrice },
      });
      if (updated.count !== 1) throw new Error(`Component ${current.sku} changed concurrently — import rolled back.`);
      componentsUpdated += 1;

      // One PriceHistory row per changed field — the same shape the admin
      // price service writes for a manual edit.
      const base = historyBase(current, sourceLabel);
      if (sellingChanged) {
        historyRows.push({ ...base, field: 'SELLING_PRICE', oldValue: current.sellingPrice, newValue: row.sellingPrice });
      }
      if (purchaseChanged) {
        historyRows.push({
          ...base,
          field: 'PURCHASE_PRICE',
          oldValue: current.purchasePrice,
          newValue: row.purchasePrice,
        });
      }
    }

    /* --- 3. Restore generic rows earlier imports overwrote ----------------- */
    let genericRestored = 0;
    const restoredSkus: string[] = [];
    const restoreReason = genericRestoreReason(profile);

    for (const { component: seen, selling, purchase } of restorations) {
      if (selling.action !== 'RESTORE' && purchase.action !== 'RESTORE') continue;
      const data: Prisma.ComponentUpdateManyMutationInput = {};
      if (selling.action === 'RESTORE') data.sellingPrice = selling.value;
      if (purchase.action === 'RESTORE') data.purchasePrice = purchase.value;

      const updated = await tx.component.updateMany({
        where: { id: seen.id, updatedAt: seen.updatedAt, models: { isEmpty: true } },
        data,
      });
      if (updated.count !== 1) throw new Error(`Component ${seen.sku} changed concurrently — import rolled back.`);
      genericRestored += 1;
      restoredSkus.push(seen.sku);

      const base = historyBase(seen, restoreReason);
      if (selling.action === 'RESTORE') {
        historyRows.push({ ...base, field: 'SELLING_PRICE', oldValue: selling.importedValue, newValue: selling.value });
      }
      if (purchase.action === 'RESTORE') {
        historyRows.push({ ...base, field: 'PURCHASE_PRICE', oldValue: purchase.importedValue, newValue: purchase.value });
      }
    }

    if (historyRows.length > 0) await tx.priceHistory.createMany({ data: historyRows });

    /* --- 4. Model markup --------------------------------------------------- */
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

    /* --- 5. One audit row describing the import as a whole ----------------- */
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
          componentsCreated,
          componentsUpdated,
          genericRestored,
          restoredSkus,
          priceHistoryRows: historyRows.length,
          skus: scopedSkus,
          markupPercent: profile.sellingPriceIncludesModelMarkup ? '0' : null,
          markupFixed: profile.sellingPriceIncludesModelMarkup ? '0' : null,
          pricesIncludeVat: true,
          vatPercent: profile.expectedVatPercent,
        },
      },
    });

    return {
      componentsCreated,
      componentsUpdated,
      genericRestored,
      priceHistoryRows: historyRows.length,
      markupBefore,
      vatChanged,
    };
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
  const plans = await planRows(rows, profile);
  const restorations = await planRestorations(profile);

  console.log(`Model: ${profile.slug} (${profile.label})`);
  console.log(`Rows in file: ${rows.length}; required by the ${profile.slug} matrix: ${expected}\n`);
  printReviewTable(plans);
  printRestoreTable(restorations);

  const ready = plans.filter((p) => p.plan.action !== 'BLOCKED');
  const uprights = ready.filter((p) => p.row.kind === 'UPRIGHT').length;
  const shelves = ready.filter((p) => p.row.kind === 'SHELF_STANDARD').length;
  const creates = ready.filter((p) => p.plan.action === 'CREATE').length;
  console.log(
    `\nScoped rows ready: ${ready.length}/${rows.length}  (uprights ${uprights}, standard shelves ${shelves}; ` +
      `${creates} to create, ${ready.length - creates} existing)`,
  );

  const restorable = restorations.filter((r) => r.selling.action === 'RESTORE' || r.purchase.action === 'RESTORE');
  const restoreBlocked = restorations.flatMap((r) =>
    [r.selling, r.purchase]
      .filter((p) => p.action === 'BLOCKED')
      .map((p) => `${r.component.sku}: ${(p as { reason: string }).reason}`),
  );
  console.log(`Generic rows to restore: ${restorable.length}; restoration blocked: ${restoreBlocked.length}`);
  if (restoreBlocked.length > 0) {
    // Not an import blocker: the unverifiable value is simply left as it is.
    console.warn(`  NOT restored (value preserved, needs a human decision):\n    ${restoreBlocked.join('\n    ')}`);
  }

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
    ...plans
      .filter((p) => p.plan.action === 'BLOCKED')
      .map((p) => `line ${p.row.lineNumber} (${supplierRowIdentity(p.row)}): ${(p.plan as { reason: string }).reason}`),
  ];
  if (ready.length !== expected) {
    blockers.push(`expected ${expected} scoped rows, got ${ready.length}`);
  }

  if (blockers.length > 0) {
    console.error(`\nSTOP — the import was not applied:\n  ${blockers.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  if (!options.apply) {
    console.log(`\nDry run OK: ${ready.length}/${expected} scoped rows, zero database writes.`);
    console.log('Re-run with --apply to write these prices in one transaction.');
    return;
  }

  const summary = await apply(plans, restorations, profile, sourceLabel);
  console.log('\nApplied in one transaction:');
  console.log(`  scoped components created: ${summary.componentsCreated}`);
  console.log(`  scoped components updated: ${summary.componentsUpdated}`);
  console.log(`  generic rows restored:     ${summary.genericRestored}`);
  console.log(`  price-history rows:        ${summary.priceHistoryRows} (actor: ${SUPPLIER_IMPORT_ACTOR_NAME}, adminId NULL)`);
  console.log(
    `  ${profile.slug} markup: ${
      summary.markupBefore
        ? `${summary.markupBefore.percent}% / ${summary.markupBefore.fixed} ₸ → 0% / 0 ₸`
        : 'already 0% / 0 ₸'
    }`,
  );
  console.log(`  pricesIncludeVat:          ${summary.vatChanged ? 'false → true' : 'already true'}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
