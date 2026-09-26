'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PriceFailure, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import { getAllowedWidthsForDepth, isValidMsStandardWidthDepth } from '@/lib/pricing/ms-standard-compatibility';
import { MAX_SECTIONS, MAX_WORKSPACE_KITS, MIN_SECTIONS, MIN_WORKSPACE_KITS } from '@/lib/configurator/limits';
import { readPersistedConfiguration, upgradeRowLevelConfiguration } from '@/lib/configurator/persisted-configuration';
import {
  canAddWorkspaceRacks,
  createKit,
  generateWorkspaceId,
  readPersistedWorkspace,
  withFreshSectionIds,
  type ConfiguratorKit,
  type ConfiguratorWorkspace,
} from '@/lib/configurator/workspace';
import type { WorkspaceLink } from '@/lib/configurator/url';

/**
 * Configurator UI state (V2.5 workspace). Holds up to MAX_WORKSPACE_KITS
 * independent kits — each one ShelvingConfiguration plus its own active
 * section (see src/lib/configurator/workspace.ts) — and which kit is active,
 * plus the *last server-calculated* price of every kit. The store never
 * computes a price itself; it only stores what useLivePrice's calls to
 * /api/pricing/calculate returned. See src/lib/pricing/engine.ts.
 *
 * Every V2.4 editing action (setField, updateSection, addSection, …) edits
 * the ACTIVE kit only; the workspace actions (addKit, duplicateKit,
 * removeKit, selectKit, setKitQuantity) manage the kits themselves. Read the
 * active kit through the exported selectors (selectConfig,
 * selectActiveSectionId, selectActiveKitPrice) — there is no second copy of
 * any kit's configuration.
 */

// Shared with the server schema — see src/lib/configurator/limits.ts. A
// configuration persisted before the limit dropped may hold more sections:
// it is kept as-is (addSection/duplicateSection refuse to grow it further,
// removeSection still works) and the server rejects it until it is reduced.
export { MAX_SECTIONS, MIN_SECTIONS, MAX_WORKSPACE_KITS, MIN_WORKSPACE_KITS };

/** A new section with the given dimensions and no wall panels. */
function makeSection(dimensions: Pick<ShelvingSection, 'width' | 'height' | 'shelves'>): ShelvingSection {
  return {
    id: generateWorkspaceId('sec'),
    width: dimensions.width,
    height: dimensions.height,
    shelves: dimensions.shelves,
    rearWall: false,
    leftWall: false,
    rightWall: false,
  };
}

/** Every section owns its width, height and shelves — there is no row-level
 * height/shelf count (V2.2A). Also the configuration of every kit added with
 * "+ Добавить комплект" (with fresh ids — see addKit). */
export const DEFAULT_CONFIGURATION: ShelvingConfiguration = {
  modelSlug: 'ms-standard',
  depth: 400,
  sections: [makeSection({ width: 1000, height: 2000, shelves: 5 })],
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId: 'delivery-pickup',
  quantity: 1,
  metalFootPad: false,
  shelfCornerBrackets: false,
};

/** The server's answer for one kit. `pricedJson` is the exact configuration
 * (JSON) that `result`/`error` answer: a result is current only while it
 * still equals the kit's configuration — see isKitPriceCurrent. */
export interface KitPriceState {
  result: PublicPriceResult | null;
  error: PriceFailure | null;
  pricedJson: string | null;
  isPricing: boolean;
}

export const EMPTY_KIT_PRICE: KitPriceState = { result: null, error: null, pricedJson: null, isPricing: false };

/** Why a workspace mutation was refused; the workspace is unchanged whenever `ok` is false. */
export type KitMutationResult =
  | { ok: true }
  | { ok: false; reason: 'KIT_COUNT_LIMIT' | 'RACK_LIMIT' | 'NOT_FOUND' };

interface ConfiguratorState extends ConfiguratorWorkspace {
  /** Last server answer per kit id (not persisted). */
  kitPrices: Record<string, KitPriceState>;
  hydrated: boolean;
  /** Bumped to force useLivePrice to retry after a failure without any configuration changing. */
  pricingRetryNonce: number;
  retryPricing: () => void;

  // Active-kit edits.
  setField: <K extends keyof ShelvingConfiguration>(key: K, value: ShelvingConfiguration[K]) => void;
  setMany: (patch: Partial<ShelvingConfiguration>) => void;
  setAccessoryQuantity: (accessoryId: string, quantity: number) => void;

