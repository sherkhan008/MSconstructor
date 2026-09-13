import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { assertAdminDatabaseConfigured } from '@/lib/env';
import { recordAuditLog } from '@/lib/admin/audit';
import { invalidateCatalogCache } from '@/lib/data/repository';
import { formatPriceDecimal } from '@/lib/admin/price-input';

/**
 * Admin catalog price management — Prisma-only (see assertAdminDatabaseConfigured),
 * with no in-memory dev fallback, exactly like src/lib/admin/orders.ts.
 *
 * This reads Component/Accessory rows **directly**, never through
 * src/lib/data/repository.ts's catalog: that projection exists to serve
 * customers, so it hides inactive rows and strips purchasePrice — precisely
 * the two things price management needs. Everything returned from here is
 * ADMIN-ONLY and must never be handed to a customer-facing endpoint.
 *
 * Money crosses this boundary as a decimal *string* in both directions
 * (see src/lib/admin/price-input.ts); a price is never a JS float here.
 */

export type PriceEntityType = 'COMPONENT' | 'ACCESSORY';
export type PriceField = 'SELLING_PRICE' | 'PURCHASE_PRICE';

export const PRICE_ENTITY_TYPES: readonly PriceEntityType[] = ['COMPONENT', 'ACCESSORY'];

/** 40 rows: enough to scan a component family in one screen, small enough that
 * the browser never receives (or filters) the whole 150-row catalog. */
export const ADMIN_PRICE_PAGE_SIZE = 40;

/** Upper bound on one history response — the trail is append-only and could
 * otherwise grow without limit for a frequently repriced part. */
export const ADMIN_PRICE_HISTORY_LIMIT = 100;

export interface AdminPriceRow {
  entityType: PriceEntityType;
  id: string;
  sku: string;
  /** Russian name — the admin UI language. */
  name: string;
  /** Component type (UPRIGHT/SHELF/…); null for accessories. */
  componentType: string | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  loadCapacity: number | null;
  shelfType: string | null;
  variant: string | null;
  /** Model slugs this entity applies to; empty means "every model". */
  models: string[];
  active: boolean;
  inStock: boolean;
  /** Public selling price (Accessory.unitPrice), decimal string. */
  sellingPrice: string;
  /** INTERNAL: supplier purchase price, decimal string. Admin-only. */
  purchasePrice: string;
  /** ISO timestamp; doubles as the optimistic-concurrency token. */
  updatedAt: string;
}

export interface AdminPriceListParams {
  search?: string;
  entityType?: PriceEntityType | 'ALL';
  componentType?: string;
  modelSlug?: string;
  page?: number;
}

