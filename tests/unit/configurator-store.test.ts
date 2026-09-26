// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIGURATION,
  MAX_SECTIONS,
  MIN_SECTIONS,
  CONFIGURATOR_STATE_VERSION,
  MAX_WORKSPACE_KITS,
  migrateConfiguratorState,
  readPersistedConfiguratorState,
  selectActiveSectionId,
  selectConfig,
  useConfiguratorStore,
} from '@/store/configurator-store';
import { getWorkspaceRackCount, type ConfiguratorWorkspace } from '@/lib/configurator/workspace';
import { isValidMsStandardConfiguration } from '@/lib/pricing/ms-standard-compatibility';
import { shelvingConfigurationSchema } from '@/lib/pricing/schema';
import { LEGACY_MAX_SECTIONS } from '@/lib/configurator/limits';
import { activeConfig, activeSectionIdOf, loadSingleKit } from '../helpers/workspace';

function resetStore() {
  loadSingleKit(DEFAULT_CONFIGURATION);
}

describe('configurator store — section actions', () => {
  beforeEach(resetStore);

  it('starts with exactly one section', () => {
    expect(activeConfig().sections.length).toBe(1);
  });

  it('addSection inserts a new section after the active one and selects it', () => {
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    const state = useConfiguratorStore.getState();
    expect(selectConfig(state).sections.length).toBe(2);
    expect(selectActiveSectionId(state)).toBe(selectConfig(state).sections[1].id);
  });

  it('addSection never exceeds the maximum of 5 sections', () => {
    const { addSection } = useConfiguratorStore.getState();
    for (let i = 0; i < 20; i += 1) addSection();
    expect(MAX_SECTIONS).toBe(5);
    expect(activeConfig().sections.length).toBe(MAX_SECTIONS);
  });

  it('addSection reuses the active section\'s width when it is still compatible with the current depth', () => {
    useConfiguratorStore.getState().setMany({ depth: 400 });
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    const state = useConfiguratorStore.getState();
    expect(selectConfig(state).sections[1].width).toBe(selectConfig(state).sections[0].width);
  });

  it('addSection falls back to a depth-compatible width if the template width would otherwise be invalid (defensive)', () => {
    // Force an inconsistent state directly (bypassing normal UI/normalization
    // paths) to exercise addSection's own defensive guard: depth=700 only
    // supports width 1000, but the template section is 1200mm.
    loadSingleKit({ ...DEFAULT_CONFIGURATION, depth: 700, sections: [{ ...DEFAULT_CONFIGURATION.sections[0], width: 1200 }] });
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    const state = useConfiguratorStore.getState();
    expect(selectConfig(state).sections[1].width).toBe(1000);
  });

  it('removeSection never drops below the minimum of 1 section', () => {
    const { removeSection } = useConfiguratorStore.getState();
    const onlyId = activeConfig().sections[0].id;
    removeSection(onlyId);
    expect(activeConfig().sections.length).toBe(MIN_SECTIONS);
  });

  it('removeSection re-selects a neighboring section when the active one is removed', () => {
    const { addSection } = useConfiguratorStore.getState();
    addSection();
    addSection();
    const sections = activeConfig().sections;
    expect(sections.length).toBe(3);
    const middleId = sections[1].id;
    useConfiguratorStore.getState().setActiveSectionId(middleId);
    useConfiguratorStore.getState().removeSection(middleId);
    const state = useConfiguratorStore.getState();
    expect(selectConfig(state).sections.length).toBe(2);
    expect(selectConfig(state).sections.some((s) => s.id === middleId)).toBe(false);
    expect(selectConfig(state).sections.some((s) => s.id === selectActiveSectionId(state))).toBe(true);
  });

  it('updateSection changes only the targeted section', () => {
    const { addSection, updateSection } = useConfiguratorStore.getState();
    addSection();
    const [first, second] = activeConfig().sections;
    updateSection(second.id, { width: 1500, rearWall: true });
    const state = useConfiguratorStore.getState();
    expect(selectConfig(state).sections.find((s) => s.id === second.id)?.width).toBe(1500);
    expect(selectConfig(state).sections.find((s) => s.id === second.id)?.rearWall).toBe(true);
    expect(selectConfig(state).sections.find((s) => s.id === first.id)?.width).toBe(first.width);
  });

  it('duplicateSection copies wall selections and width, not the id (V2.1 behaviour kept)', () => {
    const { updateSection, duplicateSection } = useConfiguratorStore.getState();
    const originalId = activeConfig().sections[0].id;
    updateSection(originalId, { width: 1200, leftWall: true });
    duplicateSection(originalId);
    const state = useConfiguratorStore.getState();
    expect(selectConfig(state).sections.length).toBe(2);
    expect(selectConfig(state).sections[1].id).not.toBe(originalId);
    expect(selectConfig(state).sections[1].width).toBe(1200);
    expect(selectConfig(state).sections[1].leftWall).toBe(true);
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
    const id = activeConfig().sections[0].id;
    useConfiguratorStore.getState().updateSection(id, { width: 700, height: 1500, shelves: 6, rearWall: true });
    useConfiguratorStore.getState().addSection();
    const [, added] = activeConfig().sections;
    expect(added).toMatchObject({ width: 700, height: 1500, shelves: 6, rearWall: false, leftWall: false, rightWall: false });
    expect(added.id).not.toBe(id);
  });

  it('addSection copies from the ACTIVE section, not always the first', () => {
    const { addSection, updateSection } = useConfiguratorStore.getState();
    addSection();
    const second = activeConfig().sections[1];
    updateSection(second.id, { height: 3000, shelves: 8 });
    useConfiguratorStore.getState().setActiveSectionId(second.id);
    useConfiguratorStore.getState().addSection();
    const third = activeConfig().sections[2];
    expect([third.height, third.shelves]).toEqual([3000, 8]);
  });

  it('duplicateSection copies width, height, shelves and walls with a new id', () => {
    const id = activeConfig().sections[0].id;
    useConfiguratorStore.getState().updateSection(id, { width: 1200, height: 1000, shelves: 3, leftWall: true });
    useConfiguratorStore.getState().duplicateSection(id);
    const [original, copy] = activeConfig().sections;
    const { id: _a, ...originalRest } = original;
    const { id: _b, ...copyRest } = copy;
    expect(copyRest).toEqual(originalRest);
    expect(copy.id).not.toBe(original.id);
  });

  it('no action creates a sixth section', () => {
    const state = () => useConfiguratorStore.getState();
    for (let i = 0; i < 10; i += 1) state().addSection();
    for (let i = 0; i < 10; i += 1) state().duplicateSection(selectConfig(state()).sections[0].id);
    expect(selectConfig(state()).sections).toHaveLength(MAX_SECTIONS);
  });

  it('has no action that edits every section at once (V2.4)', () => {
    const state = useConfiguratorStore.getState() as unknown as Record<string, unknown>;
    expect(state).not.toHaveProperty('setAllSectionHeights');
    expect(state).not.toHaveProperty('setAllSectionShelves');
  });

  it('changing one section’s height leaves every other section untouched', () => {
    const { addSection, updateSection } = useConfiguratorStore.getState();
    addSection();
    addSection();
    const [a, b, c] = activeConfig().sections;
    updateSection(b.id, { height: 2500 });
    expect(activeConfig().sections.map((s) => s.height)).toEqual([a.height, 2500, c.height]);
    expect(activeConfig()).not.toHaveProperty('height');
  });

  it('changing one section’s shelves leaves every other section untouched', () => {
    const { addSection, updateSection } = useConfiguratorStore.getState();
    addSection();
    const [a, b] = activeConfig().sections;
    updateSection(a.id, { height: 1500, shelves: 4 });
    updateSection(b.id, { height: 2500, shelves: 8 });
    updateSection(a.id, { shelves: 3 });
    expect(activeConfig().sections.map((s) => [s.height, s.shelves])).toEqual([
      [1500, 3],
      [2500, 8],
    ]);
    expect(activeConfig()).not.toHaveProperty('shelves');
  });
});

