'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PriceFailure, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import { getAllowedWidthsForDepth, isValidMsStandardWidthDepth } from '@/lib/pricing/ms-standard-compatibility';
import { MAX_SECTIONS, MIN_SECTIONS } from '@/lib/configurator/limits';
import { readPersistedConfiguration, upgradeRowLevelConfiguration } from '@/lib/configurator/persisted-configuration';

type PersistedConfiguratorState = { config: ShelvingConfiguration; activeSectionId: string };

/**
 * Configurator UI state. Holds the customer's in-progress selections plus
 * the *last server-calculated* price — the store never computes a price
 * itself, it only stores whatever src/app/configurator's fetch to
 * /api/pricing/calculate returned. See src/lib/pricing/engine.ts for the
 * actual calculation.
 *
 * Multi-row support reserved for a future iteration — today's configuration
 * is always exactly one shelving row made of one or more sections.
 */

// Shared with the server schema — see src/lib/configurator/limits.ts. A
// configuration persisted before the limit dropped may hold more sections:
// it is kept as-is (addSection/duplicateSection refuse to grow it further,
// removeSection still works) and the server rejects it until it is reduced.
export { MAX_SECTIONS, MIN_SECTIONS };

let sectionCounter = 0;
function generateSectionId(): string {
  sectionCounter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sec-${Date.now()}-${sectionCounter}`;
}

/** A new section with the given dimensions and no wall panels. */
function makeSection(dimensions: Pick<ShelvingSection, 'width' | 'height' | 'shelves'>): ShelvingSection {
  return {
    id: generateSectionId(),
    width: dimensions.width,
    height: dimensions.height,
    shelves: dimensions.shelves,
    rearWall: false,
    leftWall: false,
    rightWall: false,
  };
}

/** Every section owns its width, height and shelves — there is no row-level
 * height/shelf count (V2.2A). */
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

interface ConfiguratorState {
  config: ShelvingConfiguration;
  activeSectionId: string;
  priceResult: PublicPriceResult | null;
  pricingError: PriceFailure | null;
  isPricing: boolean;
  hydrated: boolean;
  /** Bumped to force useLivePrice to retry after a network failure without the config itself changing. */
  pricingRetryNonce: number;
  retryPricing: () => void;

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

  loadFromPartial: (partial: Partial<ShelvingConfiguration>) => void;
  reset: () => void;
  setPriceResult: (result: PublicPriceResult | null) => void;
  setPricingError: (error: PriceFailure | null) => void;
  setIsPricing: (value: boolean) => void;
  setHydrated: (value: boolean) => void;
}

/** Persisted draft version — see migrateConfiguratorState. */
export const CONFIGURATOR_STATE_VERSION = 3;

export const useConfiguratorStore = create<ConfiguratorState>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIGURATION,
      activeSectionId: DEFAULT_CONFIGURATION.sections[0].id,
      priceResult: null,
      pricingError: null,
      isPricing: false,
      hydrated: false,
      pricingRetryNonce: 0,
      retryPricing: () => set((state) => ({ pricingRetryNonce: state.pricingRetryNonce + 1 })),

      setField: (key, value) =>
        set((state) => ({ config: { ...state.config, [key]: value } })),

      setMany: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),

      setAccessoryQuantity: (accessoryId, quantity) =>
        set((state) => {
          const existing = state.config.accessories.filter((a) => a.accessoryId !== accessoryId);
          const accessories = quantity > 0 ? [...existing, { accessoryId, quantity }] : existing;
          return { config: { ...state.config, accessories } };
        }),

      setActiveSectionId: (id) => set({ activeSectionId: id }),

      addSection: () =>
        set((state) => {
          const { sections } = state.config;
          if (sections.length >= MAX_SECTIONS) return state;
          const activeIndex = sections.findIndex((s) => s.id === state.activeSectionId);
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
            state.config.modelSlug === 'ms-standard' && !isValidMsStandardWidthDepth(template.width, state.config.depth)
              ? (getAllowedWidthsForDepth(state.config.depth)[0] ?? template.width)
              : template.width;
          // The new section copies the template's own height and shelf
          // count too (each section owns them); walls start off, as before.
          const next = makeSection({ width: templateWidth, height: template.height, shelves: template.shelves });
          const nextSections = [...sections.slice(0, insertAfter + 1), next, ...sections.slice(insertAfter + 1)];
          return { config: { ...state.config, sections: nextSections }, activeSectionId: next.id };
        }),

      removeSection: (id) =>
        set((state) => {
          const { sections } = state.config;
          if (sections.length <= MIN_SECTIONS) return state;
          const index = sections.findIndex((s) => s.id === id);
          if (index === -1) return state;
          const nextSections = sections.filter((s) => s.id !== id);
          const nextActive =
            state.activeSectionId === id
              ? (nextSections[Math.min(index, nextSections.length - 1)]?.id ?? nextSections[0].id)
              : state.activeSectionId;
          return { config: { ...state.config, sections: nextSections }, activeSectionId: nextActive };
        }),

      duplicateSection: (id) =>
        set((state) => {
          const { sections } = state.config;
          if (sections.length >= MAX_SECTIONS) return state;
          const index = sections.findIndex((s) => s.id === id);
          if (index === -1) return state;
          const source = sections[index];
          // Width, height, shelves and walls are all copied; only the id is new.
          const copy: ShelvingSection = { ...source, id: generateSectionId() };
          const nextSections = [...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)];
          return { config: { ...state.config, sections: nextSections }, activeSectionId: copy.id };
        }),

      updateSection: (id, patch) =>
        set((state) => ({
          config: {
            ...state.config,
            sections: state.config.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
          },
        })),

      setSectionWidth: (id, width) => get().updateSection(id, { width }),

      loadFromPartial: (partial) =>
        set((state) => {
          const nextConfig = { ...state.config, ...partial };
          const activeStillPresent = nextConfig.sections.some((s) => s.id === state.activeSectionId);
          return {
            config: nextConfig,
            activeSectionId: activeStillPresent ? state.activeSectionId : nextConfig.sections[0]?.id ?? state.activeSectionId,
          };
        }),

      reset: () =>
        set({
          config: DEFAULT_CONFIGURATION,
          activeSectionId: DEFAULT_CONFIGURATION.sections[0].id,
          priceResult: null,
          pricingError: null,
        }),

      setPriceResult: (result) => set({ priceResult: result, pricingError: null }),
      setPricingError: (error) => set({ pricingError: error, priceResult: null }),
      setIsPricing: (value) => set({ isPricing: value }),
      setHydrated: (value) => set({ hydrated: value }),
    }),
    {
      name: 'ms-shelving-configurator',
      // v3 (V2.2A): height and shelves moved from the configuration onto
      // every section. See migrateConfiguratorState for what is migrated.
      version: CONFIGURATOR_STATE_VERSION,
      partialize: (state) => ({ config: state.config, activeSectionId: state.activeSectionId }),
      migrate: (persistedState, version) => migrateConfiguratorState(persistedState, version),
      // Runs on every hydration, including a same-version one (migrate only
      // runs on a version change): browser storage is untrusted, so a
      // malformed current-version draft resets instead of crashing the page.
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


function defaultPersistedState(): PersistedConfiguratorState {
  return { config: DEFAULT_CONFIGURATION, activeSectionId: DEFAULT_CONFIGURATION.sections[0].id };
}

/** A current-shape (v3) persisted draft, or the default when malformed. */
export function readPersistedConfiguratorState(persistedState: unknown): PersistedConfiguratorState {
  const state = persistedState as { config?: unknown; activeSectionId?: unknown } | null | undefined;
  const config = readPersistedConfiguration(state?.config);
  if (!config) return defaultPersistedState();
  const activeSectionId = config.sections.some((s) => s.id === state?.activeSectionId)
    ? (state!.activeSectionId as string)
    : config.sections[0].id;
  return { config, activeSectionId };
}

/**
 * Persisted-draft policy (pre-launch project, no real customer data):
 *
 *   v3 (current)   loaded as-is after a structural check; malformed → default.
 *   v2 (V2.1)      MIGRATED: its one row-level height/shelf count is copied
 *                  into every section (lossless — every section had exactly
 *                  those values). Malformed → default.
 *   v1 / none      RESET to DEFAULT_CONFIGURATION (the pre-sections shape;
 *                  obsolete test-only state, not worth converting).
 *
 * Never throws, never partially reinterprets a malformed value.
 */
export function migrateConfiguratorState(persistedState: unknown, version: number): PersistedConfiguratorState {
  try {
    if (version >= CONFIGURATOR_STATE_VERSION) return readPersistedConfiguratorState(persistedState);
    if (version === 2) {
      const state = persistedState as { config?: unknown; activeSectionId?: unknown } | null | undefined;
      const config = upgradeRowLevelConfiguration(state?.config);
      return config ? readPersistedConfiguratorState({ config, activeSectionId: state?.activeSectionId }) : defaultPersistedState();
    }
    return defaultPersistedState();
  } catch {
    return defaultPersistedState();
  }
}
