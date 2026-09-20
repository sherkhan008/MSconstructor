import { assertDatabaseConfigured, hasDatabase, isProductionBuildPhase } from '@/lib/env';
import type {
  Accessory,
  AssemblyService,
  CatalogProduct,
  ColorOption,
  ComponentType,
  ConfigurationRule,
  DeliveryMethod,
  DimensionOption,
  LoadCapacityOption,
  PricingSettings,
  ProductModel,
  PromoCode,
  PublicAccessory,
  ShelfType,
  ShelvingComponent,
} from '@/lib/types/domain';
import {
  ACCESSORIES,
  ASSEMBLY_SERVICES,
  CATALOG_PRODUCTS,
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
  USE_CASES,
  WIDTHS,
} from './seed-data';

/**
 * Catalog repository.
 *
 * `hasDatabase` (src/lib/env.ts) is false whenever DATABASE_URL is not a
 * PostgreSQL connection string — which is the default for a clean checkout.
 * In that case every read below is served from the in-memory sample catalog
 * so the site is fully functional with zero infrastructure.
 *
 * When DATABASE_URL is configured, src/lib/data/db-repository.ts takes over
 * transparently (same return shapes, same function signatures) — nothing
 * above this layer needs to know which source served the data.
 */

export interface Catalog {
  models: ProductModel[];
  heights: DimensionOption[];
  widths: DimensionOption[];
  depths: DimensionOption[];
  loadCapacities: LoadCapacityOption[];
  components: ShelvingComponent[];
  rules: ConfigurationRule[];
  accessories: Accessory[];
  colors: ColorOption[];
  assemblyServices: AssemblyService[];
  deliveryMethods: DeliveryMethod[];
  pricingSettings: PricingSettings;
  promoCodes: PromoCode[];
  products: CatalogProduct[];
  useCases: { id: string; ru: string; kk: string }[];
}

/**
 * A fresh, independent snapshot on every call — never the shared seed-data
 * arrays by reference. The Postgres-backed path (db-repository.ts) already
 * builds new row objects on every query; mirroring that here means no
 * caller can ever mutate a cached catalog and silently corrupt the shared
 * seed data for the rest of the process (and it's what makes a catalog
 * cache genuinely testable — see tests/integration/catalog-cache.test.ts).
 */
function buildMockCatalog(): Catalog {
  return structuredClone({
    models: MODELS,
    heights: HEIGHTS,
    widths: WIDTHS,
    depths: DEPTHS,
    loadCapacities: LOAD_CAPACITIES,
    components: COMPONENTS,
    rules: CONFIGURATION_RULES,
    accessories: ACCESSORIES,
    colors: COLORS,
    assemblyServices: ASSEMBLY_SERVICES,
    deliveryMethods: DELIVERY_METHODS,
    pricingSettings: PRICING_SETTINGS,
    promoCodes: PROMO_CODES,
    products: CATALOG_PRODUCTS,
    useCases: USE_CASES,
  });
}

/**
 * A changed database price must become visible without an application
 * restart, but re-querying Postgres on every single request is wasteful for
 * data that only an admin changes occasionally. A short TTL is the smallest
 * robust middle ground (spec: "prefer simplicity for MVP"). 60s is a bound
 * on staleness, not a promise of freshness the moment a price changes.
 */
export const CATALOG_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  catalog: Catalog;
  expiresAt: number;
}

let cacheEntry: CacheEntry | null = null;
// Shared by every concurrent caller that arrives while a rebuild is already
// in flight, so an expired cache under load triggers one rebuild, not one
// per concurrent request (thundering herd).
let inflight: Promise<Catalog> | null = null;
/**
 * Bumped by every invalidateCatalogCache() call. A rebuild captures the
 * generation it started under and refuses to publish its result if that
 * generation is no longer current — which is the whole point: an admin who
 * changes a price while a rebuild is already reading the old rows must not
 * have the cache repopulated with that stale snapshot a moment later.
 * The stale result is still returned to the caller that asked for it (it was
 * correct when the query ran); it simply never becomes the active cache
 * entry, so the next read rebuilds from the database.
 */
let cacheGeneration = 0;

async function loadCatalog(): Promise<Catalog> {
  if (hasDatabase) {
    const { buildDbCatalog } = await import('./db-repository');
    return buildDbCatalog();
  }
  return buildMockCatalog();
}

