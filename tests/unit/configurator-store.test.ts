// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIGURATION,
  MAX_SECTIONS,
  MIN_SECTIONS,
  migrateConfiguratorState,
  useConfiguratorStore,
} from '@/store/configurator-store';

function resetStore() {
  useConfiguratorStore.setState({
    config: DEFAULT_CONFIGURATION,
    activeSectionId: DEFAULT_CONFIGURATION.sections[0].id,
    priceResult: null,
    pricingError: null,
  });
}

describe('configurator store — section actions', () => {
  beforeEach(resetStore);

  it('starts with exactly one section', () => {
    expect(useConfiguratorStore.getState().config.sections.length).toBe(1);
  });

  it('addSection inserts a new section after the active one and selects it', () => {
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    const state = useConfiguratorStore.getState();
    expect(state.config.sections.length).toBe(2);
    expect(state.activeSectionId).toBe(state.config.sections[1].id);
  });

  it('addSection never exceeds the maximum of 10 sections', () => {
    const { addSection } = useConfiguratorStore.getState();
    for (let i = 0; i < 20; i += 1) addSection();
    expect(useConfiguratorStore.getState().config.sections.length).toBe(MAX_SECTIONS);
  });

  it('addSection reuses the active section\'s width when it is still compatible with the current depth', () => {
    useConfiguratorStore.setState((state) => ({ config: { ...state.config, depth: 400 } }));
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    const state = useConfiguratorStore.getState();
    expect(state.config.sections[1].width).toBe(state.config.sections[0].width);
  });

  it('addSection falls back to a depth-compatible width if the template width would otherwise be invalid (defensive)', () => {
    // Force an inconsistent state directly (bypassing normal UI/normalization
    // paths) to exercise addSection's own defensive guard: depth=700 only
    // supports width 1000, but the template section is 1200mm.
    useConfiguratorStore.setState((state) => ({
      config: { ...state.config, depth: 700, sections: [{ ...state.config.sections[0], width: 1200 }] },
    }));
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    const state = useConfiguratorStore.getState();
    expect(state.config.sections[1].width).toBe(1000);
  });

  it('removeSection never drops below the minimum of 1 section', () => {
    const { removeSection } = useConfiguratorStore.getState();
    const onlyId = useConfiguratorStore.getState().config.sections[0].id;
    removeSection(onlyId);
    expect(useConfiguratorStore.getState().config.sections.length).toBe(MIN_SECTIONS);
  });

  it('removeSection re-selects a neighboring section when the active one is removed', () => {
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    addSection();
    const sections = useConfiguratorStore.getState().config.sections;
    expect(sections.length).toBe(3);
    const middleId = sections[1].id;
    useConfiguratorStore.getState().setActiveSectionId(middleId);
    useConfiguratorStore.getState().removeSection(middleId);
    const state = useConfiguratorStore.getState();
    expect(state.config.sections.length).toBe(2);
    expect(state.config.sections.some((s) => s.id === middleId)).toBe(false);
    expect(state.config.sections.some((s) => s.id === state.activeSectionId)).toBe(true);
  });

  it('updateSection changes only the targeted section', () => {
    const { addSection, updateSection } = useConfiguratorStore.getState();
    addSection();
    const [first, second] = useConfiguratorStore.getState().config.sections;
    updateSection(second.id, { width: 1500, rearWall: true });
    const state = useConfiguratorStore.getState();
    expect(state.config.sections.find((s) => s.id === second.id)?.width).toBe(1500);
    expect(state.config.sections.find((s) => s.id === second.id)?.rearWall).toBe(true);
    expect(state.config.sections.find((s) => s.id === first.id)?.width).toBe(first.width);
  });

  it('duplicateSection copies wall selections and width, not the id', () => {
    const { updateSection, duplicateSection } = useConfiguratorStore.getState();
    const originalId = useConfiguratorStore.getState().config.sections[0].id;
    updateSection(originalId, { width: 1200, leftWall: true });
    duplicateSection(originalId);
    const state = useConfiguratorStore.getState();
    expect(state.config.sections.length).toBe(2);
    expect(state.config.sections[1].id).not.toBe(originalId);
    expect(state.config.sections[1].width).toBe(1200);
    expect(state.config.sections[1].leftWall).toBe(true);
  });
});

describe('configurator store — persistence migration', () => {
  it('migrates a legacy v1 state (global width + section count) into per-section widths', () => {
    const legacy = {
      config: {
        modelSlug: 'ms-standard',
        configurationType: 'STARTER_WITH_EXTENSIONS',
        height: 2200,
        width: 1200,
        depth: 500,
        shelves: 4,
        sections: 3,
        loadCapacity: 150,
        shelfType: 'STANDARD',
        colorId: 'color-grey',
        rear: 'CROSS_BRACE',
        side: 'NONE',
        accessories: [],
        assemblyId: 'assembly-self',
        deliveryId: 'delivery-pickup',
        quantity: 1,
      },
      step: 3,
    };

    const migrated = migrateConfiguratorState(legacy, 1);
    expect(migrated.config.sections.length).toBe(3);
    expect(migrated.config.sections.every((s) => s.width === 1200)).toBe(true);
    expect(migrated.config.height).toBe(2200);
    expect(migrated.config.depth).toBe(500);
    expect(migrated.activeSectionId).toBe(migrated.config.sections[0].id);
    // Legacy-only fields must not leak into the new shape.
    expect('width' in migrated.config).toBe(false);
    expect('rear' in migrated.config).toBe(false);
    expect('configurationType' in migrated.config).toBe(false);
  });

  it('caps a legacy section count at the new maximum instead of crashing', () => {
    const legacy = { config: { width: 1000, sections: 25 } };
    const migrated = migrateConfiguratorState(legacy, 1);
    expect(migrated.config.sections.length).toBe(MAX_SECTIONS);
  });

  it('falls back to the default configuration for garbage persisted state rather than throwing', () => {
    expect(() => migrateConfiguratorState(null, 1)).not.toThrow();
    expect(() => migrateConfiguratorState(undefined, 1)).not.toThrow();
    expect(() => migrateConfiguratorState('not an object', 1)).not.toThrow();
    expect(() => migrateConfiguratorState({ config: { sections: 'garbage' } }, 1)).not.toThrow();

    const migrated = migrateConfiguratorState({ nonsense: true }, 1);
    expect(migrated.config.sections.length).toBeGreaterThanOrEqual(1);
  });

  it('is a no-op for an already-current v2 state', () => {
    const current = { config: DEFAULT_CONFIGURATION, activeSectionId: DEFAULT_CONFIGURATION.sections[0].id };
    const migrated = migrateConfiguratorState(current, 2);
    expect(migrated.config.sections.length).toBe(1);
    expect(migrated.activeSectionId).toBe(DEFAULT_CONFIGURATION.sections[0].id);
  });

  it('repairs a v2 state whose activeSectionId no longer matches any section', () => {
    const stale = { config: DEFAULT_CONFIGURATION, activeSectionId: 'does-not-exist' };
    const migrated = migrateConfiguratorState(stale, 2);
    expect(migrated.activeSectionId).toBe(migrated.config.sections[0].id);
  });
});
