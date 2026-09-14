'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PriceFailure, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import { getAllowedWidthsForDepth, isValidMsStandardWidthDepth } from '@/lib/pricing/ms-standard-compatibility';

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

export const MIN_SECTIONS = 1;
export const MAX_SECTIONS = 10;

let sectionCounter = 0;
function generateSectionId(): string {
  sectionCounter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sec-${Date.now()}-${sectionCounter}`;
}

function makeSection(width: number): ShelvingSection {
  return { id: generateSectionId(), width, rearWall: false, leftWall: false, rightWall: false };
}

export const DEFAULT_CONFIGURATION: ShelvingConfiguration = {
  modelSlug: 'ms-standard',
  height: 2000,
  depth: 400,
  shelves: 5,
  sections: [makeSection(1000)],
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
  updateSection: (id: string, patch: Partial<Omit<ShelvingSection, 'id'>>) => void;
  setSectionWidth: (id: string, width: number) => void;

  loadFromPartial: (partial: Partial<ShelvingConfiguration>) => void;
  reset: () => void;
  setPriceResult: (result: PublicPriceResult | null) => void;
  setPricingError: (error: PriceFailure | null) => void;
  setIsPricing: (value: boolean) => void;
  setHydrated: (value: boolean) => void;
}

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
          const next = makeSection(templateWidth);
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
      version: 2,
      partialize: (state) => ({ config: state.config, activeSectionId: state.activeSectionId }),
      migrate: (persistedState, version) => migrateConfiguratorState(persistedState, version),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

/**
 * v1 stored `{ config: { width, sections: <count>, rear, side,
 * configurationType, ... }, step }`. v2 replaces `width` + `sections` (a
 * count) with `sections: ShelvingSection[]`, and drops the step wizard.
 * Anything that fails to migrate safely falls back to DEFAULT_CONFIGURATION
 * rather than crashing the configurator.
 */
export function migrateConfiguratorState(persistedState: unknown, version: number): PersistedConfiguratorState {
  try {
    if (version >= 2) {
      const state = persistedState as { config?: ShelvingConfiguration; activeSectionId?: string };
      const sections = Array.isArray(state.config?.sections) && state.config.sections.length > 0
        ? state.config.sections
        : DEFAULT_CONFIGURATION.sections;
      const config = state.config ? { ...state.config, sections } : DEFAULT_CONFIGURATION;
      const activeSectionId = sections.some((s) => s.id === state.activeSectionId)
        ? state.activeSectionId!
        : sections[0].id;
      return { config, activeSectionId };
    }

    // v1 (or unversioned): legacy shape with a single global width + section count.
    const legacy = persistedState as {
      config?: {
        width?: unknown;
        sections?: unknown;
        rear?: unknown;
        side?: unknown;
        configurationType?: unknown;
        [key: string]: unknown;
      };
    };
    const legacyConfig = legacy?.config;
    if (!legacyConfig || typeof legacyConfig !== 'object') {
      return { config: DEFAULT_CONFIGURATION, activeSectionId: DEFAULT_CONFIGURATION.sections[0].id };
    }

    const legacyWidth = typeof legacyConfig.width === 'number' && legacyConfig.width > 0 ? legacyConfig.width : 1000;
    const legacyCount =
      typeof legacyConfig.sections === 'number' && legacyConfig.sections >= 1
        ? Math.min(legacyConfig.sections, MAX_SECTIONS)
        : 1;
    const sections = Array.from({ length: legacyCount }, () => makeSection(legacyWidth));

    const { width: _w, sections: _s, rear: _r, side: _side, configurationType: _ct, ...rest } = legacyConfig;
    const config: ShelvingConfiguration = {
      ...DEFAULT_CONFIGURATION,
      ...(rest as Partial<ShelvingConfiguration>),
      sections,
    };

    return { config, activeSectionId: sections[0].id };
  } catch {
    return { config: DEFAULT_CONFIGURATION, activeSectionId: DEFAULT_CONFIGURATION.sections[0].id };
  }
}
