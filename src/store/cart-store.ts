'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PriceResult, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Cart state. Persisted to localStorage so a customer's cart survives a
 * reload — but the price shown is only ever a *snapshot* from the last
 * server calculation. src/app/cart/page.tsx re-calls the pricing API on
 * mount and before checkout; nothing here is treated as an authoritative
 * price, in line with the "never trust a client total" rule.
 */

export interface CartItem {
  id: string;
  modelSlug: string;
  modelName: string;
  configuration: ShelvingConfiguration;
  /** Last server-calculated price for this item; null once the config changes. */
  priceSnapshot: PriceResult | null;
  addedAt: string;
}

interface CartState {
  items: CartItem[];
  addItem: (input: { modelSlug: string; modelName: string; configuration: ShelvingConfiguration; priceSnapshot: PriceResult }) => string;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  setQuantity: (id: string, quantity: number) => void;
  setPriceSnapshot: (id: string, priceSnapshot: PriceResult | null) => void;
  clear: () => void;
  count: () => number;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (input) => {
        const id = generateId();
        set((state) => ({
          items: [
            ...state.items,
            {
              id,
              modelSlug: input.modelSlug,
              modelName: input.modelName,
              configuration: input.configuration,
              priceSnapshot: input.priceSnapshot,
              addedAt: new Date().toISOString(),
            },
          ],
        }));
        return id;
      },

      removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),

      duplicateItem: (id) =>
        set((state) => {
          const source = state.items.find((item) => item.id === id);
          if (!source) return state;
          return {
            items: [
              ...state.items,
              { ...source, id: generateId(), addedAt: new Date().toISOString() },
            ],
          };
        }),

      setQuantity: (id, quantity) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  configuration: { ...item.configuration, quantity: Math.max(1, Math.min(200, quantity)) },
                  priceSnapshot: null,
                }
              : item,
          ),
        })),

      setPriceSnapshot: (id, priceSnapshot) =>
        set((state) => ({
          items: state.items.map((item) => (item.id === id ? { ...item, priceSnapshot } : item)),
        })),

      clear: () => set({ items: [] }),

      count: () => get().items.length,
    }),
    { name: 'ms-shelving-cart', version: 1 },
  ),
);
