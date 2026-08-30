import { assertDatabaseConfigured, hasDatabase } from '@/lib/env';
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
 */
export async function getCatalog(): Promise<Catalog> {
  assertDatabaseConfigured('catalog');

  const now = Date.now();
  if (cacheEntry && cacheEntry.expiresAt > now) return cacheEntry.catalog;
  if (inflight) return inflight;

  inflight = loadCatalog()
    .then((catalog) => {
      cacheEntry = { catalog, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
      return catalog;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Test-only: force the next getCatalog() call to rebuild — the deterministic
 * alternative to waiting out CATALOG_CACHE_TTL_MS in a test. */
export function resetCatalogCache(): void {
  cacheEntry = null;
  inflight = null;
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
 * Finds the single best-matching in-stock component for a BOM line.
 * A component field of `undefined` acts as a wildcard; an explicit field
 * must equal the query value. Among ties, the entry with the most matched
 * (non-wildcard) fields wins, so a fully-specific SKU beats a generic one.
 */
export function findComponent(catalog: Catalog, query: ComponentQuery): ShelvingComponent | undefined {
  const candidates = catalog.components.filter((c) => {
    if (c.type !== query.type || !c.active || !c.inStock) return false;
    if (c.models.length > 0 && !c.models.includes(query.modelSlug)) return false;
    if (c.height !== undefined && c.height !== query.height) return false;
    if (c.width !== undefined && c.width !== query.width) return false;
    if (c.depth !== undefined && c.depth !== query.depth) return false;
    if (c.loadCapacity !== undefined && c.loadCapacity !== query.loadCapacity) return false;
    if (c.shelfType !== undefined && c.shelfType !== query.shelfType) return false;
    if (c.variant !== undefined && c.variant !== query.variant) return false;
    return true;
  });

  if (candidates.length === 0) return undefined;

  const specificity = (c: ShelvingComponent) =>
    Number(c.height !== undefined) +
    Number(c.width !== undefined) +
    Number(c.depth !== undefined) +
    Number(c.loadCapacity !== undefined) +
    Number(c.shelfType !== undefined) +
    Number(c.variant !== undefined);

  return candidates.sort((a, b) => specificity(b) - specificity(a))[0];
}

export function stripComponentSecrets(component: ShelvingComponent) {
  const { purchasePrice: _purchasePrice, supplierRef: _supplierRef, ...rest } = component;
  return rest;
}

export function stripAccessorySecrets(accessory: Accessory) {
  const { purchasePrice: _purchasePrice, ...rest } = accessory;
  return rest;
}
