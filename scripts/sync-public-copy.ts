import { PrismaClient } from '@prisma/client';
import { ASSEMBLY_SERVICES, DELIVERY_METHODS, MODELS } from '../src/lib/data/seed-data';

/**
 * Non-destructive synchronization of corrected customer-facing copy into an
 * already-seeded PostgreSQL database.
 *
 * Why this exists: prisma/seed.ts never updates existing rows, so copy that
 * was corrected in src/lib/data/seed-data.ts only reaches a fresh database.
 * The owner confirmed (2026-09-21) that:
 *   - Алматы, Астана, Караганда, Шымкент: delivery the same day;
 *   - other regions of Kazakhstan: 2–3 days;
 *   - non-standard dimensions cannot be ordered.
 * Older seeds stored "next day" delivery and "any sizes" / "non-standard"
 * wording, which db-repository.ts serves to /delivery, the configurator and
 * the model page meta description.
 *
 * A field is replaced ONLY when it still holds the exact outdated seed text,
 * so wording someone has deliberately edited in the database is never
 * overwritten. Touches description/SEO text and the two narrow delivery
 * basePrice corrections below (CITY NULL → 0, TRANSPORT_COMPANY 0 → NULL)
 * only: no product price, markup, supplier, component, order or snapshot data.
 *
 * Safe to run multiple times. Usage: `npm run db:sync-public-copy`
 */

const prisma = new PrismaClient();

/** Every seed text ever shipped for these fields — a database may hold any of them. */
const OUTDATED_DELIVERY: Record<string, { ru: string[]; kk: string[] }> = {
  PICKUP: { ru: ['Бесплатно, склад в г. Алматы'], kk: ['Тегін, Алматы қаласындағы қоймадан'] },
  CITY: {
    ru: [
      'Доставка в пределах Алматы на следующий день',
      'Доставка в черте города склада на следующий день',
      'Доставка по Алматы, Астане, Караганде и Шымкенту — в тот же день.',
    ],
    kk: [
      'Алматы шегінде келесі күні жеткізу',
      'Қойма қаласының шегінде келесі күні жеткізу',
      'Алматы, Астана, Қарағанды және Шымкент қалаларында жеткізу — сол күні.',
    ],
  },
  COUNTRY: {
    ru: ['Транспортной компанией в любой регион', 'Доставка в другие регионы Казахстана — 2–3 дня.'],
    kk: ['Кез келген аймаққа тасымал компаниясымен', 'Қазақстанның басқа өңірлеріне жеткізу — 2–3 күн.'],
  },
  INDIVIDUAL: { ru: ['Для крупных и нестандартных заказов'], kk: ['Ірі және стандартты емес тапсырыстарға'] },
};

/**
 * City delivery (Алматы/Астана/Караганда/Шымкент) is free. Older seeds stored
 * basePrice NULL ("cost confirmed by manager"). Only a NULL price is replaced;
 * any price a person has set in the database is left alone.
 *
 * A zero CITY price is safe only because the order API restricts CITY
 * delivery to those four cities (src/lib/delivery/city-delivery.ts): an
 * order for any other city with a CITY deliveryId is rejected.
 */
const CITY_DELIVERY_FREE_KIND = 'CITY';

/**
 * Regional delivery by transport company is individually calculated, so its
 * basePrice must be NULL ("calculated individually"), not 0 (a real free
 * delivery). Older databases stored 0; the pricing server already overrides
 * it, this only corrects the stored value. Exactly kind = TRANSPORT_COMPANY
 * AND basePrice = 0 is changed, in one conditional statement — any non-zero
 * price a person has set is left alone, and a second run changes nothing.
 */
const TRANSPORT_COMPANY_KIND = 'TRANSPORT_COMPANY';

const OUTDATED_ASSEMBLY: Record<string, { ru: string[]; kk: string[] }> = {
  INDIVIDUAL: { ru: ['Для нестандартных объёмов и сложных объектов'], kk: ['Стандартты емес көлемдер мен күрделі нысандарға'] },
};

const OUTDATED_MODEL_SEO: Record<string, string[]> = {
  'ms-standard': [
    'Металлический стеллаж MS Стандарт: нагрузка до 150 кг на полку, любые размеры, сборка без сварки. Рассчитайте цену в конфигураторе и закажите с доставкой по Казахстану.',
  ],
};

/** Only the fields that still hold one of the exact outdated texts. */
function replacements(current: Record<string, string>, outdated: Record<string, string[]>, next: Record<string, string>) {
  const data: Record<string, string> = {};
  for (const [field, oldTexts] of Object.entries(outdated)) {
    if (oldTexts.includes(current[field]) && current[field] !== next[field]) data[field] = next[field];
  }
  return data;
}

async function main() {
  let updated = 0;

  for (const method of DELIVERY_METHODS) {
    const outdated = OUTDATED_DELIVERY[method.kind];
    if (!outdated) continue;
    const rows = await prisma.deliveryMethod.findMany({ where: { kind: method.kind } });
    for (const row of rows) {
      const data: Record<string, string | number> = replacements(
        { descriptionRu: row.descriptionRu, descriptionKk: row.descriptionKk },
        { descriptionRu: outdated.ru, descriptionKk: outdated.kk },
        { descriptionRu: method.description.ru, descriptionKk: method.description.kk },
      );
      if (method.kind === CITY_DELIVERY_FREE_KIND && row.basePrice === null && method.basePrice === 0) data.basePrice = 0;
      if (Object.keys(data).length === 0) continue;
      await prisma.deliveryMethod.update({ where: { id: row.id }, data });
      updated += 1;
      console.info(`[update] deliveryMethod ${method.kind}: ${Object.keys(data).join(', ')}`);
    }
  }

  if (DELIVERY_METHODS.some((method) => method.kind === TRANSPORT_COMPANY_KIND && method.basePrice === null)) {
    const { count } = await prisma.deliveryMethod.updateMany({
      where: { kind: TRANSPORT_COMPANY_KIND, basePrice: 0 },
      data: { basePrice: null },
    });
    updated += count;
    if (count > 0) console.info(`[update] deliveryMethod ${TRANSPORT_COMPANY_KIND}: basePrice 0 → NULL on ${count} row(s)`);
  }

  for (const service of ASSEMBLY_SERVICES) {
    const outdated = OUTDATED_ASSEMBLY[service.method];
    if (!outdated) continue;
    const rows = await prisma.assemblyService.findMany({ where: { method: service.method } });
    for (const row of rows) {
      const data = replacements(
        { descriptionRu: row.descriptionRu, descriptionKk: row.descriptionKk },
        { descriptionRu: outdated.ru, descriptionKk: outdated.kk },
        { descriptionRu: service.description.ru, descriptionKk: service.description.kk },
      );
      if (Object.keys(data).length === 0) continue;
      await prisma.assemblyService.update({ where: { id: row.id }, data });
      updated += 1;
      console.info(`[update] assemblyService ${service.method}: ${Object.keys(data).join(', ')}`);
    }
  }

  for (const model of MODELS) {
    const outdated = OUTDATED_MODEL_SEO[model.slug];
    if (!outdated) continue;
    const row = await prisma.productModel.findUnique({ where: { slug: model.slug } });
    if (!row) continue;
    const data = replacements({ seoDescription: row.seoDescription }, { seoDescription: outdated }, { seoDescription: model.seo.description });
    if (Object.keys(data).length === 0) continue;
    await prisma.productModel.update({ where: { id: row.id }, data });
    updated += 1;
    console.info(`[update] productModel ${model.slug}: seoDescription`);
  }

  console.info(`Public copy synced — updated ${updated} row(s); all other rows left as they are.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
