/**
 * Temporary public-launch allowlist.
 *
 * Only slugs listed here are shown on public surfaces (homepage, catalog,
 * model detail pages, sitemap). A model NOT listed here still exists fully
 * in the catalog data, pricing engine, BOM, and admin tooling — it is only
 * excluded from public rendering. To make a model public again, add its
 * slug here; nothing else needs to change.
 *
 * This is intentionally separate from ProductModel.active (see
 * src/lib/data/repository.ts findModel/stripModelSecrets), which gates
 * pricing/BOM eligibility. Reusing `active` for launch visibility would
 * also break price calculation, compatibility checks, and existing
 * orders/snapshots for the hidden models.
 */
export const PUBLIC_MODEL_SLUGS: readonly string[] = ['ms-standard'];

/** Customer-selectable accessories at this launch. This is deliberately
 * narrower than the active catalog: the remainder stays available to admin
 * workflows until it has an approved public launch decision. */
export const PUBLIC_ACCESSORY_IDS: readonly string[] = [
  'acc-adjustable-feet',
  'acc-shelf-reinforcement',
  'acc-cross-brace',
];

export function isModelSlugPubliclyVisible(slug: string): boolean {
  return PUBLIC_MODEL_SLUGS.includes(slug);
}

export function isAccessoryIdPubliclyVisible(accessoryId: string): boolean {
  return PUBLIC_ACCESSORY_IDS.includes(accessoryId);
}

export function filterPubliclyVisibleModels<T extends { slug: string }>(models: readonly T[]): T[] {
  return models.filter((model) => isModelSlugPubliclyVisible(model.slug));
}

export function filterPubliclyVisibleProducts<T extends { modelSlug: string }>(products: readonly T[]): T[] {
  return products.filter((product) => isModelSlugPubliclyVisible(product.modelSlug));
}
