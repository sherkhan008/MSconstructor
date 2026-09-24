'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import { canAddKits } from '@/lib/orders/limits';

/**
 * Cart state. Persisted to localStorage so a customer's cart survives a
 * reload — but the price shown is only ever a *snapshot* from the last
 * server calculation. src/app/cart/page.tsx re-calls the pricing API on
 * mount and before checkout; nothing here is treated as an authoritative
 * price, in line with the "never trust a client total" rule.
 *
 * Physical-kit limit (src/lib/orders/limits.ts): every mutation that can
 * add kits — addItem, duplicateItem, a quantity increase — is refused when
 * the cart's total quantity would pass MAX_KITS_PER_ORDER. A refused
 * mutation changes nothing (never clamped) and reports why, so the UI can
 * explain it. Decreases and removals are always allowed, so a cart persisted
 * over the limit can be brought back under it; nothing here deletes or
 * shrinks lines on its own. The order API enforces the same limit.
 */

export const CART_STORAGE_KEY = 'ms-shelving-cart';

/** Why a cart mutation was refused. The cart is unchanged whenever `ok` is false. */
export type CartMutationFailure = { ok: false; reason: 'KIT_LIMIT' | 'NOT_FOUND' };
export type CartMutationResult = { ok: true } | CartMutationFailure;

export interface CartItem {
  id: string;
  modelSlug: string;
  modelName: string;
  configuration: ShelvingConfiguration;
  /** Last server-calculated price for this item; null once the config changes. */
  priceSnapshot: PublicPriceResult | null;
  addedAt: string;
}

interface CartState {
  items: CartItem[];
  addItem: (input: {
    modelSlug: string;
    modelName: string;
    configuration: ShelvingConfiguration;
    priceSnapshot: PublicPriceResult;
  }) => { ok: true; id: string } | CartMutationFailure;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => CartMutationResult;
  setQuantity: (id: string, quantity: number) => CartMutationResult;
  setPriceSnapshot: (id: string, priceSnapshot: PublicPriceResult | null) => void;
  /** Replaces one item's persisted configuration and clears its price
   * snapshot (forcing a fresh server re-price) — used only to repair a
   * configuration whose colorId/assemblyId/deliveryId/accessoryId no
   * longer resolves in the current catalog (see
   * src/lib/configurator/reconcile.ts). Never computes or assumes a price. */
  setConfiguration: (id: string, configuration: ShelvingConfiguration) => void;
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
        if (!canAddKits(get().items, input.configuration.quantity)) return { ok: false, reason: 'KIT_LIMIT' };
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
        return { ok: true, id };
      },

      removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),

      duplicateItem: (id) => {
        const { items } = get();
        const source = items.find((item) => item.id === id);
        if (!source) return { ok: false, reason: 'NOT_FOUND' };
        if (!canAddKits(items, source.configuration.quantity)) return { ok: false, reason: 'KIT_LIMIT' };
        set((state) => ({
          items: [...state.items, { ...source, id: generateId(), addedAt: new Date().toISOString() }],
        }));
        return { ok: true };
      },

      setQuantity: (id, quantity) => {
        const { items } = get();
        const current = items.find((item) => item.id === id);
        if (!current) return { ok: false, reason: 'NOT_FOUND' };
        const next = Math.max(1, Math.min(200, quantity));
        // Only an increase can pass the limit; a decrease is always allowed,
        // even while the cart is still over it.
        const added = next - current.configuration.quantity;
        if (added > 0 && !canAddKits(items, added)) return { ok: false, reason: 'KIT_LIMIT' };
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  configuration: { ...item.configuration, quantity: next },
                  priceSnapshot: null,
                }
              : item,
          ),
        }));
        return { ok: true };
      },

      setPriceSnapshot: (id, priceSnapshot) =>
        set((state) => ({
          items: state.items.map((item) => (item.id === id ? { ...item, priceSnapshot } : item)),
        })),

      setConfiguration: (id, configuration) =>
        set((state) => ({
          items: state.items.map((item) => (item.id === id ? { ...item, configuration, priceSnapshot: null } : item)),
        })),

      clear: () => set({ items: [] }),

      count: () => get().items.length,
    }),
    { name: CART_STORAGE_KEY, version: 1 },
  ),
);

/**
 * Cross-tab freshness. persist() reads localStorage once, at start-up, so a
 * second open tab would otherwise keep mutating its own stale copy — checking
 * the kit limit against old lines, then overwriting the newer cart another
 * tab saved. The browser fires `storage` in every OTHER tab of the origin
 * when this key changes; re-reading it there keeps each tab's in-memory cart
 * on the latest saved one. (persist's rehydrate uses the raw setter, so this
 * never writes back or echoes between tabs.) The order API stays the final
 * authority on the limit either way.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === CART_STORAGE_KEY && event.storageArea === window.localStorage) {
      void useCartStore.persist.rehydrate();
    }
  });
}
