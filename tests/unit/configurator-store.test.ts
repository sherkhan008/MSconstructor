// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIGURATION,
  MAX_SECTIONS,
  MIN_SECTIONS,
  CONFIGURATOR_STATE_VERSION,
  migrateConfiguratorState,
  readPersistedConfiguratorState,
  useConfiguratorStore,
} from '@/store/configurator-store';
import { isValidMsStandardConfiguration } from '@/lib/pricing/ms-standard-compatibility';
import { shelvingConfigurationSchema } from '@/lib/pricing/schema';
import { LEGACY_MAX_SECTIONS } from '@/lib/configurator/limits';

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

  it('addSection never exceeds the maximum of 5 sections', () => {
    const { addSection } = useConfiguratorStore.getState();
    for (let i = 0; i < 20; i += 1) addSection();
    expect(MAX_SECTIONS).toBe(5);
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

  it('duplicateSection copies wall selections and width, not the id (V2.1 behaviour kept)', () => {
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

describe('configurator store — per-section height and shelves (V2.2A)', () => {
  beforeEach(resetStore);

  it('DEFAULT_CONFIGURATION: the section owns width/height/shelves, no row-level values', () => {
    expect(DEFAULT_CONFIGURATION).not.toHaveProperty('height');
    expect(DEFAULT_CONFIGURATION).not.toHaveProperty('shelves');
    expect(DEFAULT_CONFIGURATION.sections).toHaveLength(1);
    const [section] = DEFAULT_CONFIGURATION.sections;
    expect(section).toMatchObject({ width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false });
    expect(isValidMsStandardConfiguration(DEFAULT_CONFIGURATION)).toEqual([]);
    expect(shelvingConfigurationSchema.safeParse(DEFAULT_CONFIGURATION).success).toBe(true);
  });

  it('addSection copies the template section’s width, height and shelves (walls start off)', () => {
    const id = useConfiguratorStore.getState().config.sections[0].id;
    useConfiguratorStore.getState().updateSection(id, { width: 700, height: 1500, shelves: 6, rearWall: true });
    useConfiguratorStore.getState().addSection();
    const [, added] = useConfiguratorStore.getState().config.sections;
    expect(added).toMatchObject({ width: 700, height: 1500, shelves: 6, rearWall: false, leftWall: false, rightWall: false });
    expect(added.id).not.toBe(id);
  });

  it('addSection copies from the ACTIVE section, not always the first', () => {
    const { addSection, updateSection } = useConfiguratorStore.getState();
    addSection();
    const second = useConfiguratorStore.getState().config.sections[1];
    updateSection(second.id, { height: 3000, shelves: 8 });
    useConfiguratorStore.getState().setActiveSectionId(second.id);
    useConfiguratorStore.getState().addSection();
    const third = useConfiguratorStore.getState().config.sections[2];
    expect([third.height, third.shelves]).toEqual([3000, 8]);
  });

  it('duplicateSection copies width, height, shelves and walls with a new id', () => {
    const id = useConfiguratorStore.getState().config.sections[0].id;
    useConfiguratorStore.getState().updateSection(id, { width: 1200, height: 1000, shelves: 3, leftWall: true });
    useConfiguratorStore.getState().duplicateSection(id);
    const [original, copy] = useConfiguratorStore.getState().config.sections;
    const { id: _a, ...originalRest } = original;
    const { id: _b, ...copyRest } = copy;
    expect(copyRest).toEqual(originalRest);
    expect(copy.id).not.toBe(original.id);
  });

  it('no action creates a sixth section', () => {
    const state = () => useConfiguratorStore.getState();
    for (let i = 0; i < 10; i += 1) state().addSection();
    for (let i = 0; i < 10; i += 1) state().duplicateSection(state().config.sections[0].id);
    expect(state().config.sections).toHaveLength(MAX_SECTIONS);
  });

  it('setAllSectionHeights applies one height to every section (transitional single control)', () => {
    const { addSection, setAllSectionHeights } = useConfiguratorStore.getState();
    addSection();
    addSection();
    setAllSectionHeights(2500);
    expect(useConfiguratorStore.getState().config.sections.map((s) => s.height)).toEqual([2500, 2500, 2500]);
    expect(useConfiguratorStore.getState().config).not.toHaveProperty('height');
  });

  it('setAllSectionShelves applies one count, never above each section’s own height ceiling', () => {
    const { addSection, updateSection, setAllSectionShelves } = useConfiguratorStore.getState();
    addSection();
    const [a, b] = useConfiguratorStore.getState().config.sections;
    updateSection(a.id, { height: 1000, shelves: 4 });
    updateSection(b.id, { height: 3000, shelves: 4 });
    setAllSectionShelves(7);
    // 1000 mm keeps its own ceiling (4); it never borrows 3000 mm's 8.
    expect(useConfiguratorStore.getState().config.sections.map((s) => s.shelves)).toEqual([4, 7]);
    expect(useConfiguratorStore.getState().config).not.toHaveProperty('shelves');
  });
});

function v3State(overrides: Record<string, unknown> = {}) {
  return { config: { ...DEFAULT_CONFIGURATION, ...overrides }, activeSectionId: DEFAULT_CONFIGURATION.sections[0].id };
}

describe('configurator store — persisted state policy (v3)', () => {
  it('uses version 3', () => {
    expect(CONFIGURATOR_STATE_VERSION).toBe(3);
  });

  it('round-trips a current v3 state unchanged', () => {
    const sections = [
      { id: 'p', width: 700, height: 1500, shelves: 4, rearWall: true, leftWall: false, rightWall: false },
      { id: 'q', width: 1000, height: 1500, shelves: 4, rearWall: false, leftWall: false, rightWall: true },
    ];
    const stored = JSON.parse(JSON.stringify({ config: { ...DEFAULT_CONFIGURATION, depth: 500, sections }, activeSectionId: 'q' }));
    const loaded = readPersistedConfiguratorState(stored);
    expect(loaded).toEqual(stored);
    expect(migrateConfiguratorState(stored, 3)).toEqual(stored);
  });

  it('keeps a valid activeSectionId and repairs a stale one', () => {
    expect(readPersistedConfiguratorState({ ...v3State(), activeSectionId: 'gone' }).activeSectionId).toBe(
      DEFAULT_CONFIGURATION.sections[0].id,
    );
  });

  it('MIGRATES a V2.1 (v2) state: its row-level height/shelves are copied into every section', () => {
    const v2 = {
      config: {
        ...DEFAULT_CONFIGURATION,
        height: 2500,
        shelves: 6,
        depth: 600,
        sections: [
          { id: 'a', width: 1000, rearWall: true, leftWall: false, rightWall: false },
          { id: 'b', width: 700, rearWall: false, leftWall: false, rightWall: true },
        ],
      },
      activeSectionId: 'b',
    };
    const migrated = migrateConfiguratorState(v2, 2);
    expect(migrated.config).not.toHaveProperty('height');
    expect(migrated.config).not.toHaveProperty('shelves');
    expect(migrated.config.depth).toBe(600);
    expect(migrated.config.sections).toEqual([
      { id: 'a', width: 1000, height: 2500, shelves: 6, rearWall: true, leftWall: false, rightWall: false },
      { id: 'b', width: 700, height: 2500, shelves: 6, rearWall: false, leftWall: false, rightWall: true },
    ]);
    expect(migrated.activeSectionId).toBe('b');
  });

  it('keeps a V2.1 row of 6–10 sections intact (shown as over the limit, never truncated)', () => {
    const sections = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, width: 1000, rearWall: false, leftWall: false, rightWall: false }));
    const migrated = migrateConfiguratorState({ config: { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections } }, 2);
    expect(migrated.config.sections).toHaveLength(8);
    expect(migrated.config.sections.length).toBeGreaterThan(MAX_SECTIONS);
    expect(migrated.config.sections.length).toBeLessThanOrEqual(LEGACY_MAX_SECTIONS);
  });

  it('RESETS a malformed V2.1 state instead of guessing', () => {
    for (const config of [
      { ...DEFAULT_CONFIGURATION, height: 'tall', shelves: 5 },
      { ...DEFAULT_CONFIGURATION, height: 2000 },
      { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections: 'garbage' },
      { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections: [{ id: 'a', width: -1, rearWall: false, leftWall: false, rightWall: false }] },
    ]) {
      expect(migrateConfiguratorState({ config }, 2).config).toBe(DEFAULT_CONFIGURATION);
    }
  });

  it('RESETS a pre-sections v1 / unversioned state to the default', () => {
    const legacy = { config: { modelSlug: 'ms-standard', height: 2200, width: 1200, depth: 500, shelves: 4, sections: 3 }, step: 3 };
    expect(migrateConfiguratorState(legacy, 1).config).toBe(DEFAULT_CONFIGURATION);
    expect(migrateConfiguratorState(legacy, 0).config).toBe(DEFAULT_CONFIGURATION);
  });

  it('RESETS a malformed current-version state (merge runs on every hydration)', () => {
    const bad = [
      null,
      undefined,
      'not an object',
      { nonsense: true },
      v3State({ sections: [] }),
      v3State({ sections: [{ id: 'a', width: 1000, rearWall: false, leftWall: false, rightWall: false }] }), // no height/shelves
      v3State({ sections: [{ ...DEFAULT_CONFIGURATION.sections[0], height: 2000.5 }] }),
      v3State({ sections: [{ ...DEFAULT_CONFIGURATION.sections[0], shelves: '5' }] }),
      v3State({ sections: [DEFAULT_CONFIGURATION.sections[0], DEFAULT_CONFIGURATION.sections[0]] }), // duplicate ids
      v3State({ height: 2000 }), // a stale row-level value is not silently mixed in
      v3State({ depth: null }),
      v3State({ accessories: 'x' }),
      v3State({ accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 7 }] }),
      v3State({ metalFootPad: 'yes' }),
      v3State({ promoCode: 42 }),
    ];
    for (const state of bad) {
      expect(() => migrateConfiguratorState(state, 3)).not.toThrow();
      expect(readPersistedConfiguratorState(state).config).toBe(DEFAULT_CONFIGURATION);
    }
  });
});
