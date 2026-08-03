import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';
import {
  ACCESSORIES,
  ASSEMBLY_SERVICES,
  COLORS,
  COMPONENTS,
  CONFIGURATION_RULES,
  DELIVERY_METHODS,
  DEPTHS,
  HEIGHTS,
  LOAD_CAPACITIES,
  MODELS,
  PRICING_SETTINGS,
  PROMO_CODES,
  WIDTHS,
  CATALOG_PRODUCTS,
} from '../src/lib/data/seed-data';

const prisma = new PrismaClient();

/**
 * Populates a fresh PostgreSQL database with the same sample catalog the
 * in-memory development repository serves (src/lib/data/seed-data.ts), so
 * switching DATABASE_URL on never changes what the storefront shows.
 *
 * All prices here are placeholder development data — see the header comment
 * in seed-data.ts before pointing this at a production database.
 */

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@ms-stellazh.kz';
  const password = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Администратор',
      passwordHash: hashPassword(password),
      role: 'SUPER_ADMIN',
    },
  });
  console.info(`Seeded admin user: ${email}`);
}

async function seedModels() {
  const idBySlug = new Map<string, string>();
  for (const model of MODELS) {
    const row = await prisma.productModel.upsert({
      where: { slug: model.slug },
      update: {},
      create: {
        slug: model.slug,
        nameRu: model.name.ru,
        nameKk: model.name.kk,
        shortDescriptionRu: model.shortDescription.ru,
        shortDescriptionKk: model.shortDescription.kk,
        descriptionRu: model.description.ru,
        descriptionKk: model.description.kk,
        image: model.image,
        gallery: model.gallery,
        maxLoadKg: model.maxLoadKg,
        loadCapacities: model.loadCapacities,
        heights: model.heights,
        widths: model.widths,
        depths: model.depths,
        shelfTypes: model.shelfTypes,
        minShelves: model.minShelves,
        maxShelves: model.maxShelves,
        useCases: model.useCases,
        markupPercent: model.markupPercent,
        markupFixed: model.markupFixed,
        sortOrder: model.sortOrder,
        active: model.active,
        featured: model.featured,
        seoTitle: model.seo.title,
        seoDescription: model.seo.description,
      },
    });
    idBySlug.set(model.slug, row.id);
  }
  return idBySlug;
}

async function seedDimensions() {
  for (const h of HEIGHTS) {
    await prisma.heightOption.upsert({
      where: { value: h.value },
      update: {},
      create: {
        value: h.value,
        label: h.label,
        priceAdjustment: h.priceAdjustment,
        leadTimeDays: h.leadTimeDays,
        sortOrder: h.sortOrder,
        active: h.active,
      },
    });
  }
  for (const w of WIDTHS) {
    await prisma.widthOption.upsert({
      where: { value: w.value },
      update: {},
      create: {
        value: w.value,
        label: w.label,
        priceAdjustment: w.priceAdjustment,
        leadTimeDays: w.leadTimeDays,
        sortOrder: w.sortOrder,
        active: w.active,
      },
    });
  }
  for (const d of DEPTHS) {
    await prisma.depthOption.upsert({
      where: { value: d.value },
      update: {},
      create: {
        value: d.value,
        label: d.label,
        priceAdjustment: d.priceAdjustment,
        leadTimeDays: d.leadTimeDays,
        sortOrder: d.sortOrder,
        active: d.active,
      },
    });
  }
  for (const l of LOAD_CAPACITIES) {
    await prisma.loadCapacityOption.upsert({
      where: { value: l.value },
      update: {},
      create: {
        value: l.value,
        label: l.label,
        models: l.models,
        maxWidth: l.maxWidth,
        maxDepth: l.maxDepth,
        sortOrder: l.sortOrder,
        active: l.active,
        noteRu: l.note?.ru,
        noteKk: l.note?.kk,
      },
    });
  }
}

async function seedComponents() {
  for (const c of COMPONENTS) {
    await prisma.component.upsert({
      where: { sku: c.sku },
      update: {},
      create: {
        sku: c.sku,
        type: c.type,
        nameRu: c.name.ru,
        nameKk: c.name.kk,
        sellingPrice: c.sellingPrice,
        purchasePrice: c.purchasePrice,
        weightKg: c.weightKg,
        height: c.height,
        width: c.width,
        depth: c.depth,
        loadCapacity: c.loadCapacity,
        shelfType: c.shelfType,
        variant: c.variant,
        models: c.models,
        colors: c.colors,
        inStock: c.inStock,
        leadTimeDays: c.leadTimeDays,
        supplierRef: c.supplierRef,
        active: c.active,
      },
    });
  }
}

async function seedRules(modelIdBySlug: Map<string, string>) {
  for (const rule of CONFIGURATION_RULES) {
    const modelId = rule.models.length === 1 ? modelIdBySlug.get(rule.models[0]) : undefined;
    await prisma.configurationRule.upsert({
      where: { id: rule.id },
      update: {},
      create: {
        id: rule.id,
        modelId,
        componentType: rule.componentType,
        name: rule.name,
        formula: rule.formula,
        condition: rule.condition,
        priority: rule.priority,
        active: rule.active,
      },
    });
  }
}

