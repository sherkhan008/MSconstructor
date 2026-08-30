import { DEFAULT_CONFIGURATION } from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { ShelvingConfiguration } from '@/lib/types/domain';

export interface ReconcileResult {
  config: ShelvingConfiguration;
  changed: boolean;
  removedAccessoryIds: string[];
  colorReset: boolean;
  assemblyReset: boolean;
  deliveryReset: boolean;
}

/**
 * Repairs a PERSISTED (localStorage cart item) configuration against the
 * current, server-fetched public catalog — never against a hardcoded or
 * fuzzy-matched value. Exists for the same reason as
 * ConfiguratorClient.tsx's own normalization effect (which handles the
 * live in-progress config): a catalog re-seed/repair
 * (scripts/repair-canonical-catalog-ids.ts) can rename the underlying
 * database id a colorId/assemblyId/deliveryId/accessoryId points at, and a
 * cart item added before that rename must not be left permanently stuck.
 *
 * colorId/assemblyId/deliveryId fall back to DEFAULT_CONFIGURATION's own
 * values ONLY when the persisted value no longer resolves — that's the one
 * "explicitly defined safe default" this is allowed to use, never an
 * invented substitute. A still-valid non-default selection is left alone.
 * An accessory selection that no longer resolves is dropped, not
 * substituted — the customer's other selections and the rest of the
 * configuration (dimensions, sections, quantity) are untouched. The server
 * remains the sole source of truth for price; this never computes one.
 */
export function reconcileConfiguration(config: ShelvingConfiguration, catalog: PublicCatalog): ReconcileResult {
  const colorValid = catalog.colors.some((c) => c.id === config.colorId);
  const assemblyValid = catalog.assemblyServices.some((a) => a.id === config.assemblyId);
  const deliveryValid = catalog.deliveryMethods.some((d) => d.id === config.deliveryId);

  const colorReset = !colorValid && catalog.colors.some((c) => c.id === DEFAULT_CONFIGURATION.colorId);
  const assemblyReset = !assemblyValid && catalog.assemblyServices.some((a) => a.id === DEFAULT_CONFIGURATION.assemblyId);
  const deliveryReset = !deliveryValid && catalog.deliveryMethods.some((d) => d.id === DEFAULT_CONFIGURATION.deliveryId);

  const removedAccessoryIds: string[] = [];
  const accessories = config.accessories.filter((selection) => {
    const stillExists = catalog.accessories.some((a) => a.id === selection.accessoryId);
    if (!stillExists) removedAccessoryIds.push(selection.accessoryId);
    return stillExists;
  });

  const changed = colorReset || assemblyReset || deliveryReset || removedAccessoryIds.length > 0;
  if (!changed) {
    return { config, changed: false, removedAccessoryIds: [], colorReset: false, assemblyReset: false, deliveryReset: false };
  }

  return {
    config: {
      ...config,
      colorId: colorReset ? DEFAULT_CONFIGURATION.colorId : config.colorId,
      assemblyId: assemblyReset ? DEFAULT_CONFIGURATION.assemblyId : config.assemblyId,
      deliveryId: deliveryReset ? DEFAULT_CONFIGURATION.deliveryId : config.deliveryId,
      accessories,
    },
    changed: true,
    removedAccessoryIds,
    colorReset,
    assemblyReset,
    deliveryReset,
  };
}
