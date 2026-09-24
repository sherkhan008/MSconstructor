import { beforeAll, describe, expect, it } from 'vitest';
import { reconcileConfiguration } from '@/lib/configurator/reconcile';
import { DEFAULT_CONFIGURATION } from '@/store/configurator-store';
import { getCatalog, resetCatalogCache } from '@/lib/data/repository';
import { toPublicCatalog, type PublicCatalog } from '@/lib/data/public-catalog';

describe('reconcileConfiguration — repairs a persisted config against the current catalog', () => {
  let catalog: PublicCatalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = toPublicCatalog(await getCatalog());
  });

  it('leaves an already-valid configuration completely untouched', () => {
    const result = reconcileConfiguration(DEFAULT_CONFIGURATION, catalog);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(DEFAULT_CONFIGURATION);
  });

  it('leaves a valid NON-default assembly/delivery selection untouched — never force-resets a still-valid choice', () => {
    const config = { ...DEFAULT_CONFIGURATION, assemblyId: 'assembly-professional', deliveryId: 'delivery-city' };
    const result = reconcileConfiguration(config, catalog);
    expect(result.changed).toBe(false);
    expect(result.config.assemblyId).toBe('assembly-professional');
    expect(result.config.deliveryId).toBe('delivery-city');
  });

  it('resets a stale colorId to the explicit default when the persisted id no longer resolves', () => {
    const config = { ...DEFAULT_CONFIGURATION, colorId: 'cmtedr4on0051o0m4p8cdmxay-stale-cuid' };
    const result = reconcileConfiguration(config, catalog);
    expect(result.changed).toBe(true);
    expect(result.colorReset).toBe(true);
    expect(result.config.colorId).toBe(DEFAULT_CONFIGURATION.colorId);
  });

  it('resets a stale assemblyId/deliveryId to the explicit default', () => {
    const config = { ...DEFAULT_CONFIGURATION, assemblyId: 'stale-cuid-1', deliveryId: 'stale-cuid-2' };
    const result = reconcileConfiguration(config, catalog);
    expect(result.changed).toBe(true);
    expect(result.assemblyReset).toBe(true);
    expect(result.deliveryReset).toBe(true);
    expect(result.config.assemblyId).toBe(DEFAULT_CONFIGURATION.assemblyId);
    expect(result.config.deliveryId).toBe(DEFAULT_CONFIGURATION.deliveryId);
  });

  it('drops only the unavailable accessory, keeping every still-valid selection', () => {
    const target = DEFAULT_CONFIGURATION.sections[0];
    const config = {
      ...DEFAULT_CONFIGURATION,
      accessories: [
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id },
        { accessoryId: 'stale-cuid-accessory', quantity: 1 },
      ],
    };
    const result = reconcileConfiguration(config, catalog);
    expect(result.changed).toBe(true);
    expect(result.removedAccessoryIds).toEqual(['stale-cuid-accessory']);
    expect(result.config.accessories).toEqual([{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id }]);
  });

  it('never touches dimensions, sections, or quantity', () => {
    const sections = DEFAULT_CONFIGURATION.sections.map((s) => ({ ...s, height: 2500, shelves: 7 }));
    const config = { ...DEFAULT_CONFIGURATION, colorId: 'stale', sections, quantity: 3 };
    const result = reconcileConfiguration(config, catalog);
    expect(result.config.sections.map((s) => [s.height, s.shelves])).toEqual([[2500, 7]]);
    expect(result.config.quantity).toBe(3);
    expect(result.config.sections).toBe(config.sections);
  });

  it('never invents/computes a price — the result carries no price fields', () => {
    const config = { ...DEFAULT_CONFIGURATION, colorId: 'stale' };
    const result = reconcileConfiguration(config, catalog);
    expect(result.config).not.toHaveProperty('breakdown');
    expect(result.config).not.toHaveProperty('total');
  });
});
