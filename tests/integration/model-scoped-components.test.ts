import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compareComponentPrecedence,
  findComponent,
  getCatalog,
  resetCatalogCache,
  type Catalog,
} from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import type { CatalogProduct, ShelvingComponent, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Model-scoped components — a price that belongs to ONE model.
 *
 * MS Standard's supplier-priced uprights and ordinary shelves live in
 * components scoped to `models = ['ms-standard']` (created by
 * scripts/import-supplier-prices.ts), next to the generic rows MS Strong,
 * Archive MS and any future model share. These tests pin that:
 *   - the scoped row wins for its own model, deterministically, whatever the
 *     catalog order;
 *   - a scoped row SHADOWS the generic row of the same identity even when it
 *     is deactivated or out of stock, so MS Standard is never quietly quoted
 *     another model's generic price;
 *   - no other model can ever resolve to it, so its price cannot leak.
 *
 * Every price here is INVENTED — no supplier figure belongs in this repository.
 */

const SCOPED_PRICE = 1;
const SCOPED_COST = 1;

function config(overrides: Partial<ShelvingConfiguration>): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 4,
    sections: [{ id: 's1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}

/** A scoped copy of the generic row a query resolves to, with invented prices. */
function scopedCopy(generic: ShelvingComponent, sku: string, models = ['ms-standard']): ShelvingComponent {
  return { ...generic, id: `scoped-${sku}`, sku, models, sellingPrice: SCOPED_PRICE, purchasePrice: SCOPED_COST };
}

function withComponents(catalog: Catalog, components: ShelvingComponent[]): Catalog {
  return { ...catalog, components };
}

describe('model-scoped components', () => {
  let base: Catalog;
  let genericUpright: ShelvingComponent;
  let genericShelf: ShelvingComponent;
  /** Catalog with MS Standard-scoped copies of the 2000 upright and 1000×400 shelf. */
  let scoped: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    base = await getCatalog();
    const query = { modelSlug: 'ms-standard', height: 2000, width: 1000, depth: 400, loadCapacity: 150, shelfType: 'STANDARD' as const };
    genericUpright = findComponent(base, { ...query, type: 'UPRIGHT' })!;
    genericShelf = findComponent(base, { ...query, type: 'SHELF' })!;
    expect(genericUpright.models).toEqual([]);
    expect(genericShelf.models).toEqual([]);
    scoped = withComponents(base, [
      ...base.components,
      scopedCopy(genericUpright, 'MSS-UPR-H2000'),
      scopedCopy(genericShelf, 'MSS-SHF-1000X400'),
    ]);
  });

  describe('precedence', () => {
    const query = { type: 'SHELF' as const, modelSlug: 'ms-standard', width: 1000, depth: 400, shelfType: 'STANDARD' as const };

    it('prefers the model-scoped match over the generic match, in either catalog order', () => {
      const scopedRow = scopedCopy(genericShelf, 'MSS-SHF-1000X400');
      const forward = withComponents(base, [genericShelf, scopedRow]);
      const reverse = withComponents(base, [scopedRow, genericShelf]);
      expect(findComponent(forward, query)?.sku).toBe('MSS-SHF-1000X400');
      expect(findComponent(reverse, query)?.sku).toBe('MSS-SHF-1000X400');
    });

    it('prefers a scoped row even over a more specific generic row', () => {
      const wildcardScoped = { ...scopedCopy(genericShelf, 'MSS-SHF-ANY'), shelfType: undefined };
      const catalog = withComponents(base, [genericShelf, wildcardScoped]);
      expect(findComponent(catalog, query)?.sku).toBe('MSS-SHF-ANY');
    });

    it('falls back to the generic row when there is no scoped match', () => {
      expect(findComponent(scoped, { ...query, width: 1200 })?.models).toEqual([]);
    });

    it('breaks a remaining tie by SKU, never by array order', () => {
      const a = scopedCopy(genericShelf, 'MSS-A');
      const b = scopedCopy(genericShelf, 'MSS-B');
      expect(findComponent(withComponents(base, [b, a]), query)?.sku).toBe('MSS-A');
      expect(findComponent(withComponents(base, [a, b]), query)?.sku).toBe('MSS-A');
      expect(compareComponentPrecedence(a, b)).toBeLessThan(0);
      expect(compareComponentPrecedence(b, a)).toBeGreaterThan(0);
    });

    it('never lets a row scoped to one model be used by another', () => {
      for (const modelSlug of ['ms-strong', 'archive-ms', 'some-future-model']) {
        const found = findComponent(scoped, { ...query, modelSlug });
        expect(found?.sku).not.toMatch(/^MSS-/);
      }
    });
  });

  describe('reseed / bootstrap', () => {
    it('seed data never defines a scoped supplier row, and the seed never overwrites an existing component', () => {
      // prisma/seed.ts upserts by SKU with `update: {}`: it only creates
      // missing seed rows. The scoped MSS-* rows are not seed rows, so a
      // reseed can neither recreate them with placeholder prices nor touch the
      // imported ones.
      expect(base.components.filter((c) => c.sku.startsWith('MSS-'))).toEqual([]);
      const seed = readFileSync(resolve(process.cwd(), 'prisma/seed.ts'), 'utf8');
      const block = seed.slice(seed.indexOf('async function seedComponents'), seed.indexOf('async function seedRules'));
      expect(block).toMatch(/component\.upsert\(\{\s*where: \{ sku: c\.sku \},\s*update: \{\},/);
      expect(block).not.toMatch(/delete/i);
    });
  });

  describe('pricing', () => {
    it('prices MS Standard from its scoped rows', () => {
      const result = calculatePrice(config({}), scoped);
      if (!result.ok) throw new Error(result.message);
      const skus = result.bom.map((line) => line.sku);
      expect(skus).toContain('MSS-UPR-H2000');
      expect(skus).toContain('MSS-SHF-1000X400');
      expect(skus).not.toContain(genericUpright.sku);
      expect(skus).not.toContain(genericShelf.sku);
      const shelfLine = result.bom.find((line) => line.sku === 'MSS-SHF-1000X400')!;
      expect(shelfLine.unitPrice).toBe(SCOPED_PRICE);
    });

    const otherModels: [string, Partial<ShelvingConfiguration>][] = [
      ['ms-strong', { modelSlug: 'ms-strong', shelfType: 'REINFORCED', loadCapacity: 150 }],
      ['archive-ms', { modelSlug: 'archive-ms', loadCapacity: 100 }],
    ];

    it.each(otherModels)('%s does not inherit MS Standard scoped prices', (_slug, overrides) => {
      const before = calculatePrice(config(overrides), base);
      const after = calculatePrice(config(overrides), scoped);
      if (!before.ok || !after.ok) throw new Error('configuration should price');
      expect(after.bom.map((l) => l.sku)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^MSS-/)]));
      expect(after.bom).toEqual(before.bom);
      expect(after.breakdown).toEqual(before.breakdown);
    });

    it('a row shared with another model is still generic-ranked for models it does not name', () => {
      const shared = scopedCopy(genericUpright, 'MSS-SHARED', ['ms-standard', 'archive-ms']);
      const catalog = withComponents(base, [...base.components, shared]);
      const strong = findComponent(catalog, { type: 'UPRIGHT', modelSlug: 'ms-strong', height: 2000, loadCapacity: 150 });
      expect(strong?.sku).toBe(genericUpright.sku);
    });
  });

  /**
   * SHADOWING — the commercial safety property.
   *
   * A scoped row decides the candidate pool BEFORE availability is looked at,
   * so deactivating it or taking it out of stock can never hand MS Standard
   * the generic row's price. The configuration becomes unavailable instead.
   */
  describe('a scoped row shadows the generic row even when it cannot be sold', () => {
    const shelfQuery = { type: 'SHELF' as const, modelSlug: 'ms-standard', width: 1000, depth: 400, shelfType: 'STANDARD' as const };

    /** The two ways a component stops being sellable, as catalog-row overrides. */
    const UNSELLABLE: [string, Partial<ShelvingComponent>][] = [
      ['inactive', { active: false }],
      ['out of stock', { inStock: false }],
    ];

    const catalogWithScopedShelf = (overrides: Partial<ShelvingComponent> = {}) =>
      withComponents(base, [...base.components, { ...scopedCopy(genericShelf, 'MSS-SHF-1000X400'), ...overrides }]);

    it('uses the scoped row while it is active and in stock', () => {
      const found = findComponent(catalogWithScopedShelf(), shelfQuery);
      expect(found?.sku).toBe('MSS-SHF-1000X400');
      expect(found?.sellingPrice).toBe(SCOPED_PRICE);
    });

    it.each(UNSELLABLE)('resolves nothing when the scoped row is %s — never the generic row', (_label, overrides) => {
      expect(findComponent(catalogWithScopedShelf(overrides), shelfQuery)).toBeUndefined();
    });

    it.each(UNSELLABLE)('a %s scoped row makes the configuration unavailable rather than mispriced', (_label, overrides) => {
      const priced = calculatePrice(config({}), catalogWithScopedShelf(overrides));
      expect(priced.ok).toBe(false);
      if (priced.ok) return;
      // The existing domain semantics for "this cannot be built as configured".
      expect(priced.code).toBe('INDIVIDUAL_QUOTE_REQUIRED');
    });

    it.each(UNSELLABLE)('a %s scoped row never lets the generic price reach the customer', (_label, overrides) => {
      const good = calculatePrice(config({}), catalogWithScopedShelf());
      const generic = calculatePrice(config({}), base);
      const shadowed = calculatePrice(config({}), catalogWithScopedShelf(overrides));
      if (!good.ok || !generic.ok) throw new Error('baseline configurations should price');
      // Without shadowing the shadowed case would silently become this total.
      expect(generic.breakdown.total).not.toBe(good.breakdown.total);
      expect(shadowed.ok).toBe(false);
    });

    it.each(UNSELLABLE)('shadows only its own identity — other sizes still fall back to generic (%s row)', (_label, overrides) => {
      const catalog = catalogWithScopedShelf(overrides);
      // Same model, a depth the scoped row does not price: generic, as before.
      const other = findComponent(catalog, { ...shelfQuery, depth: 300 });
      expect(other?.models).toEqual([]);
      expect(other?.active).toBe(true);
      expect(other?.inStock).toBe(true);
    });

    it('generic fallback is untouched where no scoped row exists at all', () => {
      const found = findComponent(base, shelfQuery);
      expect(found?.sku).toBe(genericShelf.sku);
      expect(found?.models).toEqual([]);
      expect(calculatePrice(config({}), base).ok).toBe(true);
    });

    it('an unsellable generic row with no scoped row still resolves nothing (unchanged behaviour)', () => {
      const dead = base.components.map((c) => (c.id === genericShelf.id ? { ...c, inStock: false } : c));
      expect(findComponent(withComponents(base, dead), shelfQuery)).toBeUndefined();
    });

    it('prefers a sellable scoped row over an unsellable one, without leaving the scoped pool', () => {
      const catalog = withComponents(base, [
        ...base.components,
        { ...scopedCopy(genericShelf, 'MSS-SHF-A'), active: false },
        scopedCopy(genericShelf, 'MSS-SHF-B'),
      ]);
      expect(findComponent(catalog, shelfQuery)?.sku).toBe('MSS-SHF-B');
    });
  });

  /**
   * MSS-* rows belong to MS Standard alone. Shadowing must not change that in
   * either direction: another model can neither use them nor be blocked by
   * them.
   */
  describe.each(['ms-strong', 'archive-ms'])('%s cannot resolve MSS-* rows', (modelSlug) => {
    const otherConfig: Record<string, Partial<ShelvingConfiguration>> = {
      'ms-strong': { modelSlug: 'ms-strong', shelfType: 'REINFORCED', loadCapacity: 150 },
      'archive-ms': { modelSlug: 'archive-ms', loadCapacity: 100 },
    };

    /** Scoped rows in every availability state MS Standard can put them in. */
    const states: [string, Partial<ShelvingComponent>][] = [
      ['sellable', {}],
      ['inactive', { active: false }],
      ['out of stock', { inStock: false }],
    ];

    const catalogWith = (overrides: Partial<ShelvingComponent>) =>
      withComponents(base, [
        ...base.components,
        { ...scopedCopy(genericUpright, 'MSS-UPR-H2000'), ...overrides },
        { ...scopedCopy(genericShelf, 'MSS-SHF-1000X400'), ...overrides },
      ]);

    it.each(states)('no component query returns an MSS-* row (%s scoped rows)', (_label, overrides) => {
      const catalog = catalogWith(overrides);
      for (const type of ['UPRIGHT', 'SHELF'] as const) {
        for (const depth of [300, 400, 600]) {
          const found = findComponent(catalog, {
            type,
            modelSlug,
            height: 2000,
            width: 1000,
            depth,
            loadCapacity: otherConfig[modelSlug].loadCapacity,
            shelfType: otherConfig[modelSlug].shelfType ?? 'STANDARD',
          });
          expect(found?.sku ?? '').not.toMatch(/^MSS-/);
        }
      }
    });

    it.each(states)('keeps its own generic price and BOM (%s scoped rows)', (_label, overrides) => {
      const before = calculatePrice(config(otherConfig[modelSlug]), base);
      const after = calculatePrice(config(otherConfig[modelSlug]), catalogWith(overrides));
      if (!before.ok || !after.ok) throw new Error(`${modelSlug} should still price`);
      expect(after.bom.map((l) => l.sku).filter((sku) => sku.startsWith('MSS-'))).toEqual([]);
      expect(after.bom).toEqual(before.bom);
      expect(after.breakdown).toEqual(before.breakdown);
    });
  });

  /**
   * The three ready configurations the homepage advertises — read from
   * catalog data exactly as src/app/page.tsx picks them, never restated here.
   *
   * Their tenge figures are verified against the real catalog outside this
   * repository (the approved supplier list is private), so what is asserted
   * here is that they price, that they price from the scoped rows at all
   * three depths, and that shadowing moves neither their total nor each
   * other's availability.
   */
  describe('the three popular MS Standard configurations', () => {
    let popular: CatalogProduct[];

    beforeAll(() => {
      popular = base.products
        .filter((p) => p.modelSlug === 'ms-standard' && p.featured && p.published)
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 3);
      expect(popular).toHaveLength(3);
    });

    /** Scoped copies of the upright and shelf a configuration resolves to. */
    function scopedRowsFor(cfg: ShelvingConfiguration): ShelvingComponent[] {
      const width = cfg.sections[0].width;
      const common = { modelSlug: cfg.modelSlug, height: cfg.height, width, depth: cfg.depth, loadCapacity: cfg.loadCapacity, shelfType: cfg.shelfType };
      const upright = findComponent(base, { ...common, type: 'UPRIGHT' })!;
      const shelf = findComponent(base, { ...common, type: 'SHELF' })!;
      return [
        scopedCopy(upright, `MSS-UPR-H${cfg.height}`),
        scopedCopy(shelf, `MSS-SHF-${width}X${cfg.depth}`),
      ];
    }

    /** base + one scoped row per distinct identity the popular configs need. */
    function fullyScoped(overridesBySku: Record<string, Partial<ShelvingComponent>> = {}): Catalog {
      const bySku = new Map<string, ShelvingComponent>();
      for (const product of popular) {
        for (const row of scopedRowsFor(catalogProductToConfiguration(product))) {
          bySku.set(row.sku, { ...row, ...(overridesBySku[row.sku] ?? {}) });
        }
      }
      return withComponents(base, [...base.components, ...bySku.values()]);
    }

    it('every popular configuration prices, before and after scoping', () => {
      const scopedCatalog = fullyScoped();
      for (const product of popular) {
        const cfg = catalogProductToConfiguration(product);
        expect(calculatePrice(cfg, base).ok, product.slug).toBe(true);
        expect(calculatePrice(cfg, scopedCatalog).ok, product.slug).toBe(true);
      }
    });

    it('every popular configuration is priced from its scoped rows, at all three depths', () => {
      const scopedCatalog = fullyScoped();
      const depths = new Set<number>();
      for (const product of popular) {
        const cfg = catalogProductToConfiguration(product);
        depths.add(cfg.depth);
        const result = calculatePrice(cfg, scopedCatalog);
        if (!result.ok) throw new Error(`${product.slug}: ${result.message}`);
        const carriers = result.bom.filter((l) => l.type === 'UPRIGHT' || l.type === 'SHELF');
        expect(carriers.length, product.slug).toBeGreaterThan(0);
        for (const line of carriers) {
          expect(line.sku, product.slug).toMatch(/^MSS-/);
          expect(line.unitPrice, line.sku).toBe(SCOPED_PRICE);
        }
      }
      expect([...depths].sort((a, b) => a - b)).toEqual([300, 400, 600]);
    });

    it('a shadowed scoped row takes out exactly one popular configuration, not the others', () => {
      for (const target of popular) {
        const targetCfg = catalogProductToConfiguration(target);
        const shelfSku = `MSS-SHF-${targetCfg.sections[0].width}X${targetCfg.depth}`;
        for (const unsellable of [{ active: false }, { inStock: false }]) {
          const catalog = fullyScoped({ [shelfSku]: unsellable });
          for (const product of popular) {
            const result = calculatePrice(catalogProductToConfiguration(product), catalog);
            expect(result.ok, `${product.slug} while ${shelfSku} is unsellable`).toBe(product.slug !== target.slug);
          }
        }
      }
    });

    it('prices each popular configuration from the scoped uprights and shelves alone', () => {
      const scopedCatalog = fullyScoped();
      for (const product of popular) {
        const result = calculatePrice(catalogProductToConfiguration(product), scopedCatalog);
        if (!result.ok) throw new Error(`${product.slug}: ${result.message}`);
        const carriers = result.bom
          .filter((l) => l.type === 'UPRIGHT' || l.type === 'SHELF')
          .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
        expect(result.breakdown.componentsSubtotal, product.slug).toBe(carriers);
      }
    });
  });
});
