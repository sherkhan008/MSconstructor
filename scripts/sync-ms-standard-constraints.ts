import { PrismaClient } from '@prisma/client';
import {
  MS_STANDARD_DEPTHS,
  MS_STANDARD_HEIGHTS,
  MS_STANDARD_MIN_SHELVES,
  MS_STANDARD_ABSOLUTE_MAX_SHELVES,
  MS_STANDARD_WIDTHS,
} from '../src/lib/pricing/ms-standard-compatibility';
import { HEIGHTS } from '../src/lib/data/seed-data';

/**
 * Non-destructive synchronization of the `ms-standard` ProductModel row's
 * configuration-availability metadata (heights/widths/depths/minShelves/
 * maxShelves) against the authoritative matrix in
 * src/lib/pricing/ms-standard-compatibility.ts, plus unpublishing any
 * currently-published Product record whose own dimensions are no longer
 * valid for that matrix.
 *
 * The database is PostgreSQL-authoritative (see src/lib/data/db-repository.ts)
 * — editing src/lib/data/seed-data.ts alone only changes the in-memory
 * development fallback used when DATABASE_URL is unset. This script is what
 * actually reaches an already-seeded, already-running Postgres database.
 *
 * Explicitly does NOT:
 *   - run `prisma migrate reset` or any destructive migration;
 *   - touch Order / OrderItem / OrderStatusHistory / Payment / Customer, or
 *     any historical order/snapshot data — those must keep displaying
 *     exactly what was actually ordered, obsolete dimensions and all;
 *   - touch Component.sellingPrice / purchasePrice, Accessory prices,
 *     markupPercent / markupFixed, VAT settings, or discounts — this is a
 *     configuration-availability fix, not a pricing update;
 *   - delete or deactivate any global HeightOption/WidthOption/DepthOption
 *     row — those stay exactly as they are (other models, e.g. ms-strong,
 *     still reference some of the heights MS Standard itself no longer
 *     offers). The one global-dimension write it does make is additive and
 *     narrow: a height the matrix REQUIRES but the database is missing (or
 *     has deactivated) is created/reactivated, because validateCompatibility
 *     rejects any configuration whose global HeightOption row is absent or
 *     inactive — a matrix height with no active row would be offered by the
 *     UI and then refused by the server;
 *   - create any Component, or write any price. Whether each matrix height
 *     actually has a priceable UPRIGHT behind it is AUDITED and reported,
 *     never fixed by inventing a component or a price.
 *
 * Safe to run multiple times: a row already matching the target values is
 * reported as "already correct" and left untouched — running this against
 * an already-synced database is a no-op that only prints confirmation.
 *
 * Usage: `npm run db:sync-ms-standard-constraints`
 */

const prisma = new PrismaClient();

const TARGET_HEIGHTS = [...MS_STANDARD_HEIGHTS];
const TARGET_WIDTHS = [...MS_STANDARD_WIDTHS];
const TARGET_DEPTHS = [...MS_STANDARD_DEPTHS];
const TARGET_MIN_SHELVES = MS_STANDARD_MIN_SHELVES;
const TARGET_MAX_SHELVES = MS_STANDARD_ABSOLUTE_MAX_SHELVES;

/** Product slugs whose own advertised dimensions are no longer valid under
 * the current matrix — kept as an explicit, reviewed list (never derived
 * automatically) so unpublishing a listing is always a deliberate,
 * legible decision, not a silent side effect of a validity check. */
const OBSOLETE_PUBLISHED_PRODUCT_SLUGS = ['ms-standard-2400x1200x500-row'];

