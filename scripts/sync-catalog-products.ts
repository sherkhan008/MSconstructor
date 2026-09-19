import { PrismaClient } from '@prisma/client';
import { CATALOG_PRODUCTS } from '../src/lib/data/seed-data';

/**
 * Non-destructive synchronization of the storefront catalog listings
 * (CATALOG_PRODUCTS in src/lib/data/seed-data.ts) into an already-seeded
 * PostgreSQL database.
 *
 * Why this exists: prisma/seed.ts never updates existing rows (`update: {}`),
 * which is exactly what keeps a re-seed from overwriting imported supplier
 * prices. The trade-off is that a *changed* catalog listing — a new popular
 * size, or a configuration whose advertised shelf count changed — only
 * reaches a fresh database. This script closes that gap for Product rows
 * alone, which are safe to sync because a Product carries no commercial data
 * at all: no price, no purchase cost, no markup, no supplier. Prices are
 * computed per request from Component rows (src/lib/pricing/engine.ts), which
 * this script never touches.
 *
 * What it does:
 *   - creates any CATALOG_PRODUCTS listing missing from the database;
 *   - updates an existing listing's advertised configuration and copy
 *     (dimensions, shelves, load, name/description/SEO, flags) to match
 *     seed-data, which is the source of truth for catalog listings: no admin
 *     screen or API writes Product rows (only db-repository.ts reads them).
 *
 * Explicitly does NOT:
 *   - touch any Component, Accessory, PricingSettings or PromoCode row, so
 *     imported supplier prices and markups are untouched;
 *   - touch Order / OrderItem or any snapshot — an order keeps the exact
 *     configuration and totals it was placed with, whatever the listing that
 *     inspired it says today;
 *   - delete anything, including a Product row no longer in seed-data.
 *
 * Safe to run multiple times. Usage: `npm run db:sync-catalog-products`
 */

const prisma = new PrismaClient();

async function main() {
  const models = await prisma.productModel.findMany({ select: { id: true, slug: true } });
  const modelIdBySlug = new Map(models.map((m) => [m.slug, m.id]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const product of CATALOG_PRODUCTS) {
    const modelId = modelIdBySlug.get(product.modelSlug);
    if (!modelId) {
      console.info(`[skip] ${product.slug}: no "${product.modelSlug}" ProductModel row in this database.`);
      continue;
    }

    const fields = {
      modelId,
      nameRu: product.name.ru,
      nameKk: product.name.kk,
      descriptionRu: product.description.ru,
      descriptionKk: product.description.kk,
      seoTitle: product.seo.title,
      seoDescription: product.seo.description,
      height: product.height,
      width: product.width,
      depth: product.depth,
      shelves: product.shelves,
      sections: product.sections,
      loadCapacity: product.loadCapacity,
      shelfType: product.shelfType,
      color: product.color,
      useCases: product.useCases,
      inStock: product.inStock,
      popularity: product.popularity,
      featured: product.featured,
      published: product.published,
    };

    const existing = await prisma.product.findUnique({ where: { slug: product.slug } });

    if (!existing) {
      await prisma.product.create({
        data: {
          slug: product.slug,
          ...fields,
          images: { create: product.gallery.map((url, i) => ({ url, alt: product.name.ru, sortOrder: i })) },
        },
      });
      created += 1;
      console.info(`[create] ${product.slug}: ${product.height}×${product.width}×${product.depth}, ${product.shelves} shelves`);
      continue;
    }

    const changed = Object.entries(fields).filter(([key, value]) => {
      const current = (existing as Record<string, unknown>)[key];
      return Array.isArray(value) ? JSON.stringify(current) !== JSON.stringify(value) : current !== value;
    });

    if (changed.length === 0) {
      unchanged += 1;
      continue;
    }

    await prisma.product.update({ where: { slug: product.slug }, data: fields });
    updated += 1;
    console.info(`[update] ${product.slug}: ${changed.map(([key]) => key).join(', ')}`);
  }

  console.info(`Catalog products synced — created ${created}, updated ${updated}, already current ${unchanged}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