export interface AdminPriceListResult {
  rows: AdminPriceRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface RawPriceRow {
  entityType: PriceEntityType;
  id: string;
  sku: string;
  name: string;
  componentType: string | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  loadCapacity: number | null;
  shelfType: string | null;
  variant: string | null;
  models: string[];
  active: boolean;
  inStock: boolean;
  sellingPrice: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  updatedAt: Date;
}

function toAdminPriceRow(row: RawPriceRow): AdminPriceRow {
  return {
    entityType: row.entityType,
    id: row.id,
    sku: row.sku,
    name: row.name,
    componentType: row.componentType,
    height: row.height,
    width: row.width,
    depth: row.depth,
    loadCapacity: row.loadCapacity,
    shelfType: row.shelfType,
    variant: row.variant,
    models: row.models ?? [],
    active: row.active,
    inStock: row.inStock,
    sellingPrice: formatPriceDecimal(row.sellingPrice),
    purchasePrice: formatPriceDecimal(row.purchasePrice),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Makes a user's search term safe as an ILIKE pattern: without this, typing
 * `%` or `_` would silently turn the search into a wildcard that matches rows
 * the admin never asked for.
 */
function likePattern(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/**
 * The two catalog tables are queried as one UNION so that filtering, ordering
 * *and* pagination all happen in PostgreSQL — a merged list cannot be paged
 * correctly by fetching both tables and slicing in JS.
 */
function componentBranch(params: AdminPriceListParams): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (params.search) {
    const pattern = likePattern(params.search);
    conditions.push(Prisma.sql`(c."sku" ILIKE ${pattern} ESCAPE '\\' OR c."nameRu" ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (params.componentType) {
    conditions.push(Prisma.sql`c."type" = ${params.componentType}`);
  }
  if (params.modelSlug) {
    // An empty models array means "applies to every model" — the same rule
    // findComponent() uses in src/lib/data/repository.ts.
    conditions.push(
      Prisma.sql`(cardinality(c."models") = 0 OR ${params.modelSlug} = ANY(c."models"))`,
    );
  }
  return Prisma.sql`
    SELECT 'COMPONENT'::text AS "entityType", c."id", c."sku", c."nameRu" AS "name",
           c."type" AS "componentType", c."height", c."width", c."depth",
           c."loadCapacity", c."shelfType", c."variant", c."models",
           c."active", c."inStock",
           c."sellingPrice" AS "sellingPrice", c."purchasePrice" AS "purchasePrice",
           c."updatedAt"
      FROM "Component" c
     WHERE ${Prisma.join(conditions, ' AND ')}
  `;
}

function accessoryBranch(params: AdminPriceListParams): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (params.search) {
    const pattern = likePattern(params.search);
    conditions.push(Prisma.sql`(a."sku" ILIKE ${pattern} ESCAPE '\\' OR a."nameRu" ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (params.modelSlug) {
    conditions.push(
      Prisma.sql`(cardinality(a."models") = 0 OR ${params.modelSlug} = ANY(a."models"))`,
    );
  }
  return Prisma.sql`
    SELECT 'ACCESSORY'::text AS "entityType", a."id", a."sku", a."nameRu" AS "name",
           NULL::text AS "componentType", NULL::integer AS "height", NULL::integer AS "width",
           NULL::integer AS "depth", NULL::integer AS "loadCapacity", NULL::text AS "shelfType",
           NULL::text AS "variant", a."models",
           a."active", a."inStock",
           a."unitPrice" AS "sellingPrice", a."purchasePrice" AS "purchasePrice",
           a."updatedAt"
      FROM "Accessory" a
     WHERE ${Prisma.join(conditions, ' AND ')}
  `;
}

/** null = the filter combination can match nothing, so no query is issued. */
function listSource(params: AdminPriceListParams): Prisma.Sql | null {
  const entityType = params.entityType ?? 'ALL';
  // A component-type filter is meaningless for accessories, which have no
  // type — asking for "all SHELF rows" must not also return every accessory,
  // and asking for accessories *of* a component type matches nothing at all.
  const includeAccessories =
    (entityType === 'ALL' || entityType === 'ACCESSORY') && !params.componentType;
  const includeComponents = entityType === 'ALL' || entityType === 'COMPONENT';

  if (includeComponents && includeAccessories) {
    return Prisma.sql`${componentBranch(params)} UNION ALL ${accessoryBranch(params)}`;
  }
  if (includeComponents) return componentBranch(params);
  if (includeAccessories) return accessoryBranch(params);
  return null;
}

export async function listAdminPrices(params: AdminPriceListParams): Promise<AdminPriceListResult> {
  assertAdminDatabaseConfigured();

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const source = listSource(params);
  if (!source) {
    return { rows: [], total: 0, page, pageSize: ADMIN_PRICE_PAGE_SIZE, totalPages: 1 };
  }

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<RawPriceRow[]>(Prisma.sql`
      SELECT * FROM (${source}) AS t
       ORDER BY t."entityType" ASC, t."sku" ASC
       LIMIT ${ADMIN_PRICE_PAGE_SIZE} OFFSET ${(page - 1) * ADMIN_PRICE_PAGE_SIZE}
    `),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM (${source}) AS t
    `),
  ]);

  const total = Number(countRows[0]?.count ?? 0);

  return {
    rows: rows.map(toAdminPriceRow),
    total,
    page,
    pageSize: ADMIN_PRICE_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / ADMIN_PRICE_PAGE_SIZE)),
  };
}

/* -------------------------------------------------------------------------- */
/* Single entity                                                               */
/* -------------------------------------------------------------------------- */

interface EntityPriceState {
  id: string;
  sku: string;
  name: string;
  sellingPrice: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  updatedAt: Date;
}

/**
 * Reads the two price fields of either entity into one shape. Accessory's
 * public price column is `unitPrice`; it is the selling price, and the rest of
 * this module (and the API) speaks only in terms of selling/purchase so that
 * database column naming never leaks to the client.
 */
async function loadEntityPriceState(
  client: Prisma.TransactionClient,
  entityType: PriceEntityType,
  id: string,
): Promise<EntityPriceState | null> {
  if (entityType === 'COMPONENT') {
    const row = await client.component.findUnique({
      where: { id },
      select: { id: true, sku: true, nameRu: true, sellingPrice: true, purchasePrice: true, updatedAt: true },
    });
    return row
      ? {
          id: row.id,
          sku: row.sku,
          name: row.nameRu,
          sellingPrice: row.sellingPrice,
          purchasePrice: row.purchasePrice,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  const row = await client.accessory.findUnique({
    where: { id },
    select: { id: true, sku: true, nameRu: true, unitPrice: true, purchasePrice: true, updatedAt: true },
  });
  return row
    ? {
        id: row.id,
        sku: row.sku,
        name: row.nameRu,
        sellingPrice: row.unitPrice,
        purchasePrice: row.purchasePrice,
        updatedAt: row.updatedAt,
      }
    : null;
}

export class AdminPriceEntityNotFoundError extends Error {
  constructor(entityType: PriceEntityType, id: string) {
    super(`${entityType} ${id} not found.`);
    this.name = 'AdminPriceEntityNotFoundError';
  }
}

/** Thrown when the row changed after the admin loaded it — never overwrite. */
export class AdminPriceConflictError extends Error {
  readonly currentUpdatedAt?: string;

  constructor(currentUpdatedAt?: string) {
    super('Price row changed since it was loaded.');
    this.name = 'AdminPriceConflictError';
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

export interface PriceChange {
  field: PriceField;
  oldValue: string;
  newValue: string;
}

export interface UpdateEntityPricesParams {
  entityType: PriceEntityType;
  id: string;
  /** Omitted = leave unchanged. */
  sellingPrice?: Prisma.Decimal;
  purchasePrice?: Prisma.Decimal;
  /** The `updatedAt` the admin loaded; omitted = no concurrency check. */
  expectedUpdatedAt?: string;
  reason?: string;
  actor: { id: string; name: string };
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateEntityPricesResult {
  changed: boolean;
  entityType: PriceEntityType;
  id: string;
  sku: string;
  name: string;
  changes: PriceChange[];
  sellingPrice: string;
  purchasePrice: string;
  updatedAt: string;
}

/**
 * Applies a price change to one Component or Accessory.
 *
 * Everything that must be consistent is written in ONE transaction: the entity
 * update, one PriceHistory row per changed field, and the AuditLog row. A
 * partial write (price changed but no trail of who changed it) can never
 * happen.
 *
 * Concurrency: the UPDATE is a compare-and-swap on `updatedAt`
 * (`updateMany` with the loaded timestamp in the WHERE clause), so a second
 * admin's newer price is never silently overwritten even under the default
 * READ COMMITTED isolation, where a re-read alone would not be enough.
 *
 * A request that changes nothing writes nothing at all — no history row, no
 * audit row, no cache invalidation — so re-submitting an unchanged form does
 * not spam the trail.
 */
export async function updateEntityPrices(
  params: UpdateEntityPricesParams,
): Promise<UpdateEntityPricesResult> {
  assertAdminDatabaseConfigured();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await loadEntityPriceState(tx, params.entityType, params.id);
    if (!existing) throw new AdminPriceEntityNotFoundError(params.entityType, params.id);

    if (params.expectedUpdatedAt !== undefined) {
      const expected = new Date(params.expectedUpdatedAt).getTime();
      if (Number.isNaN(expected) || expected !== existing.updatedAt.getTime()) {
        throw new AdminPriceConflictError(existing.updatedAt.toISOString());
      }
    }

    const changes: PriceChange[] = [];
    if (params.sellingPrice && !params.sellingPrice.equals(existing.sellingPrice)) {
      changes.push({
        field: 'SELLING_PRICE',
        oldValue: formatPriceDecimal(existing.sellingPrice),
        newValue: formatPriceDecimal(params.sellingPrice),
      });
    }
    if (params.purchasePrice && !params.purchasePrice.equals(existing.purchasePrice)) {
      changes.push({
        field: 'PURCHASE_PRICE',
        oldValue: formatPriceDecimal(existing.purchasePrice),
        newValue: formatPriceDecimal(params.purchasePrice),
      });
    }

    if (changes.length === 0) {
      return {
        changed: false,
        entityType: params.entityType,
        id: existing.id,
        sku: existing.sku,
        name: existing.name,
        changes,
        sellingPrice: formatPriceDecimal(existing.sellingPrice),
        purchasePrice: formatPriceDecimal(existing.purchasePrice),
        updatedAt: existing.updatedAt.toISOString(),
      } satisfies UpdateEntityPricesResult;
    }

    const nextSelling = params.sellingPrice ?? existing.sellingPrice;
    const nextPurchase = params.purchasePrice ?? existing.purchasePrice;

    // Compare-and-swap: matches 0 rows if anyone changed this entity since it
    // was read a moment ago, which is the lost-update guard.
    const updated =
      params.entityType === 'COMPONENT'
        ? await tx.component.updateMany({
            where: { id: params.id, updatedAt: existing.updatedAt },
            data: { sellingPrice: nextSelling, purchasePrice: nextPurchase },
          })
        : await tx.accessory.updateMany({
            where: { id: params.id, updatedAt: existing.updatedAt },
            data: { unitPrice: nextSelling, purchasePrice: nextPurchase },
          });

    if (updated.count !== 1) {
      const current = await loadEntityPriceState(tx, params.entityType, params.id);
      throw new AdminPriceConflictError(current?.updatedAt.toISOString());
    }

    // One row per changed field — a single edit that moves both prices leaves
    // two independently readable history entries.
    await tx.priceHistory.createMany({
      data: changes.map((change) => ({
        entityType: params.entityType,
        entityId: params.id,
        entitySku: existing.sku,
        entityName: existing.name,
        field: change.field,
        oldValue: new Prisma.Decimal(change.oldValue),
        newValue: new Prisma.Decimal(change.newValue),
        adminId: params.actor.id,
        adminName: params.actor.name,
        reason: params.reason,
      })),
    });

    await recordAuditLog(
      {
        userId: params.actor.id,
        action: 'CATALOG_PRICE_CHANGED',
        entityType: params.entityType,
        entityId: params.id,
        // Full before/after snapshot of both prices plus which fields moved.
        // Never any session/cookie material — only the request metadata the
        // shared audit helper already collects.
        previousData: {
          sku: existing.sku,
          name: existing.name,
          sellingPrice: formatPriceDecimal(existing.sellingPrice),
          purchasePrice: formatPriceDecimal(existing.purchasePrice),
        },
        newData: {
          sku: existing.sku,
          name: existing.name,
          sellingPrice: formatPriceDecimal(nextSelling),
          purchasePrice: formatPriceDecimal(nextPurchase),
          changedFields: changes.map((change) => change.field),
          ...(params.reason ? { reason: params.reason } : {}),
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx,
    );

    const after = await loadEntityPriceState(tx, params.entityType, params.id);

    return {
      changed: true,
      entityType: params.entityType,
      id: params.id,
      sku: existing.sku,
      name: existing.name,
      changes,
      sellingPrice: formatPriceDecimal(nextSelling),
      purchasePrice: formatPriceDecimal(nextPurchase),
      updatedAt: (after?.updatedAt ?? existing.updatedAt).toISOString(),
    } satisfies UpdateEntityPricesResult;
  });

  // Only after the transaction has committed, and only when something really
  // changed: the next catalog/pricing read then rebuilds from the database
  // instead of serving the old price for up to CATALOG_CACHE_TTL_MS.
  if (result.changed) invalidateCatalogCache();

  return result;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export interface AdminPriceHistoryEntry {
  id: string;
  entityType: PriceEntityType;
  entityId: string;
  sku: string | null;
  /** NULL only for rows written before the field column existed. */
  field: PriceField | null;
  oldValue: string | null;
  newValue: string;
  adminId: string | null;
  adminName: string | null;
  reason: string | null;
  createdAt: string;
}

/** Newest first. Admin-only: these rows include purchase-price history. */
export async function listPriceHistory(
  entityType: PriceEntityType,
  entityId: string,
  limit: number = ADMIN_PRICE_HISTORY_LIMIT,
): Promise<AdminPriceHistoryEntry[]> {
  assertAdminDatabaseConfigured();

  const rows = await prisma.priceHistory.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, Math.floor(limit)), ADMIN_PRICE_HISTORY_LIMIT),
    include: { admin: { select: { id: true, name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    entityType: row.entityType as PriceEntityType,
    entityId: row.entityId,
    sku: row.entitySku,
    field: row.field as PriceField | null,
    oldValue: row.oldValue === null ? null : formatPriceDecimal(row.oldValue),
    newValue: formatPriceDecimal(row.newValue),
    adminId: row.adminId,
    // The live account name wins when the admin still exists; the snapshot
    // keeps the trail readable after that account is deleted.
    adminName: row.admin?.name ?? row.adminName,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));
}