function v3State(overrides: Record<string, unknown> = {}) {
  return { config: { ...DEFAULT_CONFIGURATION, ...overrides }, activeSectionId: DEFAULT_CONFIGURATION.sections[0].id };
}

function v4Kit(id: string, overrides: Record<string, unknown> = {}, sectionIds = [`${id}-s0`]) {
  const sections = sectionIds.map((sid) => ({ ...DEFAULT_CONFIGURATION.sections[0], id: sid }));
  return { id, configuration: { ...DEFAULT_CONFIGURATION, sections, ...overrides }, activeSectionId: sectionIds[0] };
}

/** The one kit of a migrated one-kit workspace. */
function onlyKit(workspace: ConfiguratorWorkspace) {
  expect(workspace.kits).toHaveLength(1);
  expect(workspace.activeKitId).toBe(workspace.kits[0].id);
  return workspace.kits[0];
}

/** A reset workspace: one kit holding DEFAULT_CONFIGURATION itself. */
function expectDefault(workspace: ConfiguratorWorkspace) {
  expect(onlyKit(workspace).configuration).toBe(DEFAULT_CONFIGURATION);
}

describe('configurator store — persisted state policy (v4 workspace)', () => {
  it('uses version 4 and persists only the kits and the active kit', () => {
    expect(CONFIGURATOR_STATE_VERSION).toBe(4);
    loadSingleKit(DEFAULT_CONFIGURATION);
    const persisted = useConfiguratorStore.persist.getOptions().partialize!(useConfiguratorStore.getState());
    expect(Object.keys(persisted as object).sort()).toEqual(['activeKitId', 'kits']);
  });

  it('round-trips a current v4 workspace unchanged: kits, order, active kit, active section per kit', () => {
    const stored = JSON.parse(
      JSON.stringify({
        kits: [
          { ...v4Kit('k-a', { depth: 500, quantity: 2 }, ['a0', 'a1', 'a2']), activeSectionId: 'a2' },
          { ...v4Kit('k-b', { accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'b0' }] }, ['b0']) },
        ],
        activeKitId: 'k-b',
      }),
    );
    expect(readPersistedConfiguratorState(stored)).toEqual(stored);
    expect(migrateConfiguratorState(stored, 4)).toEqual(stored);
  });

  it('repairs only UI pointers: a stale active kit → the first kit, a stale active section → that kit’s first section', () => {
    const loaded = readPersistedConfiguratorState({ kits: [{ ...v4Kit('k-a'), activeSectionId: 'gone' }, v4Kit('k-b')], activeKitId: 'gone' });
    expect(loaded.activeKitId).toBe('k-a');
    expect(loaded.kits[0].activeSectionId).toBe('k-a-s0');
  });

  it('keeps a workspace over the physical-rack limit as it was (shown blocked, never clamped)', () => {
    const loaded = readPersistedConfiguratorState({ kits: [v4Kit('k-a', { quantity: 3 }), v4Kit('k-b', { quantity: 3 })], activeKitId: 'k-a' });
    expect(loaded.kits.map((k) => k.configuration.quantity)).toEqual([3, 3]);
  });

  it('MIGRATES the V2.4 (v3) draft losslessly into a one-kit workspace', () => {
    const sections = [
      { id: 'p', width: 700, height: 1500, shelves: 4, rearWall: true, leftWall: false, rightWall: false },
      { id: 'q', width: 1000, height: 2500, shelves: 8, rearWall: false, leftWall: false, rightWall: true },
    ];
    const config = {
      ...DEFAULT_CONFIGURATION,
      depth: 500,
      quantity: 2,
      sections,
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'q' }],
      metalFootPad: true,
    };
    const stored = JSON.parse(JSON.stringify({ config, activeSectionId: 'q' }));
    const kit = onlyKit(migrateConfiguratorState(stored, 3));
    expect(kit.configuration).toEqual(stored.config);
    expect(kit.activeSectionId).toBe('q');
    expect(typeof kit.id).toBe('string');
    expect(kit.configuration).not.toHaveProperty('kits');
  });

  it('a migrated v3 draft keeps a valid activeSectionId and repairs a stale one', () => {
    expect(onlyKit(migrateConfiguratorState({ ...v3State(), activeSectionId: 'gone' }, 3)).activeSectionId).toBe(
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
    const kit = onlyKit(migrateConfiguratorState(v2, 2));
    expect(kit.configuration).not.toHaveProperty('height');
    expect(kit.configuration).not.toHaveProperty('shelves');
    expect(kit.configuration.depth).toBe(600);
    expect(kit.configuration.sections).toEqual([
      { id: 'a', width: 1000, height: 2500, shelves: 6, rearWall: true, leftWall: false, rightWall: false },
      { id: 'b', width: 700, height: 2500, shelves: 6, rearWall: false, leftWall: false, rightWall: true },
    ]);
    expect(kit.activeSectionId).toBe('b');
  });

  it('keeps a V2.1 row of 6–10 sections intact (shown as over the limit, never truncated)', () => {
    const sections = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, width: 1000, rearWall: false, leftWall: false, rightWall: false }));
    const kit = onlyKit(migrateConfiguratorState({ config: { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections } }, 2));
    expect(kit.configuration.sections).toHaveLength(8);
    expect(kit.configuration.sections.length).toBeGreaterThan(MAX_SECTIONS);
    expect(kit.configuration.sections.length).toBeLessThanOrEqual(LEGACY_MAX_SECTIONS);
  });

  it('RESETS a malformed V2.1 state instead of guessing', () => {
    for (const config of [
      { ...DEFAULT_CONFIGURATION, height: 'tall', shelves: 5 },
      { ...DEFAULT_CONFIGURATION, height: 2000 },
      { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections: 'garbage' },
      { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections: [{ id: 'a', width: -1, rearWall: false, leftWall: false, rightWall: false }] },
    ]) {
      expectDefault(migrateConfiguratorState({ config }, 2));
    }
  });

  it('RESETS a pre-sections v1 / unversioned state to the default', () => {
    const legacy = { config: { modelSlug: 'ms-standard', height: 2200, width: 1200, depth: 500, shelves: 4, sections: 3 }, step: 3 };
    expectDefault(migrateConfiguratorState(legacy, 1));
    expectDefault(migrateConfiguratorState(legacy, 0));
  });

  it('RESETS a malformed V2.4 (v3) draft', () => {
    for (const state of [null, { nonsense: true }, v3State({ sections: [] }), v3State({ height: 2000 }), v3State({ accessories: 'x' })]) {
      expect(() => migrateConfiguratorState(state, 3)).not.toThrow();
      expectDefault(migrateConfiguratorState(state, 3));
    }
  });

  it('RESETS a malformed current-version workspace (merge runs on every hydration)', () => {
    const kit = (overrides: Record<string, unknown>) => ({ kits: [v4Kit('k-a', overrides)], activeKitId: 'k-a' });
    const bad = [
      null,
      undefined,
      'not an object',
      { nonsense: true },
      v3State(), // a V2.4 single-configuration draft is not a v4 workspace
      { kits: [], activeKitId: 'x' },
      { kits: 'x', activeKitId: 'x' },
      { kits: [null], activeKitId: 'x' },
      { kits: Array.from({ length: 6 }, (_, i) => v4Kit(`k${i}`)), activeKitId: 'k0' }, // more than 5 kits
      { kits: [v4Kit('same'), v4Kit('same', {}, ['other'])], activeKitId: 'same' }, // duplicate kit ids
      { kits: [v4Kit('k-a', {}, ['shared']), v4Kit('k-b', {}, ['shared'])], activeKitId: 'k-a' }, // section id in two kits
      { kits: [{ id: '', configuration: DEFAULT_CONFIGURATION, activeSectionId: 'x' }], activeKitId: '' },
      kit({ sections: [] }),
      kit({ sections: [{ id: 'a', width: 1000, rearWall: false, leftWall: false, rightWall: false }] }), // no height/shelves
      kit({ sections: [{ ...DEFAULT_CONFIGURATION.sections[0], height: 2000.5 }] }),
      kit({ sections: [{ ...DEFAULT_CONFIGURATION.sections[0], shelves: '5' }] }),
      kit({ sections: [DEFAULT_CONFIGURATION.sections[0], DEFAULT_CONFIGURATION.sections[0]] }), // duplicate ids
      kit({ height: 2000 }), // a stale row-level value is not silently mixed in
      kit({ depth: null }),
      kit({ quantity: 0 }),
      kit({ quantity: 1.5 }),
      kit({ accessories: 'x' }),
      kit({ accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 7 }] }),
      kit({ metalFootPad: 'yes' }),
      kit({ promoCode: 42 }),
    ];
    for (const state of bad) {
      expect(() => migrateConfiguratorState(state, 4)).not.toThrow();
      expectDefault(readPersistedConfiguratorState(state));
    }
  });
});