  setActiveSectionId: (id: string) => void;
  addSection: () => void;
  removeSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  /** Changes one section only — every section owns its width, height,
   * shelves and walls; there is no action that edits all sections at once. */
  updateSection: (id: string, patch: Partial<Omit<ShelvingSection, 'id'>>) => void;
  setSectionWidth: (id: string, width: number) => void;
  /** Resets the ACTIVE kit to DEFAULT_CONFIGURATION (other kits untouched). */
  reset: () => void;

  // Workspace.
  selectKit: (id: string) => void;
  addKit: () => KitMutationResult;
  duplicateKit: (id: string) => KitMutationResult;
  removeKit: (id: string) => void;
  setKitQuantity: (id: string, quantity: number) => KitMutationResult;
  /** setMany for any kit by id (e.g. normalizing a kit that is not active). */
  patchKit: (id: string, patch: Partial<ShelvingConfiguration>) => void;
  /** Replaces the whole workspace with a shared link's kits (fresh ids). */
  loadWorkspace: (link: WorkspaceLink) => void;

  setKitPricing: (kitId: string, patch: Partial<KitPriceState>) => void;
  setHydrated: (value: boolean) => void;
}

export const CONFIGURATOR_STORAGE_KEY = 'ms-shelving-configurator';
/** Persisted draft version — see migrateConfiguratorState. */
export const CONFIGURATOR_STATE_VERSION = 4;

/** Store bounds for one kit's quantity — the same as the server schema and the cart. */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 200;

export function selectActiveKit(state: ConfiguratorWorkspace): ConfiguratorKit {
  return state.kits.find((k) => k.id === state.activeKitId) ?? state.kits[0];
}
export const selectConfig = (state: ConfiguratorWorkspace): ShelvingConfiguration => selectActiveKit(state).configuration;
export const selectActiveSectionId = (state: ConfiguratorWorkspace): string => selectActiveKit(state).activeSectionId;
export const selectActiveKitPrice = (state: ConfiguratorState): KitPriceState =>
  state.kitPrices[selectActiveKit(state).id] ?? EMPTY_KIT_PRICE;

/** True when `price` answers exactly this configuration and no newer request is pending. */
export function isKitPriceCurrent(price: KitPriceState, configuration: ShelvingConfiguration): boolean {
  return !price.isPricing && price.pricedJson === JSON.stringify(configuration);
}

/** A one-kit workspace holding `configuration` exactly as given (ids kept). */
export function singleKitWorkspace(
  configuration: ShelvingConfiguration,
  activeSectionId: string = configuration.sections[0].id,
  kitId: string = generateWorkspaceId('kit'),
): ConfiguratorWorkspace {
  return { kits: [{ id: kitId, configuration, activeSectionId }], activeKitId: kitId };
}

/** One kit holding DEFAULT_CONFIGURATION itself. Its ids cannot collide:
 * it is the only kit, and every kit added later gets fresh ids (createKit). */
function defaultWorkspace(): ConfiguratorWorkspace {
  return singleKitWorkspace(DEFAULT_CONFIGURATION);
}

/** Applies `update` to the active kit; returning the same kit is a no-op. */
function updateActiveKit(
  state: ConfiguratorState,
  update: (kit: ConfiguratorKit) => ConfiguratorKit,
): Partial<ConfiguratorState> | ConfiguratorState {
  const active = selectActiveKit(state);
  const next = update(active);
  if (next === active) return state;
  return { kits: state.kits.map((k) => (k.id === active.id ? next : k)) };
}

/** A configuration patch for `kit`, except that a quantity increase past the
 * workspace's physical-rack limit is refused (decreases always apply). */
function applyConfigPatch(state: ConfiguratorState, kit: ConfiguratorKit, patch: Partial<ShelvingConfiguration>): ConfiguratorKit {
  let next = { ...kit.configuration, ...patch };
  const added = next.quantity - kit.configuration.quantity;
  if (added > 0 && !canAddWorkspaceRacks(state.kits, added)) next = { ...next, quantity: kit.configuration.quantity };
  return { ...kit, configuration: next };
}

const initialWorkspace = defaultWorkspace();

