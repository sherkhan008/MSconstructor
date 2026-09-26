import type { ShelvingConfiguration } from '@/lib/types/domain';
import { selectActiveSectionId, selectConfig, singleKitWorkspace, useConfiguratorStore } from '@/store/configurator-store';

/**
 * Test helpers for the V2.5 configurator workspace. Most configurator tests
 * exercise one kit: `loadSingleKit` puts exactly that configuration (ids
 * kept) into a one-kit workspace, and `activeConfig`/`activeSectionIdOf`
 * read the active kit the same way the components do (the store's own
 * selectors).
 */
export function loadSingleKit(config: ShelvingConfiguration, activeSectionId: string = config.sections[0].id) {
  useConfiguratorStore.setState({ ...singleKitWorkspace(config, activeSectionId, 'kit-1'), kitPrices: {} });
}

export const activeConfig = (): ShelvingConfiguration => selectConfig(useConfiguratorStore.getState());
export const activeSectionIdOf = (): string => selectActiveSectionId(useConfiguratorStore.getState());
