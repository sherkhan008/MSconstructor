'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PriceFailure, PriceResult, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Configurator UI state. Holds the customer's in-progress selections plus
 * the *last server-calculated* price — the store never computes a price
 * itself, it only stores whatever src/app/configurator's fetch to
 * /api/pricing/calculate returned. See src/lib/pricing/engine.ts for the
 * actual calculation.
 */

export const DEFAULT_CONFIGURATION: ShelvingConfiguration = {
  modelSlug: 'ms-standard',
  configurationType: 'SINGLE',
  height: 2000,
  width: 1000,
  depth: 400,
  shelves: 5,
  sections: 1,
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  rear: 'CROSS_BRACE',
  side: 'NONE',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId: 'delivery-pickup',
  quantity: 1,
};

export const STEP_COUNT = 8;

interface ConfiguratorState {
  config: ShelvingConfiguration;
  step: number;
  priceResult: PriceResult | null;
  pricingError: PriceFailure | null;
  isPricing: boolean;
  hydrated: boolean;

  setField: <K extends keyof ShelvingConfiguration>(key: K, value: ShelvingConfiguration[K]) => void;
  setMany: (patch: Partial<ShelvingConfiguration>) => void;
  setAccessoryQuantity: (accessoryId: string, quantity: number) => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  loadFromPartial: (partial: Partial<ShelvingConfiguration>) => void;
  reset: () => void;
  setPriceResult: (result: PriceResult | null) => void;
  setPricingError: (error: PriceFailure | null) => void;
  setIsPricing: (value: boolean) => void;
  setHydrated: (value: boolean) => void;
}

export const useConfiguratorStore = create<ConfiguratorState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIGURATION,
      step: 0,
      priceResult: null,
      pricingError: null,
      isPricing: false,
      hydrated: false,

      setField: (key, value) =>
        set((state) => ({ config: { ...state.config, [key]: value } })),

      setMany: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),

      setAccessoryQuantity: (accessoryId, quantity) =>
        set((state) => {
          const existing = state.config.accessories.filter((a) => a.accessoryId !== accessoryId);
          const accessories = quantity > 0 ? [...existing, { accessoryId, quantity }] : existing;
          return { config: { ...state.config, accessories } };
        }),

      setStep: (step) => set({ step: Math.max(0, Math.min(STEP_COUNT - 1, step)) }),
      nextStep: () => set((state) => ({ step: Math.min(STEP_COUNT - 1, state.step + 1) })),
      prevStep: () => set((state) => ({ step: Math.max(0, state.step - 1) })),

      loadFromPartial: (partial) =>
        set((state) => ({ config: { ...state.config, ...partial } })),

      reset: () => set({ config: DEFAULT_CONFIGURATION, step: 0, priceResult: null, pricingError: null }),

      setPriceResult: (result) => set({ priceResult: result, pricingError: null }),
      setPricingError: (error) => set({ pricingError: error, priceResult: null }),
      setIsPricing: (value) => set({ isPricing: value }),
      setHydrated: (value) => set({ hydrated: value }),
    }),
    {
      name: 'ms-shelving-configurator',
      version: 1,
      partialize: (state) => ({ config: state.config, step: state.step }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