describe('configurator workspace — kits', () => {
  beforeEach(() => loadSingleKit(DEFAULT_CONFIGURATION));
  const state = () => useConfiguratorStore.getState();
  const kitIds = () => state().kits.map((k) => k.id);
  const quantities = () => state().kits.map((k) => k.configuration.quantity);

  it('starts with one kit, active', () => {
    expect(state().kits).toHaveLength(1);
    expect(state().activeKitId).toBe(state().kits[0].id);
    expect(MAX_WORKSPACE_KITS).toBe(5);
  });

  it('addKit appends a DEFAULT_CONFIGURATION kit with fresh kit and section ids, and selects it', () => {
    const first = state().kits[0];
    state().updateSection(first.configuration.sections[0].id, { width: 1200, height: 2500, shelves: 7, rearWall: true });
    expect(state().addKit()).toEqual({ ok: true });
    const [a, b] = state().kits;
    expect(state().activeKitId).toBe(b.id);
    expect(b.id).not.toBe(a.id);
    const { sections: bSections, ...bRest } = b.configuration;
    const { sections: defaultSections, ...defaultRest } = DEFAULT_CONFIGURATION;
    expect(bRest).toEqual(defaultRest);
    expect(bSections.map(({ id: _id, ...rest }) => rest)).toEqual(defaultSections.map(({ id: _id, ...rest }) => rest));
    expect(bSections[0].id).not.toBe(a.configuration.sections[0].id);
    expect(bSections[0].id).not.toBe(DEFAULT_CONFIGURATION.sections[0].id);
    expect(b.activeSectionId).toBe(bSections[0].id);
    // The first kit is untouched.
    expect(a.configuration.sections[0]).toMatchObject({ width: 1200, height: 2500, shelves: 7, rearWall: true });
  });

  it('switching kits restores each kit’s exact configuration', () => {
    state().setField('depth', 500);
    state().addKit();
    state().setField('loadCapacity', 100);
    const [a, b] = kitIds();
    state().selectKit(a);
    expect(activeConfig().depth).toBe(500);
    expect(activeConfig().loadCapacity).toBe(DEFAULT_CONFIGURATION.loadCapacity);
    state().selectKit(b);
    expect(activeConfig().depth).toBe(DEFAULT_CONFIGURATION.depth);
    expect(activeConfig().loadCapacity).toBe(100);
  });

  it('edits change the active kit only (independent configurations)', () => {
    state().addKit();
    const [a, b] = state().kits;
    state().updateSection(b.configuration.sections[0].id, { height: 3000, shelves: 8 });
    state().addSection();
    state().setField('depth', 600);
    const after = useConfiguratorStore.getState().kits;
    expect(after[0]).toBe(a);
    expect(after[1].configuration.sections).toHaveLength(2);
    expect(after[1].configuration.depth).toBe(600);
    expect(after[1].configuration.sections[0]).toMatchObject({ height: 3000, shelves: 8 });
  });

  it('remembers the active section per kit (Kit 1 → section 3, Kit 2 → section 1, back to Kit 1 → section 3)', () => {
    state().addSection();
    state().addSection();
    const kit1Section3 = activeConfig().sections[2].id;
    state().setActiveSectionId(kit1Section3);
    state().addKit();
    state().addSection();
    const kit2Section1 = activeConfig().sections[0].id;
    state().setActiveSectionId(kit2Section1);
    const [a, b] = kitIds();
    state().selectKit(a);
    expect(activeSectionIdOf()).toBe(kit1Section3);
    state().selectKit(b);
    expect(activeSectionIdOf()).toBe(kit2Section1);
    state().selectKit(a);
    expect(activeSectionIdOf()).toBe(kit1Section3);
  });

  it('duplicateKit copies the whole configuration and active section with fresh kit/section ids, inserted after it', () => {
    const first = state().kits[0];
    state().updateSection(first.configuration.sections[0].id, { width: 1000, rearWall: true });
    state().duplicateSection(first.configuration.sections[0].id);
    const crossBraceTarget = activeConfig().sections[1].id;
    state().setMany({ accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: crossBraceTarget }], quantity: 2 });
    state().setActiveSectionId(crossBraceTarget);
    state().addKit(); // kit 2 — the duplicate of kit 1 goes between them
    state().selectKit(kitIds()[0]);
    expect(state().duplicateKit(kitIds()[0])).toEqual({ ok: true });

    const [source, copy, third] = state().kits;
    expect(state().activeKitId).toBe(copy.id);
    expect(third.configuration.sections[0].width).toBe(DEFAULT_CONFIGURATION.sections[0].width);
    const strip = (c: typeof source.configuration) => ({
      ...c,
      sections: c.sections.map(({ id: _id, ...rest }) => rest),
      accessories: c.accessories.map((a) => ({ ...a, sectionId: c.sections.findIndex((s) => s.id === a.sectionId) })),
    });
    expect(strip(copy.configuration)).toEqual(strip(source.configuration));
    const sourceIds = new Set(source.configuration.sections.map((s) => s.id));
    expect(copy.configuration.sections.some((s) => sourceIds.has(s.id))).toBe(false);
    // The section-scoped accessory follows its section's new id.
    expect(copy.configuration.accessories[0].sectionId).toBe(copy.configuration.sections[1].id);
    expect(copy.activeSectionId).toBe(copy.configuration.sections[1].id);
  });

  it('removeKit keeps at least one kit and selects a deterministic neighbour', () => {
    state().removeKit(kitIds()[0]);
    expect(state().kits).toHaveLength(1);
    state().addKit();
    state().addKit();
    const [a, b, c] = kitIds();
    state().selectKit(b);
    state().removeKit(b);
    expect(kitIds()).toEqual([a, c]);
    expect(state().activeKitId).toBe(c); // the kit that took its place
    state().removeKit(c);
    expect(state().activeKitId).toBe(a); // the new last kit
    state().addKit();
    const d = kitIds()[1];
    state().selectKit(a);
    state().removeKit(d); // removing a non-active kit keeps the selection
    expect(state().activeKitId).toBe(a);
  });

  it('never holds more than 5 kits: the sixth addKit / duplicateKit is refused and changes nothing', () => {
    for (let i = 0; i < 4; i += 1) expect(state().addKit()).toEqual({ ok: true });
    expect(state().kits).toHaveLength(5);
    const before = state().kits;
    expect(state().addKit()).toEqual({ ok: false, reason: 'KIT_COUNT_LIMIT' });
    expect(state().duplicateKit(kitIds()[0])).toEqual({ ok: false, reason: 'KIT_COUNT_LIMIT' });
    expect(state().kits).toBe(before);
  });

  it('5 kits × quantity 1 = 5 physical racks is allowed', () => {
    for (let i = 0; i < 4; i += 1) state().addKit();
    expect(quantities()).toEqual([1, 1, 1, 1, 1]);
    expect(getWorkspaceRackCount(state().kits)).toBe(5);
  });

  it('quantities 2 + 3 are allowed, 3 + 3 are refused', () => {
    state().addKit();
    const [a, b] = kitIds();
    expect(state().setKitQuantity(a, 2)).toEqual({ ok: true });
    expect(state().setKitQuantity(b, 3)).toEqual({ ok: true });
    expect(quantities()).toEqual([2, 3]);
    expect(state().setKitQuantity(a, 3)).toEqual({ ok: false, reason: 'RACK_LIMIT' });
    expect(quantities()).toEqual([2, 3]);
  });

  it('a quantity increase can never pass 5 racks — through setKitQuantity, setField or setMany', () => {
    const [a] = kitIds();
    expect(state().setKitQuantity(a, 5)).toEqual({ ok: true });
    expect(state().setKitQuantity(a, 6)).toEqual({ ok: false, reason: 'RACK_LIMIT' });
    state().setField('quantity', 9);
    state().setMany({ quantity: 7, depth: 500 });
    expect(quantities()).toEqual([5]);
    expect(activeConfig().depth).toBe(500); // the rest of the patch still applies
    // A decrease is always allowed.
    expect(state().setKitQuantity(a, 2)).toEqual({ ok: true });
    expect(quantities()).toEqual([2]);
  });

  it('adding or duplicating a kit is refused when its quantity would pass 5 racks', () => {
    const [a] = kitIds();
    state().setKitQuantity(a, 5);
    expect(state().addKit()).toEqual({ ok: false, reason: 'RACK_LIMIT' });
    state().setKitQuantity(a, 3);
    expect(state().duplicateKit(a)).toEqual({ ok: false, reason: 'RACK_LIMIT' });
    expect(state().kits).toHaveLength(1);
    state().setKitQuantity(a, 2);
    expect(state().duplicateKit(a)).toEqual({ ok: true });
    expect(quantities()).toEqual([2, 2]);
  });

  it('a workspace over the limit (e.g. from an old link) can only shrink', () => {
    loadSingleKit({ ...DEFAULT_CONFIGURATION, quantity: 7 });
    const [a] = kitIds();
    expect(state().setKitQuantity(a, 8)).toEqual({ ok: false, reason: 'RACK_LIMIT' });
    expect(state().addKit()).toEqual({ ok: false, reason: 'RACK_LIMIT' });
    expect(state().setKitQuantity(a, 6)).toEqual({ ok: true });
    expect(quantities()).toEqual([6]);
  });

  it('reset() resets the active kit only, with fresh section ids', () => {
    state().setField('depth', 500);
    state().addKit();
    state().setField('depth', 600);
    state().reset();
    const [a, b] = state().kits;
    expect(a.configuration.depth).toBe(500);
    expect(b.configuration.depth).toBe(DEFAULT_CONFIGURATION.depth);
    expect(b.configuration.sections[0].id).not.toBe(DEFAULT_CONFIGURATION.sections[0].id);
  });

  it('loadWorkspace replaces every kit from a link (fresh ids, active kit, defaults for missing values)', () => {
    state().addKit();
    state().loadWorkspace({
      kits: [{ depth: 500, quantity: 2 }, { loadCapacity: 100 }, { depth: 300 }],
      activeIndex: 1,
    });
    const kits = state().kits;
    expect(kits).toHaveLength(3);
    expect(state().activeKitId).toBe(kits[1].id);
    expect(kits.map((k) => [k.configuration.depth, k.configuration.quantity, k.configuration.loadCapacity])).toEqual([
      [500, 2, DEFAULT_CONFIGURATION.loadCapacity],
      [DEFAULT_CONFIGURATION.depth, 1, 100],
      [300, 1, DEFAULT_CONFIGURATION.loadCapacity],
    ]);
    const sectionIds = kits.flatMap((k) => k.configuration.sections.map((s) => s.id));
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    // Kit count outside 1…5 is ignored.
    const before = state().kits;
    state().loadWorkspace({ kits: [], activeIndex: 0 });
    state().loadWorkspace({ kits: Array.from({ length: 6 }, () => ({})), activeIndex: 0 });
    expect(state().kits).toBe(before);
  });

  it('selecting a kit, or a preview-only change, never changes any configuration', () => {
    state().addKit();
    const before = state().kits;
    state().selectKit(before[0].id);
    state().selectKit('unknown');
    expect(state().kits).toBe(before);
  });
});
