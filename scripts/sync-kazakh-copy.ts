import { PrismaClient } from '@prisma/client';
import { ACCESSORIES, ASSEMBLY_SERVICES, DELIVERY_METHODS, MODELS } from '../src/lib/data/seed-data';

/**
 * Non-destructive synchronization of the owner-reviewed Kazakh catalogue copy
 * (docs/localization/public-strings.csv) into an already-seeded database.
 *
 * prisma/seed.ts never updates existing rows, so Kazakh text corrected in
 * src/lib/data/seed-data.ts only reaches a fresh database. The public Kazakh
 * site reads these *Kk columns (db-repository.ts → LocalizedText).
 *
 * A column is replaced ONLY when it still holds the exact text an earlier
 * seed wrote, so Kazakh copy someone has deliberately edited in the database
 * is never overwritten. Touches *Kk text columns only — no Russian text, no
 * price, id, slug, component, order or snapshot data. Safe to run repeatedly.
 * Published catalog products are covered by `npm run db:sync-catalog-products`.
 *
 * Usage: `npm run db:sync-kazakh-copy`
 */

const prisma = new PrismaClient();

type Outdated = Record<string, string[]>;

/** Exact earlier seed values per delivery kind. */
const OUTDATED_DELIVERY_KK: Record<string, Outdated> = {
  PICKUP: { nameKk: ['Қоймадан өзі алып кету'] },
  CITY: { nameKk: ['Қала бойынша жеткізу'] },
  TRANSPORT_COMPANY: {
    nameKk: ['Тасымал компаниясына беру'],
    descriptionKk: ['Сіз таңдаған тасымал компаниясының терминалына жүктеу'],
  },
};

/** Exact earlier seed values per assembly method. */
const OUTDATED_ASSEMBLY_KK: Record<string, Outdated> = {
  FIXED: { nameKk: ['Өз бетінше жинау'], descriptionKk: ['Сөре нұсқаулықпен бірге бөлшектелген түрде жеткізіледі'] },
  PER_SECTION: { nameKk: ['Кәсіби жинау'], descriptionKk: ['Нысаныңызда бригадамен жинау'] },
  PERCENT: {
    nameKk: ['«Кілт бойынша» жинау және монтаж'],
    descriptionKk: ['Жинау, қабырғаға/еденге бекіту және қаптаманы жинау'],
  },
};

/** Exact earlier seed values per accessory id. */
const OUTDATED_ACCESSORY_KK: Record<string, Outdated> = {
  'acc-cross-brace': { nameKk: ['Қатаңдық айқышы'] },
};

/** Exact earlier seed values per model slug. */
const OUTDATED_MODEL_KK: Record<string, Outdated> = {
  'ms-standard': {
    shortDescriptionKk: ['Қойма, мұрағат және кеңсеге арналған әмбебап сөрелі жүйе'],
    descriptionKk: ['MS Стандарт — бұрандамалы қосылысы бар әмбебап модульді сөрелі жүйе. Қойма, мұрағат, дүкен және кеңсе үшін қолайлы.'],
  },
};

/** Kit components: the earlier fastener name and shelf-name word order ("Сөре Стандартты 1000×400"). */
const OUTDATED_FASTENER_KK = 'Бекіту жинағы (болт+сомын)';
const CURRENT_FASTENER_KK = 'Бекітпе жинағы (бұранда + сомын)';
const OUTDATED_SHELF_KK = /^Сөре (.+) (\d+×\d+)$/;

/** The next Kazakh name of a component, or null when it is not an earlier seed value. */
export function nextComponentNameKk(type: string, nameKk: string): string | null {
  if (nameKk === OUTDATED_FASTENER_KK) return CURRENT_FASTENER_KK;
  const shelf = type === 'SHELF' ? OUTDATED_SHELF_KK.exec(nameKk) : null;
  return shelf ? `${shelf[1]} сөре ${shelf[2]}` : null;
}

/** Only the columns that still hold one of the exact outdated texts. */
function replacements(current: Record<string, unknown>, outdated: Outdated, next: Record<string, string>) {
  const data: Record<string, string> = {};
  for (const [field, oldTexts] of Object.entries(outdated)) {
    const value = current[field];
    if (typeof value === 'string' && oldTexts.includes(value) && value !== next[field]) data[field] = next[field];
  }
  return data;
}

async function main() {
  let updated = 0;
  const log = (what: string, data: Record<string, string>) => {
    updated += 1;
    console.info(`[update] ${what}: ${Object.keys(data).join(', ')}`);
  };

  for (const method of DELIVERY_METHODS) {
    const outdated = OUTDATED_DELIVERY_KK[method.kind];
    if (!outdated) continue;
    for (const row of await prisma.deliveryMethod.findMany({ where: { kind: method.kind } })) {
      const data = replacements(row, outdated, { nameKk: method.name.kk, descriptionKk: method.description.kk });
      if (Object.keys(data).length === 0) continue;
      await prisma.deliveryMethod.update({ where: { id: row.id }, data });
      log(`deliveryMethod ${method.kind}`, data);
    }
  }

  for (const service of ASSEMBLY_SERVICES) {
    const outdated = OUTDATED_ASSEMBLY_KK[service.method];
    if (!outdated) continue;
    for (const row of await prisma.assemblyService.findMany({ where: { method: service.method } })) {
      const data = replacements(row, outdated, { nameKk: service.name.kk, descriptionKk: service.description.kk });
      if (Object.keys(data).length === 0) continue;
      await prisma.assemblyService.update({ where: { id: row.id }, data });
      log(`assemblyService ${service.method}`, data);
    }
  }

  for (const accessory of ACCESSORIES) {
    const outdated = OUTDATED_ACCESSORY_KK[accessory.id];
    if (!outdated) continue;
    const row = await prisma.accessory.findUnique({ where: { id: accessory.id } });
    if (!row) continue;
    const data = replacements(row, outdated, { nameKk: accessory.name.kk });
    if (Object.keys(data).length === 0) continue;
    await prisma.accessory.update({ where: { id: row.id }, data });
    log(`accessory ${accessory.id}`, data);
  }

  for (const model of MODELS) {
    const outdated = OUTDATED_MODEL_KK[model.slug];
    if (!outdated) continue;
    const row = await prisma.productModel.findUnique({ where: { slug: model.slug } });
    if (!row) continue;
    const data = replacements(row, outdated, {
      shortDescriptionKk: model.shortDescription.kk,
      descriptionKk: model.description.kk,
    });
    if (Object.keys(data).length === 0) continue;
    await prisma.productModel.update({ where: { id: row.id }, data });
    log(`productModel ${model.slug}`, data);
  }

  const components = await prisma.component.findMany({
    where: { OR: [{ nameKk: OUTDATED_FASTENER_KK }, { type: 'SHELF', nameKk: { startsWith: 'Сөре ' } }] },
    select: { id: true, type: true, nameKk: true },
  });
  for (const row of components) {
    const next = nextComponentNameKk(row.type, row.nameKk);
    if (!next || next === row.nameKk) continue;
    await prisma.component.update({ where: { id: row.id }, data: { nameKk: next } });
    log(`component ${row.id}`, { nameKk: next });
  }

  console.info(`Kazakh copy synced — updated ${updated} row(s); all other rows left as they are.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
