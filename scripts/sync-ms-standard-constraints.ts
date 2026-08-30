import { PrismaClient } from '@prisma/client';
import {
  MS_STANDARD_DEPTHS,
  MS_STANDARD_HEIGHTS,
  MS_STANDARD_MIN_SHELVES,
  MS_STANDARD_ABSOLUTE_MAX_SHELVES,
  MS_STANDARD_WIDTHS,
} from '../src/lib/pricing/ms-standard-compatibility';

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
 *   - delete any global HeightOption/WidthOption/DepthOption row — those
 *     stay exactly as they are (other models, e.g. ms-strong, still
 *     reference some of the heights MS Standard itself no longer offers).
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
  await unpublishObsoleteProducts();
  console.info('\nDone. Orders, order snapshots, prices (selling/purchase/markup/VAT), and global');
  console.info('HeightOption/WidthOption/DepthOption rows were not touched.');
  console.info('Safe to run again — an already-synced database reports nothing left to change.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