export const useConfiguratorStore = create<ConfiguratorState>()(
  persist(
    (set, get) => ({
      ...initialWorkspace,
      kitPrices: {},
      hydrated: false,
      pricingRetryNonce: 0,
      retryPricing: () => set((state) => ({ pricingRetryNonce: state.pricingRetryNonce + 1 })),

      setField: (key, value) =>
        set((state) => updateActiveKit(state, (kit) => applyConfigPatch(state, kit, { [key]: value }))),

      setMany: (patch) => set((state) => updateActiveKit(state, (kit) => applyConfigPatch(state, kit, patch))),

      setAccessoryQuantity: (accessoryId, quantity) =>
        set((state) =>
          updateActiveKit(state, (kit) => {
            const existing = kit.configuration.accessories.filter((a) => a.accessoryId !== accessoryId);
            const accessories = quantity > 0 ? [...existing, { accessoryId, quantity }] : existing;
            return { ...kit, configuration: { ...kit.configuration, accessories } };
          }),
        ),

      setActiveSectionId: (id) => set((state) => updateActiveKit(state, (kit) => ({ ...kit, activeSectionId: id }))),

      addSection: () =>
        set((state) =>
          updateActiveKit(state, (kit) => {
            const config = kit.configuration;
            const { sections } = config;
            if (sections.length >= MAX_SECTIONS) return kit;
            const activeIndex = sections.findIndex((s) => s.id === kit.activeSectionId);
            const insertAfter = activeIndex === -1 ? sections.length - 1 : activeIndex;
            const template = sections[insertAfter] ?? sections[sections.length - 1];
            // The template's width is normally already compatible with the
            // row's current global depth (every mutation that could change
            // that is expected to keep the row valid), so this almost always
            // just reuses it as-is. Defensive fallback only, in case that
            // invariant is ever violated (e.g. a not-yet-normalized persisted
            // state): pick a deterministic width the current depth actually
            // supports (see ms-standard-compatibility.ts) rather than
            // silently creating a second invalid section.
            const templateWidth =
              config.modelSlug === 'ms-standard' && !isValidMsStandardWidthDepth(template.width, config.depth)
                ? (getAllowedWidthsForDepth(config.depth)[0] ?? template.width)
                : template.width;
            // The new section copies the template's own height and shelf
            // count too (each section owns them); walls start off, as before.
            const next = makeSection({ width: templateWidth, height: template.height, shelves: template.shelves });
            const nextSections = [...sections.slice(0, insertAfter + 1), next, ...sections.slice(insertAfter + 1)];
            return { ...kit, configuration: { ...config, sections: nextSections }, activeSectionId: next.id };
          }),
        ),

      removeSection: (id) =>
        set((state) =>
          updateActiveKit(state, (kit) => {
            const { sections } = kit.configuration;
            if (sections.length <= MIN_SECTIONS) return kit;
            const index = sections.findIndex((s) => s.id === id);
            if (index === -1) return kit;
            const nextSections = sections.filter((s) => s.id !== id);
            const nextActive =
              kit.activeSectionId === id
                ? (nextSections[Math.min(index, nextSections.length - 1)]?.id ?? nextSections[0].id)
                : kit.activeSectionId;
            return { ...kit, configuration: { ...kit.configuration, sections: nextSections }, activeSectionId: nextActive };
          }),
        ),

      duplicateSection: (id) =>
        set((state) =>
          updateActiveKit(state, (kit) => {
            const { sections } = kit.configuration;
            if (sections.length >= MAX_SECTIONS) return kit;
            const index = sections.findIndex((s) => s.id === id);
            if (index === -1) return kit;
            const source = sections[index];
            // Width, height, shelves and walls are all copied; only the id is new.
            const copy: ShelvingSection = { ...source, id: generateWorkspaceId('sec') };
            const nextSections = [...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)];
            return { ...kit, configuration: { ...kit.configuration, sections: nextSections }, activeSectionId: copy.id };
          }),
        ),

      updateSection: (id, patch) =>
        set((state) =>
          updateActiveKit(state, (kit) => ({
            ...kit,
            configuration: {
              ...kit.configuration,
              sections: kit.configuration.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
            },
          })),
        ),

      setSectionWidth: (id, width) => get().updateSection(id, { width }),

      reset: () =>
        set((state) =>
          updateActiveKit(state, (kit) => {
            // Fresh section ids: two kits reset in turn must never share one.
            const configuration = withFreshSectionIds(DEFAULT_CONFIGURATION);
            return { ...kit, configuration, activeSectionId: configuration.sections[0].id };
          }),
        ),

      selectKit: (id) =>
        set((state) => (state.kits.some((k) => k.id === id) && state.activeKitId !== id ? { activeKitId: id } : state)),

      // "+ Добавить комплект" starts a new kit from DEFAULT_CONFIGURATION —
      // the configurator's own defined default (the same one reset() uses),
      // never invented values; copying the current kit is "Дублировать".
      // Appended at the end and selected.
      addKit: () => {
        const { kits } = get();
        if (kits.length >= MAX_WORKSPACE_KITS) return { ok: false, reason: 'KIT_COUNT_LIMIT' };
        if (!canAddWorkspaceRacks(kits, DEFAULT_CONFIGURATION.quantity)) return { ok: false, reason: 'RACK_LIMIT' };
        const kit = createKit(DEFAULT_CONFIGURATION);
        set({ kits: [...kits, kit], activeKitId: kit.id });
        return { ok: true };
      },

      // An exact copy (every section, option, accessory and the quantity)
      // with fresh kit and section ids, inserted after its source and
      // selected — the same rule as duplicateSection.
      duplicateKit: (id) => {
        const { kits } = get();
        const index = kits.findIndex((k) => k.id === id);
        if (index === -1) return { ok: false, reason: 'NOT_FOUND' };
        if (kits.length >= MAX_WORKSPACE_KITS) return { ok: false, reason: 'KIT_COUNT_LIMIT' };
        const source = kits[index];
        if (!canAddWorkspaceRacks(kits, source.configuration.quantity)) return { ok: false, reason: 'RACK_LIMIT' };
        const activeSectionIndex = source.configuration.sections.findIndex((s) => s.id === source.activeSectionId);
        const copy = createKit(source.configuration, Math.max(0, activeSectionIndex));
        set({ kits: [...kits.slice(0, index + 1), copy, ...kits.slice(index + 1)], activeKitId: copy.id });
        return { ok: true };
      },

      // At least one kit always remains. Removing the active kit selects the
      // kit that takes its place (the next one), or the new last kit.
      removeKit: (id) =>
        set((state) => {
          if (state.kits.length <= MIN_WORKSPACE_KITS) return state;
          const index = state.kits.findIndex((k) => k.id === id);
          if (index === -1) return state;
          const kits = state.kits.filter((k) => k.id !== id);
          const activeKitId = state.activeKitId === id ? kits[Math.min(index, kits.length - 1)].id : state.activeKitId;
          const { [id]: _removed, ...kitPrices } = state.kitPrices;
          return { kits, activeKitId, kitPrices };
        }),

      // Only an increase can pass the physical-rack limit (Σ quantity ≤ 5);
      // it is refused, never clamped. A decrease is always allowed, even
      // while the workspace is still over the limit.
      setKitQuantity: (id, quantity) => {
        const { kits } = get();
        const kit = kits.find((k) => k.id === id);
        if (!kit) return { ok: false, reason: 'NOT_FOUND' };
        const next = Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, Math.trunc(quantity)));
        const added = next - kit.configuration.quantity;
        if (added > 0 && !canAddWorkspaceRacks(kits, added)) return { ok: false, reason: 'RACK_LIMIT' };
        if (added === 0) return { ok: true };
        set((state) => ({
          kits: state.kits.map((k) => (k.id === id ? { ...k, configuration: { ...k.configuration, quantity: next } } : k)),
        }));
        return { ok: true };
      },

      patchKit: (id, patch) =>
        set((state) => {
          const kit = state.kits.find((k) => k.id === id);
          if (!kit) return state;
          const next = applyConfigPatch(state, kit, patch);
          return { kits: state.kits.map((k) => (k.id === id ? next : k)) };
        }),

      // A link describes whole kits: each one is DEFAULT_CONFIGURATION
      // overlaid with every value the link carries, so nothing is inherited
      // from the draft being replaced. Kit count outside 1…MAX is ignored.
      loadWorkspace: (link) =>
        set((state) => {
          if (link.kits.length < MIN_WORKSPACE_KITS || link.kits.length > MAX_WORKSPACE_KITS) return state;
          const kits = link.kits.map((partial) => createKit({ ...DEFAULT_CONFIGURATION, ...partial }));
          return { kits, activeKitId: (kits[link.activeIndex] ?? kits[0]).id, kitPrices: {} };
        }),

      setKitPricing: (kitId, patch) =>
        set((state) => {
          if (!state.kits.some((k) => k.id === kitId)) return state;
          return { kitPrices: { ...state.kitPrices, [kitId]: { ...(state.kitPrices[kitId] ?? EMPTY_KIT_PRICE), ...patch } } };
        }),
      setHydrated: (value) => set({ hydrated: value }),
    }),
    {
      name: CONFIGURATOR_STORAGE_KEY,
      // v4 (V2.5): one configuration → a workspace of kits. See
      // migrateConfiguratorState for what is migrated.
      version: CONFIGURATOR_STATE_VERSION,
      partialize: (state) => ({ kits: state.kits, activeKitId: state.activeKitId }),
      migrate: (persistedState, version) => migrateConfiguratorState(persistedState, version),
      // Runs on every hydration, including a same-version one (migrate only
      // runs on a version change): browser storage is untrusted, so a
      // malformed current-version workspace resets instead of crashing the page.
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...readPersistedConfiguratorState(persistedState),
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

/** A current-shape (v4) persisted workspace, or a fresh default one when malformed. */
export function readPersistedConfiguratorState(persistedState: unknown): ConfiguratorWorkspace {
  return readPersistedWorkspace(persistedState) ?? defaultWorkspace();
}

/** The V2.4 (v3) single-configuration draft as a one-kit workspace, or
 * undefined when malformed. Lossless: the configuration, its section ids
 * and its active section are kept exactly. */
function readSingleConfigurationDraft(persistedState: unknown): ConfiguratorWorkspace | undefined {
  const state = persistedState as { config?: unknown; activeSectionId?: unknown } | null | undefined;
  const config = readPersistedConfiguration(state?.config);
  if (!config) return undefined;
  const activeSectionId = config.sections.some((s) => s.id === state?.activeSectionId)
    ? (state!.activeSectionId as string)
    : config.sections[0].id;
  return singleKitWorkspace(config, activeSectionId);
}

/**
 * Persisted-draft policy (pre-launch project, no real customer data):
 *
 *   v4 (current)   loaded as-is after a structural check; malformed → default.
 *   v3 (V2.4)      MIGRATED: the one configuration becomes kit 1 of a one-kit
 *                  workspace, with its section ids and active section kept
 *                  (lossless). Malformed → default.
 *   v2 (V2.1)      MIGRATED: its one row-level height/shelf count is copied
 *                  into every section (lossless — every section had exactly
 *                  those values), then as v3. Malformed → default.
 *   v1 / none      RESET to the default workspace (the pre-sections shape;
 *                  obsolete test-only state, not worth converting).
 *
 * Never throws, never partially reinterprets a malformed value.
 */
export function migrateConfiguratorState(persistedState: unknown, version: number): ConfiguratorWorkspace {
  try {
    if (version >= CONFIGURATOR_STATE_VERSION) return readPersistedConfiguratorState(persistedState);
    if (version === 3) return readSingleConfigurationDraft(persistedState) ?? defaultWorkspace();
    if (version === 2) {
      const state = persistedState as { config?: unknown; activeSectionId?: unknown } | null | undefined;
      const config = upgradeRowLevelConfiguration(state?.config);
      return (config && readSingleConfigurationDraft({ config, activeSectionId: state?.activeSectionId })) ?? defaultWorkspace();
    }
    return defaultWorkspace();
  } catch {
    return defaultWorkspace();
  }
}

/**
 * Cross-tab coherence (same pattern as the cart store): persist() reads
 * localStorage once, at start-up, so a second open tab would otherwise keep
 * editing its own stale workspace and overwrite the newer one another tab
 * saved. The browser fires `storage` in every OTHER tab when this key
 * changes; re-reading it there keeps every tab on the latest workspace
 * (rehydrate uses the raw setter, so this never echoes back). Prices are
 * kept per kit id and re-requested only for configurations that changed.
 * The cart store and the order API stay the authority on the rack limit.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === CONFIGURATOR_STORAGE_KEY && event.storageArea === window.localStorage) {
      void useConfiguratorStore.persist.rehydrate();
    }
  });
}
