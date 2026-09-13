import { PrismaClient } from '@prisma/client';
import { ACCESSORIES, ASSEMBLY_SERVICES, COLORS, DELIVERY_METHODS } from '../src/lib/data/seed-data';

/**
 * One-time development repair for databases seeded BEFORE prisma/seed.ts
 * explicitly preserved canonical public ids (see that file's header
 * comment for the full story). Those databases have ColorOption/
 * AssemblyService/DeliveryMethod/Accessory rows with Prisma-generated cuid
 * ids instead of "color-grey"/"assembly-self"/"delivery-pickup"/
 * "acc-cross-brace" etc — the browser persists (and in one case,
 * src/lib/pricing/compatibility.ts hardcodes) those exact canonical
 * strings, so checkout rejects every configuration with
 * "недоступен" errors.
 *
 * This script renames ONLY the `id` column on those four catalog tables,
 * matched to the correct seed-data row via a reliable natural key —
 * never by display name (localized, editable, not an identity) and never
 * by fuzzy matching. It:
 *   - never touches Order/OrderItem/OrderStatusHistory/Payment/Customer;
 *   - never touches prices (sellingPrice/purchasePrice/unitPrice/value/etc);
 *   - never touches the admin User table;
 *   - updates PriceHistory.entityId alongside an Accessory rename, so an
 *     accessory's price trail keeps pointing at it (that column is a
 *     logical reference, not a foreign key — see prisma/schema.prisma);
 *     nothing else here has an incoming reference at all, confirmed by
 *     reading the schema before writing this script;
 *   - refuses (reports, does not apply) any mapping that isn't an exact,
 *     unambiguous 1:1 match, or whose target id is already taken by a
 *     different row;
 *   - is safe to run twice — a row already at its canonical id is reported
 *     as "already correct" and left untouched.
 *
 * Manual, explicit execution only: `npm run db:repair-canonical-ids`.
 * Never invoked from app startup, from prisma/seed.ts, or from any request
 * path.
 */

const prisma = new PrismaClient();

interface RenamePlanItem {
  table: string;
  matchedBy: string;
  matchValue: string;
  label: string;
  currentId: string;
  targetId: string;
}

interface SkipItem {
  table: string;
  label: string;
  reason: string;
}

const toRename: RenamePlanItem[] = [];
const alreadyCorrect: { table: string; label: string; id: string }[] = [];
const skipped: SkipItem[] = [];

/**
 * Shared planning logic for the three tables with no incoming foreign key
 * (ColorOption, AssemblyService, DeliveryMethod): find every DB row whose
 * natural-key column equals the seed entry's, and only plan a rename when
 * exactly one row matches and the target id isn't already used elsewhere.
 */
async function planSimple(
  table: 'colorOption' | 'assemblyService' | 'deliveryMethod',
  matchedBy: string,
  seedEntries: { id: string; label: string; matchValue: string }[],
) {
  const client = prisma[table] as unknown as {
    findMany: (args: { where: Record<string, string> }) => Promise<{ id: string }[]>;
  };

  for (const entry of seedEntries) {
    const matches = await client.findMany({ where: { [matchedBy]: entry.matchValue } });

    if (matches.length === 0) {
      skipped.push({ table, label: entry.label, reason: `no row found with ${matchedBy} = ${JSON.stringify(entry.matchValue)}` });
      continue;
    }
    if (matches.length > 1) {
      skipped.push({
        table,
        label: entry.label,
        reason: `ambiguous — ${matches.length} rows share ${matchedBy} = ${JSON.stringify(entry.matchValue)}`,
      });
      continue;
    }

    const [row] = matches;
    if (row.id === entry.id) {
      alreadyCorrect.push({ table, label: entry.label, id: entry.id });
      continue;
    }

    const targetTaken = await client.findMany({ where: { id: entry.id } });
    if (targetTaken.length > 0) {
      skipped.push({
        table,
        label: entry.label,
        reason: `target id "${entry.id}" is already used by a different row — refusing to overwrite it`,
      });
      continue;
    }

    toRename.push({ table, matchedBy, matchValue: entry.matchValue, label: entry.label, currentId: row.id, targetId: entry.id });
  }
}