async function seedAccessories() {
  for (const a of ACCESSORIES) {
    await prisma.accessory.upsert({
      where: { sku: a.sku },
      update: {},
      create: {
        sku: a.sku,
        slug: a.slug,
        nameRu: a.name.ru,
        nameKk: a.name.kk,
        descriptionRu: a.description.ru,
        descriptionKk: a.description.kk,
        image: a.image,
        unitPrice: a.unitPrice,
        purchasePrice: a.purchasePrice,
        weightKg: a.weightKg,
        models: a.models,
        maxQuantityPerSection: a.maxQuantityPerSection,
        inStock: a.inStock,
        sortOrder: a.sortOrder,
        active: a.active,
      },
    });
  }
}

async function seedColors() {
  for (const c of COLORS) {
    const existing = await prisma.colorOption.findFirst({ where: { hex: c.hex } });
    if (existing) continue;
    await prisma.colorOption.create({
      data: {
        nameRu: c.name.ru,
        nameKk: c.name.kk,
        hex: c.hex,
        pricePercent: c.pricePercent,
        leadTimeDays: c.leadTimeDays,
        available: c.available,
        sortOrder: c.sortOrder,
      },
    });
  }
}

async function seedAssemblyAndDelivery() {
  for (const s of ASSEMBLY_SERVICES) {
    const existing = await prisma.assemblyService.findFirst({ where: { nameRu: s.name.ru } });
    if (existing) continue;
    await prisma.assemblyService.create({
      data: {
        nameRu: s.name.ru,
        nameKk: s.name.kk,
        descriptionRu: s.description.ru,
        descriptionKk: s.description.kk,
        method: s.method,
        value: s.value,
        sortOrder: s.sortOrder,
        active: s.active,
      },
    });
  }
  for (const d of DELIVERY_METHODS) {
    const existing = await prisma.deliveryMethod.findFirst({ where: { kind: d.kind } });
    if (existing) continue;
    await prisma.deliveryMethod.create({
      data: {
        kind: d.kind,
        nameRu: d.name.ru,
        nameKk: d.name.kk,
        descriptionRu: d.description.ru,
        descriptionKk: d.description.kk,
        basePrice: d.basePrice,
        requiresAddress: d.requiresAddress,
        sortOrder: d.sortOrder,
        active: d.active,
      },
    });
  }
}

async function seedPricingSettings() {
  await prisma.pricingSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      vatPercent: PRICING_SETTINGS.vatPercent,
      pricesIncludeVat: PRICING_SETTINGS.pricesIncludeVat,
      minMarginPercent: PRICING_SETTINGS.minMarginPercent,
      defaultMarkupPercent: PRICING_SETTINGS.defaultMarkupPercent,
      currency: PRICING_SETTINGS.currency,
      priceLevelDiscounts: PRICING_SETTINGS.priceLevelDiscounts,
      quantityBreaks: PRICING_SETTINGS.quantityBreaks,
    },
  });
  for (const p of PROMO_CODES) {
    await prisma.promoCode.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        discountPercent: p.discountPercent,
        discountFixed: p.discountFixed,
        minTotal: p.minTotal,
        active: p.active,
        validUntil: p.validUntil ? new Date(p.validUntil) : undefined,
      },
    });
  }
}

async function seedCatalogProducts(modelIdBySlug: Map<string, string>) {
  for (const p of CATALOG_PRODUCTS) {
    const modelId = modelIdBySlug.get(p.modelSlug);
    if (!modelId) continue;
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        slug: p.slug,
        modelId,
        nameRu: p.name.ru,
        nameKk: p.name.kk,
        descriptionRu: p.description.ru,
        descriptionKk: p.description.kk,
        seoTitle: p.seo.title,
        seoDescription: p.seo.description,
        height: p.height,
        width: p.width,
        depth: p.depth,
        shelves: p.shelves,
        sections: p.sections,
        loadCapacity: p.loadCapacity,
        shelfType: p.shelfType,
        color: p.color,
        useCases: p.useCases,
        inStock: p.inStock,
        popularity: p.popularity,
        featured: p.featured,
        published: p.published,
        images: { create: p.gallery.map((url, i) => ({ url, alt: p.name.ru, sortOrder: i })) },
      },
    });
  }
}

async function main() {
  console.info('Seeding MS Shelving database with sample development data...');
  await seedAdmin();
  const modelIdBySlug = await seedModels();
  await seedDimensions();
  await seedComponents();
  await seedRules(modelIdBySlug);
  await seedAccessories();
  await seedColors();
  await seedAssemblyAndDelivery();
  await seedPricingSettings();
  await seedCatalogProducts(modelIdBySlug);
  console.info('Seed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
