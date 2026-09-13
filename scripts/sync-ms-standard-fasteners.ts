import { PrismaClient } from '@prisma/client';
import { COMPONENTS, CONFIGURATION_RULES } from '../src/lib/data/seed-data';

/**
 * Non-destructive synchronization of the MS Standard fastener rule and the
 * fastener kit's customer-facing name into an already-seeded PostgreSQL
 * database. prisma/seed.ts never updates existing rows (`update: {}`), so
 * editing src/lib/data/seed-data.ts alone only changes the in-memory
 * development fallback.
 *
 * What it does:
 *   - creates (or corrects) ConfigurationRule "rule-fastener-ms-standard",
 *     scoped to the ms-standard ProductModel. It replaces the generic
 *     "rule-fastener" for that model only (src/lib/pricing/bom.ts), which
 *     stays untouched for every other model;
 *   - renames the fastener kit component from "Комплект крепежа (болт+гайка)"
 *     to "Комплект крепежа (болт + гайка)" — only if it still has the old
 *     seed name, so a name an admin has since changed is left alone.
 *
 * Explicitly does NOT:
 *   - touch Order / OrderItem or any bomSnapshot — historical orders keep
 *     exactly the fastener quantity and price they were placed with;
 *   - touch any Component / Accessory price, markup, VAT or discount;
 *   - modify or deactivate the generic "rule-fastener" row.
 *
 * Safe to run multiple times. Usage: `npm run db:sync-ms-standard-fasteners`
 */

const prisma = new PrismaClient();

const RULE_ID = 'rule-fastener-ms-standard';
const OLD_FASTENER_NAME_RU = 'Комплект крепежа (болт+гайка)';

async function syncRule() {
  const target = CONFIGURATION_RULES.find((rule) => rule.id === RULE_ID);
  if (!target) throw new Error(`${RULE_ID} is missing from seed-data.ts`);

  const model = await prisma.productModel.findUnique({ where: { slug: 'ms-standard' } });
  if (!model) {
    console.info('[rule] No "ms-standard" ProductModel row found in this database — nothing to sync.');
    return;
  }

  const data = {
    modelId: model.id,
    componentType: target.componentType,
    name: target.name,
    formula: target.formula,
    condition: target.condition ?? null,
    priority: target.priority,
    active: target.active,
  };

  const existing = await prisma.configurationRule.findUnique({ where: { id: RULE_ID } });
  if (!existing) {
    await prisma.configurationRule.create({ data: { id: RULE_ID, ...data } });
    console.info(`[rule] Created ${RULE_ID}: ${target.formula}`);
    return;
  }

  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((key) => existing[key] !== data[key]);
  if (changed.length === 0) {
    console.info(`[rule] ${RULE_ID} already matches — no change needed.`);
    return;
  }
  for (const key of changed) {
    console.info(`  ${key}: ${JSON.stringify(existing[key])}  ->  ${JSON.stringify(data[key])}`);
  }
  await prisma.configurationRule.update({ where: { id: RULE_ID }, data });
  console.info(`[rule] ${RULE_ID} updated.`);
}

async function syncFastenerName() {
  const seed = COMPONENTS.find((component) => component.id === 'fastener-generic');
  if (!seed) throw new Error('fastener-generic is missing from seed-data.ts');

  const row = await prisma.component.findUnique({ where: { sku: seed.sku } });
  if (!row) {
    console.info(`[component] ${seed.sku} not found in this database — nothing to rename.`);
    return;
  }
  if (row.nameRu === seed.name.ru) {
    console.info(`[component] ${seed.sku} is already named "${seed.name.ru}" — no change needed.`);
    return;
  }
  if (row.nameRu !== OLD_FASTENER_NAME_RU) {
    console.info(`[component] ${seed.sku} has a custom name "${row.nameRu}" — left unchanged.`);
    return;
  }
  await prisma.component.update({ where: { sku: seed.sku }, data: { nameRu: seed.name.ru } });
  console.info(`[component] ${seed.sku} renamed "${OLD_FASTENER_NAME_RU}" -> "${seed.name.ru}".`);
}

async function main() {
  console.info('=== MS Standard fastener sync ===\n');
  await syncRule();
  await syncFastenerName();
  console.info('\nDone. Orders, order snapshots and all prices were not touched.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
