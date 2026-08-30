import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog, resetCatalogCache, stripAccessorySecrets, stripComponentSecrets, type Catalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';

/**
 * Moving pricing into PostgreSQL must not weaken the existing privacy
 * boundary: purchasePrice/supplierRef/markup stay server-only regardless of
 * which repository (mock or Prisma) built the internal Catalog.
 */

describe('public catalog projection never leaks internal commercial data', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  it('strips purchasePrice from every public accessory', () => {
    const publicCatalog = toPublicCatalog(catalog);
    expect(publicCatalog.accessories.length).toBeGreaterThan(0);
    for (const accessory of publicCatalog.accessories) {
      expect(accessory).not.toHaveProperty('purchasePrice');
    }
  });

  it('never includes the internal components list at all', () => {
    const publicCatalog = toPublicCatalog(catalog);
    expect(publicCatalog).not.toHaveProperty('components');
  });

  it('never includes the promo code list', () => {
    const publicCatalog = toPublicCatalog(catalog);
    expect(publicCatalog).not.toHaveProperty('promoCodes');
  });

  it('stripAccessorySecrets removes purchasePrice and nothing else', () => {
    const accessory = catalog.accessories[0];
    const stripped = stripAccessorySecrets(accessory);
    expect(stripped).not.toHaveProperty('purchasePrice');
    expect(stripped.unitPrice).toBe(accessory.unitPrice);
    expect(stripped.sku).toBe(accessory.sku);
  });

  it('stripComponentSecrets removes purchasePrice and supplierRef and nothing else', () => {
    const component = catalog.components[0];
    const stripped = stripComponentSecrets(component);
    expect(stripped).not.toHaveProperty('purchasePrice');
    expect(stripped).not.toHaveProperty('supplierRef');
    expect(stripped.sellingPrice).toBe(component.sellingPrice);
    expect(stripped.sku).toBe(component.sku);
  });
});
