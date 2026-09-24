// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  canAddKits,
  exceedsKitLimit,
  getPhysicalKitCount,
  getRemainingKitCapacity,
  MAX_KITS_PER_ORDER,
} from '@/lib/orders/limits';
import { CART_STATE_VERSION, CART_STORAGE_KEY, migrateCartState, useCartStore, type CartItem } from '@/store/cart-store';
import { DEFAULT_CONFIGURATION } from '@/store/configurator-store';
import type { PublicPriceResult } from '@/lib/pricing/public-result';

/**
 * V2.1: at most 5 physical kits per order — the sum of every line's
 * configuration.quantity, not the number of lines.
 */

const lines = (...quantities: number[]) => quantities.map((quantity) => ({ configuration: { quantity } }));

describe('physical-kit count helpers', () => {
  it('limit is 5', () => {
    expect(MAX_KITS_PER_ORDER).toBe(5);
  });

  it.each([
    ['5 lines × 1', lines(1, 1, 1, 1, 1)],
    ['1 line × 5', lines(5)],
    ['3 × 1 + 1 × 2', lines(1, 1, 1, 2)],
  ])('accepts %s', (_name, items) => {
    expect(getPhysicalKitCount(items)).toBe(5);
    expect(exceedsKitLimit(items)).toBe(false);
    expect(getRemainingKitCapacity(items)).toBe(0);
    expect(canAddKits(items, 1)).toBe(false);
  });

  it.each([
    ['6 lines × 1', lines(1, 1, 1, 1, 1, 1)],
    ['1 line × 6', lines(6)],
    ['3 + 3', lines(3, 3)],
  ])('rejects %s', (_name, items) => {
    expect(getPhysicalKitCount(items)).toBe(6);
    expect(exceedsKitLimit(items)).toBe(true);
    expect(getRemainingKitCapacity(items)).toBe(0);
  });

  it('counts quantities, not lines: A × 3 + B × 1 leaves capacity 1', () => {
    const items = lines(3, 1);
    expect(getRemainingKitCapacity(items)).toBe(1);
    expect(canAddKits(items, 1)).toBe(true);
    expect(canAddKits(items, 2)).toBe(false);
  });
});

// Only what the store reads from a snapshot; its prices are never used here.
const SNAPSHOT = {} as PublicPriceResult;

function add(quantity: number) {
  return useCartStore.getState().addItem({
    modelSlug: 'ms-standard',
    modelName: 'MS Стандарт',
    configuration: { ...DEFAULT_CONFIGURATION, quantity },
    priceSnapshot: SNAPSHOT,
  });
}

function item(id: string, quantity: number): CartItem {
  return {
    id,
    modelSlug: 'ms-standard',
    modelName: 'MS Стандарт',
    configuration: { ...DEFAULT_CONFIGURATION, quantity },
    priceSnapshot: SNAPSHOT,
    addedAt: '2026-09-24T00:00:00.000Z',
  };
}

const kits = () => getPhysicalKitCount(useCartStore.getState().items);

describe('cart store — kit limit', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCartStore.setState({ items: [] });
  });

  it('addItem accepts up to 5 kits and refuses the one that would make 6, unchanged', () => {
    expect(add(3).ok).toBe(true);
    expect(add(2).ok).toBe(true);
    const before = useCartStore.getState().items;
    expect(add(1)).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(useCartStore.getState().items).toBe(before);
    expect(kits()).toBe(5);
  });

  it('addItem refuses a single configuration of quantity 6 (configurator add)', () => {
    expect(add(6)).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('addItem refuses the configurator add that would make 6 on top of an existing cart', () => {
    add(4);
    expect(add(2).ok).toBe(false);
    expect(kits()).toBe(4);
  });

  it('duplicateItem refuses a copy that would make 6', () => {
    useCartStore.setState({ items: [item('a', 3), item('b', 1)] });
    expect(useCartStore.getState().duplicateItem('a')).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(useCartStore.getState().items).toHaveLength(2);
    expect(useCartStore.getState().duplicateItem('b')).toEqual({ ok: true });
    expect(kits()).toBe(5);
  });

  it('setQuantity refuses an increase to 6 without clamping, and allows what still fits', () => {
    useCartStore.setState({ items: [item('a', 3), item('b', 1)] });
    expect(useCartStore.getState().setQuantity('b', 3)).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(useCartStore.getState().items.find((i) => i.id === 'b')?.configuration.quantity).toBe(1);
    expect(useCartStore.getState().setQuantity('b', 2)).toEqual({ ok: true });
    expect(kits()).toBe(5);
  });

  it('keeps a persisted over-limit cart intact: decreases work, increases and copies do not', () => {
    const persisted = [item('a', 4), item('b', 3)];
    useCartStore.setState({ items: persisted });
    expect(kits()).toBe(7);
    expect(useCartStore.getState().items).toBe(persisted);
    expect(useCartStore.getState().setQuantity('b', 4).ok).toBe(false);
    expect(useCartStore.getState().duplicateItem('a').ok).toBe(false);
    expect(add(1).ok).toBe(false);
    expect(useCartStore.getState().setQuantity('b', 2).ok).toBe(true);
    expect(kits()).toBe(6);
    expect(useCartStore.getState().setQuantity('a', 3).ok).toBe(true);
    expect(kits()).toBe(5);
  });

  it('reports an unknown line instead of pretending success', () => {
    expect(useCartStore.getState().setQuantity('missing', 2)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(useCartStore.getState().duplicateItem('missing')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

describe('cart store — cross-tab freshness', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCartStore.setState({ items: [] });
  });

  /** What another tab's persist() write looks like from this tab. */
  function otherTabWrites(items: CartItem[]) {
    const value = JSON.stringify({ state: { items }, version: CART_STATE_VERSION });
    window.localStorage.setItem(CART_STORAGE_KEY, value);
    window.dispatchEvent(new StorageEvent('storage', { key: CART_STORAGE_KEY, newValue: value, storageArea: window.localStorage }));
  }

  it('picks up the newer cart another tab saved, so its limit checks use it', () => {
    add(1);
    otherTabWrites([item('x', 3), item('y', 2)]);
    expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['x', 'y']);
    // Checked against the fresh 5-kit cart, not this tab's stale 1-kit copy.
    expect(add(1)).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    // And this tab never overwrote the other tab's cart.
    expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '{}').state.items).toHaveLength(2);
  });

  it('ignores storage events for other keys', () => {
    add(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: '{}', storageArea: window.localStorage }));
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});