function sameNumberArray(a: number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function syncModelMetadata() {
  const model = await prisma.productModel.findUnique({ where: { slug: 'ms-standard' } });
  if (!model) {
    console.info('[model] No "ms-standard" ProductModel row found in this database — nothing to sync.');
    return;
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (!sameNumberArray(model.heights, TARGET_HEIGHTS)) changes.heights = { from: model.heights, to: TARGET_HEIGHTS };
  if (!sameNumberArray(model.widths, TARGET_WIDTHS)) changes.widths = { from: model.widths, to: TARGET_WIDTHS };
  if (!sameNumberArray(model.depths, TARGET_DEPTHS)) changes.depths = { from: model.depths, to: TARGET_DEPTHS };
  if (model.minShelves !== TARGET_MIN_SHELVES) changes.minShelves = { from: model.minShelves, to: TARGET_MIN_SHELVES };
  if (model.maxShelves !== TARGET_MAX_SHELVES) changes.maxShelves = { from: model.maxShelves, to: TARGET_MAX_SHELVES };

  if (Object.keys(changes).length === 0) {
    console.info('[model] ms-standard ProductModel metadata already matches the current matrix — no change needed.');
    return;
  }

  console.info('[model] ms-standard ProductModel metadata will be updated:');
  for (const [field, { from, to }] of Object.entries(changes)) {
    console.info(`  ${field}: ${JSON.stringify(from)}  ->  ${JSON.stringify(to)}`);
  }

  await prisma.productModel.update({
    where: { slug: 'ms-standard' },
    data: {
      heights: TARGET_HEIGHTS,
      widths: TARGET_WIDTHS,
      depths: TARGET_DEPTHS,
      minShelves: TARGET_MIN_SHELVES,
      maxShelves: TARGET_MAX_SHELVES,
    },
  });
  console.info('[model] Applied.');
}

/**
 * Every height the matrix offers must have an ACTIVE global HeightOption row,
 * or validateCompatibility (src/lib/pricing/compatibility.ts) rejects the
 * configuration even though the matrix considers it valid. prisma/seed.ts
 * only ever creates rows (`update: {}`), so a database seeded before a height
 * joined the matrix never gains it from a re-seed — this is what reaches it.
 *
 * Strictly additive: it creates a missing row and reactivates a deactivated
 * one, and never touches a row for a value outside the matrix (those belong
 * to other models). priceAdjustment comes from the seed catalog's own
 * definition for that dimension — a dimension surcharge, not a component
 * price, and 0 for every current height.
 */
async function ensureMatrixHeightOptions() {
  for (const value of TARGET_HEIGHTS) {
    const existing = await prisma.heightOption.findUnique({ where: { value } });
    if (existing?.active) {
      console.info(`[height] ${value} мм: active HeightOption row present — no change needed.`);
      continue;
    }
    if (existing) {
      await prisma.heightOption.update({ where: { value }, data: { active: true } });
      console.info(`[height] ${value} мм: existing HeightOption row was inactive — reactivated (required by the matrix).`);
      continue;
    }
    const seeded = HEIGHTS.find((h) => h.value === value);
    await prisma.heightOption.create({
      data: {
        value,
        label: seeded?.label ?? `${value} мм`,
        priceAdjustment: seeded?.priceAdjustment ?? 0,
        leadTimeDays: seeded?.leadTimeDays ?? 2,
        sortOrder: seeded?.sortOrder ?? 0,
        active: true,
      },
    });
    console.info(`[height] ${value} мм: HeightOption row was missing — created (required by the matrix).`);
  }
}

/**
 * Report-only readiness audit. A height can be perfectly valid per the matrix
 * and still be unsellable if no UPRIGHT component exists for it — buildBom
 * treats UPRIGHT as critical (src/lib/pricing/bom.ts), so the configuration
 * would look selectable and then fail to price. Deliberately does NOT create
 * the component: that would mean inventing a supplier price, which is a
 * separate, human-reviewed import.
 */
async function auditUprightAvailability(): Promise<number[]> {
  const missing: number[] = [];
  for (const value of TARGET_HEIGHTS) {
    const upright = await prisma.component.findFirst({
      where: {
        type: 'UPRIGHT',
        height: value,
        active: true,
        inStock: true,
        OR: [{ models: { isEmpty: true } }, { models: { has: 'ms-standard' } }],
      },
    });
    if (upright) {
      console.info(`[upright] ${value} мм: component "${upright.sku}" available.`);
    } else {
      missing.push(value);
      console.error(`[upright] ${value} мм: NO active in-stock UPRIGHT component for ms-standard.`);
    }
  }
  return missing;
}

async function unpublishObsoleteProducts() {
  for (const slug of OBSOLETE_PUBLISHED_PRODUCT_SLUGS) {
    const product = await prisma.product.findUnique({ where: { slug } });
    if (!product) {
      console.info(`[product] "${slug}" not found in this database — nothing to unpublish.`);
      continue;
    }
    if (!product.published) {
      console.info(`[product] "${slug}" is already unpublished — no change needed.`);
      continue;
    }
    await prisma.product.update({ where: { slug }, data: { published: false } });
    console.info(`[product] "${slug}" unpublished (dimensions ${product.height}×${product.width}×${product.depth} are no longer valid for MS Standard). The row itself was not deleted.`);
  }
}

async function main() {
  console.info('=== MS Standard configuration-availability sync ===\n');
  await syncModelMetadata();
  console.info('');
  await ensureMatrixHeightOptions();
  console.info('');
  await unpublishObsoleteProducts();
  console.info('');
  const missingUprights = await auditUprightAvailability();

  console.info('\nDone. Orders, order snapshots and prices (selling/purchase/markup/VAT) were not');
  console.info('touched, and no dimension row was deleted or deactivated.');
  console.info('Safe to run again — an already-synced database reports nothing left to change.');

  if (missingUprights.length > 0) {
    console.error(
      `\nBLOCKER: heights ${missingUprights.join(', ')} мм are valid per the matrix but have no UPRIGHT component,`,
    );
    console.error('so they would be selectable in the configurator and then fail to price. Import the');
    console.error('supplier price / component for those heights before offering them. Nothing was invented here.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