async function planAccessories() {
  for (const a of ACCESSORIES) {
    const row = await prisma.accessory.findUnique({ where: { sku: a.sku } });

    if (!row) {
      skipped.push({ table: 'accessory', label: a.name.ru, reason: `no row found with sku = ${a.sku}` });
      continue;
    }
    if (row.id === a.id) {
      alreadyCorrect.push({ table: 'accessory', label: a.name.ru, id: a.id });
      continue;
    }

    const targetTaken = await prisma.accessory.findUnique({ where: { id: a.id } });
    if (targetTaken) {
      skipped.push({ table: 'accessory', label: a.name.ru, reason: `target id "${a.id}" is already used by a different row — refusing to overwrite it` });
      continue;
    }

    toRename.push({ table: 'accessory', matchedBy: 'sku', matchValue: a.sku, label: a.name.ru, currentId: row.id, targetId: a.id });
  }
}

function printPlan() {
  console.info('=== Canonical catalog ID repair — plan ===\n');

  if (toRename.length === 0) {
    console.info('Nothing to change — every row already has its canonical id.\n');
  } else {
    console.info(`${toRename.length} row(s) will be renamed:`);
    for (const item of toRename) {
      console.info(`  [${item.table}] ${item.label}  (${item.matchedBy}=${item.matchValue})  ${item.currentId}  ->  ${item.targetId}`);
    }
    console.info('');
  }

  if (alreadyCorrect.length > 0) {
    console.info(`${alreadyCorrect.length} row(s) already have their canonical id — no change needed:`);
    for (const item of alreadyCorrect) {
      console.info(`  [${item.table}] ${item.label}  (${item.id})`);
    }
    console.info('');
  }

  if (skipped.length > 0) {
    console.info(`${skipped.length} row(s) SKIPPED (refused to guess):`);
    for (const item of skipped) {
      console.info(`  [${item.table}] ${item.label} — ${item.reason}`);
    }
    console.info('');
  }
}

async function applyRenames() {
  if (toRename.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const item of toRename) {
      if (item.table === 'accessory') {
        // PriceHistory.entityId is a *logical* reference to Accessory.id
        // (no FK — see prisma/schema.prisma). Repoint it as part of the
        // rename anyway, so an accessory's price trail keeps resolving to
        // the row it belongs to.
        await tx.priceHistory.updateMany({ where: { entityId: item.currentId }, data: { entityId: item.targetId } });
        await tx.accessory.update({ where: { id: item.currentId }, data: { id: item.targetId } });
      } else if (item.table === 'colorOption') {
        await tx.colorOption.update({ where: { id: item.currentId }, data: { id: item.targetId } });
      } else if (item.table === 'assemblyService') {
        await tx.assemblyService.update({ where: { id: item.currentId }, data: { id: item.targetId } });
      } else if (item.table === 'deliveryMethod') {
        await tx.deliveryMethod.update({ where: { id: item.currentId }, data: { id: item.targetId } });
      }
    }
  });

  console.info(`Applied ${toRename.length} rename(s) in one transaction.\n`);
}

async function main() {
  await planSimple(
    'colorOption',
    'hex',
    COLORS.map((c) => ({ id: c.id, label: c.name.ru, matchValue: c.hex })),
  );
  await planSimple(
    'assemblyService',
    'method',
    ASSEMBLY_SERVICES.map((s) => ({ id: s.id, label: s.name.ru, matchValue: s.method })),
  );
  await planSimple(
    'deliveryMethod',
    'kind',
    DELIVERY_METHODS.map((d) => ({ id: d.id, label: d.name.ru, matchValue: d.kind })),
  );
  await planAccessories();

  printPlan();
  await applyRenames();

  console.info('Done. Orders, order snapshots, prices, and admin users were not touched.');
  console.info('Run this script again any time — a fully-repaired database reports nothing left to change.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