describe('cart store — persisted cart policy (V2.2A, version 2)', () => {
  /** A cart line as V2.1 (cart version 1) stored it: row-level height/shelves. */
  function v1Item(id: string, quantity: number, overrides: Record<string, unknown> = {}) {
    const { sections, ...rest } = DEFAULT_CONFIGURATION;
    return {
      id,
      modelSlug: 'ms-standard',
      modelName: 'MS Стандарт',
      configuration: {
        ...rest,
        height: 2200,
        shelves: 6,
        quantity,
        sections: sections.map(({ height: _h, shelves: _s, ...section }) => ({ ...section, id: `${id}-s` })),
        ...overrides,
      },
      priceSnapshot: { breakdown: { total: 1 } },
      addedAt: '2026-09-01T00:00:00.000Z',
    };
  }

  it('is version 2', () => {
    expect(CART_STATE_VERSION).toBe(2);
  });

  it('MIGRATES a V2.1 cart: height/shelves copied into every section, snapshot cleared for a server re-price', () => {
    const migrated = migrateCartState({ items: [v1Item('a', 2), v1Item('b', 3)] }, 1);
    expect(migrated.items.map((i) => i.id)).toEqual(['a', 'b']);
    for (const item of migrated.items) {
      expect(item.configuration).not.toHaveProperty('height');
      expect(item.configuration).not.toHaveProperty('shelves');
      expect(item.configuration.sections.every((s) => s.height === 2200 && s.shelves === 6)).toBe(true);
      expect(item.priceSnapshot).toBeNull();
    }
    // Quantities are untouched: Σ quantity = 5, the limit is neither weakened nor re-applied here.
    expect(getPhysicalKitCount(migrated.items)).toBe(5);
  });

  it('RESETS the whole test cart when any line is malformed (never partially kept)', () => {
    expect(migrateCartState({ items: [v1Item('a', 1), v1Item('b', 1, { height: 'x' })] }, 1)).toEqual({ items: [] });
    expect(migrateCartState({ items: [v1Item('a', 1, { shelves: undefined })] }, 1)).toEqual({ items: [] });
    expect(migrateCartState({ items: 'garbage' }, 1)).toEqual({ items: [] });
    expect(migrateCartState(null, 1)).toEqual({ items: [] });
    expect(migrateCartState({ items: [v1Item('a', 1)] }, 0)).toEqual({ items: [] });
  });

  it('keeps an over-limit V2.1 cart intact after migration (the UI and order API still enforce Σ ≤ 5)', () => {
    const migrated = migrateCartState({ items: [v1Item('a', 4), v1Item('b', 3)] }, 1);
    expect(getPhysicalKitCount(migrated.items)).toBe(7);
    expect(exceedsKitLimit(migrated.items)).toBe(true);
  });

  it('hydrates a V2.1 cart from storage through the migration', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ state: { items: [v1Item('a', 1)] }, version: 1 }));
    await useCartStore.persist.rehydrate();
    const [item] = useCartStore.getState().items;
    expect(item.id).toBe('a');
    expect(item.configuration.sections[0]).toMatchObject({ height: 2200, shelves: 6 });
    expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '{}').version).toBe(CART_STATE_VERSION);
  });
});