/**
 * Returns the full reference catalog, refreshed at most once per
 * CATALOG_CACHE_TTL_MS. Throws in production if no real database is
 * configured — see assertDatabaseConfigured — rather than silently serving
 * the in-memory sample catalog.
 *
 * Also throws during `next build`: the production image is built with no
 * database (Dockerfile), so a catalog read there could only bake the sample
 * catalog — or a DB snapshot frozen at image-build time — into prerendered
 * HTML. Every route that reads the catalog renders at request time
 * (`export const dynamic = 'force-dynamic'`); this makes a route that forgets
 * to fail the build loudly instead.
 */
export async function getCatalog(): Promise<Catalog> {
  if (isProductionBuildPhase) {
    throw new Error(
      'The catalog must not be read during `next build`. Render the route that reads it at request time (export const dynamic = \'force-dynamic\').',
    );
  }
  assertDatabaseConfigured('catalog');

  const now = Date.now();
  if (cacheEntry && cacheEntry.expiresAt > now) return cacheEntry.catalog;
  if (inflight) return inflight;

  const generation = cacheGeneration;
  const tracked: Promise<Catalog> = loadCatalog()
    .then((catalog) => {
      // Publish only if nothing invalidated the cache while this rebuild was
      // reading the database — see cacheGeneration.
      if (generation === cacheGeneration) {
        cacheEntry = { catalog, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
      }
      return catalog;
    })
    .finally(() => {
      // Only clear the slot if it is still ours: an invalidation may already
      // have replaced it with a newer rebuild, which must not be dropped.
      if (inflight === tracked) inflight = null;
    });

  inflight = tracked;
  return tracked;
}

/**
 * Production-safe cache invalidation: call it right after a committed admin
 * change to catalog data so the very next read rebuilds from the database
 * instead of waiting out CATALOG_CACHE_TTL_MS. Safe against a rebuild that is
 * already in flight — that older rebuild can no longer become the active
 * cache entry (see cacheGeneration).
 *
 * Scope note: the cache lives in the Node process, so this clears *this*
 * instance. Other instances behind a load balancer still converge within
 * CATALOG_CACHE_TTL_MS, which remains the upper bound on staleness.
 */
export function invalidateCatalogCache(): void {
  cacheGeneration += 1;
  cacheEntry = null;
  inflight = null;
}

/** Test-only alias for invalidateCatalogCache() — the deterministic
 * alternative to waiting out CATALOG_CACHE_TTL_MS in a test. Application
 * code calls invalidateCatalogCache() instead. */
export function resetCatalogCache(): void {
  invalidateCatalogCache();
}

/* -------------------------------------------------------------------------- */
/* Lookup helpers                                                              */
/* -------------------------------------------------------------------------- */

export function findModel(catalog: Catalog, slug: string): ProductModel | undefined {
  return catalog.models.find((m) => m.slug === slug && m.active);
}

export function findAccessory(catalog: Catalog, id: string): Accessory | undefined {
  return catalog.accessories.find((a) => a.id === id && a.active);
}

export function findColor(catalog: Catalog, id: string): ColorOption | undefined {
  return catalog.colors.find((c) => c.id === id && c.available);
}

export function findAssembly(catalog: Catalog, id: string): AssemblyService | undefined {
  return catalog.assemblyServices.find((a) => a.id === id && a.active);
}

export function findDelivery(catalog: Catalog, id: string): DeliveryMethod | undefined {
  return catalog.deliveryMethods.find((d) => d.id === id && d.active);
}

export function findPromoCode(catalog: Catalog, code: string): PromoCode | undefined {
  const normalized = code.trim().toUpperCase();
  return catalog.promoCodes.find((p) => p.code === normalized && p.active);
}

export interface ComponentQuery {
  type: ComponentType;
  height?: number;
  width?: number;
  depth?: number;
  loadCapacity?: number;
  shelfType?: ShelfType;
  variant?: string;
  modelSlug: string;
}

/**
 * Precedence between two components that both match a query, as a sort
 * comparator (negative = `a` wins). Explicit and total, so the result never
 * depends on catalog/database row order:
 *
 *   1. MODEL SCOPE — a row scoped to the queried model (non-empty `models`
 *      that includes it) beats a generic row (`models` empty). This is what
 *      lets a model carry its own price for a physical part without touching
 *      the generic row every other model shares (e.g. MS Standard's
 *      supplier-priced uprights/shelves — scripts/import-supplier-prices.ts).
 *   2. SPECIFICITY — more matched (non-wildcard) fields wins, so a
 *      fully-specific SKU beats a wildcard one.
 *   3. SKU — final lexical tie-break.
 */
export function compareComponentPrecedence(a: ShelvingComponent, b: ShelvingComponent): number {
  const scope = (c: ShelvingComponent) => Number(c.models.length > 0);
  const specificity = (c: ShelvingComponent) =>
    Number(c.height !== undefined) +
    Number(c.width !== undefined) +
    Number(c.depth !== undefined) +
    Number(c.loadCapacity !== undefined) +
    Number(c.shelfType !== undefined) +
    Number(c.variant !== undefined);

  return (
    scope(b) - scope(a) ||
    specificity(b) - specificity(a) ||
    (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)
  );
}

/**
 * Does this component answer the query at all, ignoring whether it can
 * currently be sold? A field of `undefined` acts as a wildcard; an explicit
 * field must equal the query value. A row scoped to other models is not a
 * candidate for this model, so it can neither be used nor shadow anything.
 */
function matchesComponentQuery(c: ShelvingComponent, query: ComponentQuery): boolean {
  if (c.type !== query.type) return false;
  if (c.models.length > 0 && !c.models.includes(query.modelSlug)) return false;
  if (c.height !== undefined && c.height !== query.height) return false;
  if (c.width !== undefined && c.width !== query.width) return false;
  if (c.depth !== undefined && c.depth !== query.depth) return false;
  if (c.loadCapacity !== undefined && c.loadCapacity !== query.loadCapacity) return false;
  if (c.shelfType !== undefined && c.shelfType !== query.shelfType) return false;
  if (c.variant !== undefined && c.variant !== query.variant) return false;
  return true;
}

/** A component that may actually be sold right now. */
const isSellable = (c: ShelvingComponent) => c.active && c.inStock;

/**
 * Finds the single best-matching sellable component for a BOM line.
 *
 * SCOPED ROWS SHADOW GENERIC ROWS
 * -------------------------------
 * The candidate pool is decided BEFORE availability is considered:
 *
 *   - if any row scoped to the queried model matches the query, the pool is
 *     exactly those scoped rows and every generic (`models = []`) match is
 *     shadowed out of it — whether or not the scoped rows can be sold;
 *   - otherwise the pool is the generic matches.
 *
 * Only then is the pool narrowed to what is active and in stock, and the
 * winner picked with compareComponentPrecedence.
 *
 * The consequence that matters commercially: when a model carries its own
 * price for a part (MS Standard's supplier-priced uprights and shelves,
 * scripts/import-supplier-prices.ts) and that scoped row is deactivated or
 * goes out of stock, the configuration becomes UNAVAILABLE — this returns
 * `undefined`, which buildBom turns into a missing critical component and the
 * pricing engine into INDIVIDUAL_QUOTE_REQUIRED. It must never quietly fall
 * back to the generic row, because that row carries a different model's price
 * and the customer would be quoted the wrong figure.
 *
 * Generic fallback stays fully available for every identity that has no
 * scoped row at all, which is how MS Strong and Archive MS are priced.
 *
 * Reading inactive rows: buildDbCatalog() therefore loads components without
 * an `active` filter, so a deactivated scoped row is still visible here and
 * can do its shadowing.
 */
export function findComponent(catalog: Catalog, query: ComponentQuery): ShelvingComponent | undefined {
  const matches = catalog.components.filter((c) => matchesComponentQuery(c, query));
  const scoped = matches.filter((c) => c.models.length > 0);
  const pool = scoped.length > 0 ? scoped : matches;

  const sellable = pool.filter(isSellable);
  if (sellable.length === 0) return undefined;

  return sellable.sort(compareComponentPrecedence)[0];
}

export function stripComponentSecrets(component: ShelvingComponent) {
  const { purchasePrice: _purchasePrice, supplierRef: _supplierRef, ...rest } = component;
  return rest;
}

/** Accessory as shipped to the browser (see PublicAccessory): no purchase
 * price, and no pre-markup unit price from which the markup could be derived. */
export function stripAccessorySecrets(accessory: Accessory): PublicAccessory {
  const { purchasePrice: _purchasePrice, unitPrice: _unitPrice, ...rest } = accessory;
  return rest;
}

/**
 * markupPercent/markupFixed are what turn component cost into the selling
 * price (src/lib/pricing/engine.ts) — publishing them lets anyone derive our
 * purchase cost from a quoted price, so they stay server-side exactly like
 * purchasePrice does. Only the pricing engine, which reads the internal
 * Catalog, ever needs them.
 */
export function stripModelSecrets(model: ProductModel) {
  const { markupPercent: _markupPercent, markupFixed: _markupFixed, ...rest } = model;
  return rest;
}
