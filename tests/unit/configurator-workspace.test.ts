// @vitest-environment jsdom
import { createElement, type ComponentType, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIGURATOR_STATE_VERSION,
  CONFIGURATOR_STORAGE_KEY,
  DEFAULT_CONFIGURATION,
  isKitPriceCurrent,
  selectActiveKitPrice,
  singleKitWorkspace,
  useConfiguratorStore,
} from '@/store/configurator-store';
import { useCartStore } from '@/store/cart-store';
import { useLivePrice } from '@/components/configurator/useLivePrice';
import { ParametersSectionsTable } from '@/components/configurator/ParametersSectionsTable';
import { OrderSummaryBar } from '@/components/configurator/OrderSummaryBar';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog, type PublicCatalog } from '@/lib/data/public-catalog';
import { getPhysicalKitCount } from '@/lib/orders/limits';
import { whatsAppConfiguratorUrl, whatsAppWorkspaceUrl } from '@/lib/whatsapp';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';
import type { Locale } from '@/lib/i18n/locales';
import { activeConfig, loadSingleKit } from '../helpers/workspace';

/**
 * Configurator V2.5 — the multi-kit workspace end to end on the client:
 * per-kit server pricing (no re-price on kit switch), the workspace total,
 * the atomic "add all to cart", cross-tab coherence and the kit switcher UI.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const Provider = LocaleProvider as ComponentType<{ locale: Locale; children?: ReactNode }>;

/** A stand-in server answer: its total is derived from the configuration so
 * sums are checkable (the real engine is covered by the pricing suites). */
function fakeResult(config: ShelvingConfiguration): PublicPriceResult {
  const total = 10_000 * config.sections.length * config.quantity;
  return {
    ok: true,
    configuration: config,
    bom: [],
    breakdown: { unitNet: total, quantity: config.quantity, itemsNet: total, assembly: 0, delivery: 0, discount: 0, discountReasons: [], total, unitTotal: total / config.quantity },
    totalWeightKg: 1,
    rowLengthMm: 1000,
    leadTimeDays: 2,
    deliveryNote: null,
    warnings: [],
  } as unknown as PublicPriceResult;
}

const fetchMock = vi.fn(async (_url: string, init: { body: string }) => ({ json: async () => fakeResult(JSON.parse(init.body)) }));

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const state = () => useConfiguratorStore.getState();
const pricedBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body) as ShelvingConfiguration);

function renderPricing() {
  return renderHook(() => useLivePrice(), { wrapper: ({ children }) => createElement(Provider, { locale: 'ru' }, children) });
}

describe('per-kit live pricing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    loadSingleKit(DEFAULT_CONFIGURATION);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
  });

  it('prices every kit on its own, once, from the server', async () => {
    state().addKit();
    state().updateSection(state().kits[1].configuration.sections[0].id, { height: 2500 });
    renderPricing();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const kit of state().kits) {
      const price = state().kitPrices[kit.id];
      expect(isKitPriceCurrent(price, kit.configuration)).toBe(true);
      expect(price.result?.configuration).toEqual(kit.configuration);
    }
  });

  it('switching the active kit triggers no pricing request and shows that kit’s own price', async () => {
    state().addKit();
    state().addSection(); // kit 2: 2 sections
    renderPricing();
    await settle();
    fetchMock.mockClear();
    const [a, b] = state().kits;
    act(() => state().selectKit(a.id));
    await settle();
    expect(selectActiveKitPrice(state()).result?.breakdown.total).toBe(10_000);
    act(() => state().selectKit(b.id));
    await settle();
    expect(selectActiveKitPrice(state()).result?.breakdown.total).toBe(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('editing one kit re-prices that kit only; its old answer is stale until the new one arrives', async () => {
    state().addKit();
    renderPricing();
    await settle();
    fetchMock.mockClear();
    const [a, b] = state().kits;
    act(() => state().setField('depth', 500)); // kit 2 is active
    const pending = state().kitPrices[b.id];
    expect(isKitPriceCurrent(pending, state().kits[1].configuration)).toBe(false);
    await settle();
    expect(pricedBodies().map((c) => c.depth)).toEqual([500]);
    expect(isKitPriceCurrent(state().kitPrices[b.id], state().kits[1].configuration)).toBe(true);
    expect(state().kitPrices[a.id].pricedJson).toBe(JSON.stringify(a.configuration));
  });

  it('a removed kit’s price is dropped; adding a kit prices only the new kit', async () => {
    renderPricing();
    await settle();
    fetchMock.mockClear();
    act(() => void state().addKit());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const added = state().kits[1].id;
    act(() => state().removeKit(added));
    expect(state().kitPrices[added]).toBeUndefined();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('cart — add all kits atomically', () => {
  const input = (quantity: number) => {
    const configuration = { ...DEFAULT_CONFIGURATION, quantity };
    return { modelSlug: 'ms-standard', modelName: 'MS', configuration, priceSnapshot: fakeResult(configuration) };
  };
  beforeEach(() => useCartStore.setState({ items: [] }));

  it('adds every kit as its own line in one update', () => {
    const result = useCartStore.getState().addItems([input(2), input(3)]);
    expect(result.ok).toBe(true);
    expect(useCartStore.getState().items.map((i) => i.configuration.quantity)).toEqual([2, 3]);
  });

  it('adds nothing when the kits together would pass 5 racks (no partial add)', () => {
    expect(useCartStore.getState().addItems([input(3), input(3)])).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(useCartStore.getState().items).toEqual([]);
    useCartStore.getState().addItems([input(2)]);
    expect(useCartStore.getState().addItems([input(1), input(1), input(1), input(1)])).toEqual({ ok: false, reason: 'KIT_LIMIT' });
    expect(getPhysicalKitCount(useCartStore.getState().items)).toBe(2);
  });
});

describe('configurator — cross-tab coherence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    loadSingleKit(DEFAULT_CONFIGURATION);
  });

  it('picks up the workspace another tab saved (kits, active kit), so limits are checked against it', () => {
    const other = singleKitWorkspace({ ...DEFAULT_CONFIGURATION, quantity: 5 }, DEFAULT_CONFIGURATION.sections[0].id, 'other-tab-kit');
    const value = JSON.stringify({ state: other, version: CONFIGURATOR_STATE_VERSION });
    window.localStorage.setItem(CONFIGURATOR_STORAGE_KEY, value);
    window.dispatchEvent(new StorageEvent('storage', { key: CONFIGURATOR_STORAGE_KEY, newValue: value, storageArea: window.localStorage }));
    expect(state().activeKitId).toBe('other-tab-kit');
    expect(activeConfig().quantity).toBe(5);
    // Checked against the fresh 5-rack workspace, not this tab's stale copy.
    expect(state().addKit()).toEqual({ ok: false, reason: 'RACK_LIMIT' });
  });

  it('a malformed workspace written by another tab resets safely instead of crashing', () => {
    const value = JSON.stringify({ state: { kits: 'broken' }, version: CONFIGURATOR_STATE_VERSION });
    window.localStorage.setItem(CONFIGURATOR_STORAGE_KEY, value);
    expect(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: CONFIGURATOR_STORAGE_KEY, newValue: value, storageArea: window.localStorage })),
    ).not.toThrow();
    expect(state().kits).toHaveLength(1);
    expect(activeConfig()).toBe(DEFAULT_CONFIGURATION);
  });
});

describe('WhatsApp — the workspace message', () => {
  const k1 = { ...DEFAULT_CONFIGURATION, quantity: 2 };
  const k2 = { ...DEFAULT_CONFIGURATION, depth: 600 };
  const decode = (url: string) => new URL(url).searchParams.get('text')!;

  it('one kit: exactly the V2.4 message', () => {
    const r = fakeResult(k1);
    expect(whatsAppWorkspaceUrl([r], [], 'https://x/y', 'ru')).toBe(whatsAppConfiguratorUrl(r, [], 'https://x/y', 'ru'));
  });

  it('several kits: one block per kit with its own server total, then the sum of those totals', () => {
    const message = decode(whatsAppWorkspaceUrl([fakeResult(k1), fakeResult(k2)], [], 'https://x/y', 'ru'));
    expect(message).toContain('Комплект 1 — 20 000 ₸');
    expect(message).toContain('Комплект 2 — 10 000 ₸');
    expect(message).toContain('Глубина: 600 мм');
    expect(message).toContain('Итого: 30 000 ₸');
    expect(message).toContain('https://x/y');
    expect(message).not.toMatch(/markup|Наценк|себестоим/i);
  });
});

describe('kit switcher and purchase card (UI)', () => {
  let catalog: PublicCatalog;
  beforeAll(async () => {
    catalog = toPublicCatalog(await getCatalog());
  });
  beforeEach(() => {
    loadSingleKit(DEFAULT_CONFIGURATION);
    useCartStore.setState({ items: [] });
    push.mockClear();
  });
  afterEach(cleanup);

  const renderPanel = () => render(createElement(Provider, { locale: 'ru' }, createElement(ParametersSectionsTable, { catalog })));
  const renderBar = () => render(createElement(Provider, { locale: 'ru' }, createElement(OrderSummaryBar, { catalog })));
  const switcher = () => screen.getByRole('group', { name: 'Комплекты' });
  const kitTab = (n: number) => within(switcher()).getByRole('button', { name: new RegExp(`^Комплект ${n}\\b`) });
  const addKitButton = () => screen.queryByRole('button', { name: 'Добавить комплект' }) as HTMLButtonElement | null;

  /** Marks every kit as priced by the server for its current configuration. */
  function priceAllKits() {
    for (const kit of state().kits) {
      state().setKitPricing(kit.id, { result: fakeResult(kit.configuration), error: null, pricedJson: JSON.stringify(kit.configuration), isPricing: false });
    }
  }

  it('lists every kit in order, marks the active one, and switches kits', () => {
    state().addKit();
    state().setField('depth', 600);
    renderPanel();
    expect(within(switcher()).getAllByRole('button', { name: /^Комплект \d/ })).toHaveLength(2);
    expect(kitTab(2).getAttribute('aria-pressed')).toBe('true');
    expect(kitTab(1).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('heading', { name: 'Комплект 2' })).toBeTruthy();
    fireEvent.click(kitTab(1));
    expect(kitTab(1).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Комплект 1' })).toBeTruthy();
    // The controls now show kit 1's own values.
    expect((screen.getByRole('combobox', { name: 'Глубина' }) as HTMLSelectElement).value).toBe(String(DEFAULT_CONFIGURATION.depth));
    fireEvent.click(kitTab(2));
    expect((screen.getByRole('combobox', { name: 'Глубина' }) as HTMLSelectElement).value).toBe('600');
  });

  it('"+ Комплект" adds and selects a kit; it disappears at 5 kits with a message', () => {
    renderPanel();
    for (let i = 0; i < 4; i += 1) fireEvent.click(addKitButton()!);
    expect(state().kits).toHaveLength(5);
    expect(kitTab(5).getAttribute('aria-pressed')).toBe('true');
    expect(addKitButton()).toBeNull();
    expect(screen.getByText('В конфигураторе не более 5 комплектов.')).toBeTruthy();
  });

  it('duplicate and remove act on the active kit; remove is disabled for the last kit', () => {
    renderPanel();
    const remove = () => screen.getByRole('button', { name: 'Удалить комплект' }) as HTMLButtonElement;
    expect(remove().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Дублировать комплект' }));
    expect(state().kits).toHaveLength(2);
    expect(remove().disabled).toBe(false);
    fireEvent.click(remove());
    expect(state().kits).toHaveLength(1);
  });

  it('the kit quantity stepper stops at the racks left in the workspace (Σ ≤ 5)', () => {
    state().setKitQuantity(state().kits[0].id, 3);
    state().addKit(); // kit 2, quantity 1 → 4 racks
    renderPanel();
    const plus = () => screen.getByRole('button', { name: 'Увеличить количество' }) as HTMLButtonElement;
    fireEvent.click(plus());
    expect(activeConfig().quantity).toBe(2);
    expect(plus().disabled).toBe(true);
    // No kit can be added any more; the rack limit is explained.
    expect(addKitButton()!.disabled).toBe(true);
    expect(screen.getByText('В одном заказе можно оформить не более 5 стеллажей.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Уменьшить количество' }));
    expect(activeConfig().quantity).toBe(1);
  });

  it('shows the workspace total (Σ of every kit’s server total) and the active kit’s own price', () => {
    state().setKitQuantity(state().kits[0].id, 2); // kit 1: 20 000
    state().addKit();
    state().addSection(); // kit 2: 2 sections → 20 000
    state().addKit(); // kit 3: 10 000
    priceAllKits();
    renderBar();
    renderPanel();
    expect(screen.getByText('Итого за все комплекты')).toBeTruthy();
    expect(screen.getByText('50 000 ₸')).toBeTruthy();
    expect(kitTab(3).textContent).toContain('10 000 ₸');
    expect(screen.getByRole('button', { name: 'Добавить все в корзину' })).toBeTruthy();
  });

  it('never shows a total or allows purchase while any kit’s price is not current', () => {
    state().addKit();
    priceAllKits();
    state().setField('depth', 500); // kit 2 changed — its answer is now stale
    renderBar();
    const add = screen.getByRole('button', { name: 'Добавить все в корзину' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText('Пересчёт стоимости…')).toBeTruthy();
    fireEvent.click(add);
    expect(useCartStore.getState().items).toEqual([]);
  });

  it('a kit that failed to price blocks purchase and names the kit', () => {
    state().addKit();
    priceAllKits();
    const [, b] = state().kits;
    state().setKitPricing(b.id, { result: null, error: { ok: false, code: 'INCOMPATIBLE_CONFIGURATION', message: 'Нет' }, pricedJson: JSON.stringify(b.configuration) });
    renderBar();
    expect(screen.getByText('Комплект 2: Нет')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Добавить все в корзину' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds every kit to the cart with its own exact configuration and server snapshot', () => {
    state().setKitQuantity(state().kits[0].id, 2);
    state().addKit();
    state().setField('depth', 600);
    state().addSection();
    priceAllKits();
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить все в корзину' }));
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.configuration)).toEqual(state().kits.map((k) => k.configuration));
    expect(items.map((i) => i.priceSnapshot?.breakdown.total)).toEqual([20_000, 20_000]);
  });

  it('refuses the whole workspace when the cart has no room for all of it (nothing half-added)', () => {
    const existing = { ...DEFAULT_CONFIGURATION, quantity: 3 };
    useCartStore.getState().addItem({ modelSlug: 'ms-standard', modelName: 'MS', configuration: existing, priceSnapshot: fakeResult(existing) });
    state().addKit();
    state().addKit(); // 3 racks in the workspace, 3 in the cart
    priceAllKits();
    renderBar();
    expect(screen.getByTestId('configurator-kit-limit')).toBeTruthy();
    const checkout = screen.getByRole('button', { name: 'Оформить заказ' }) as HTMLButtonElement;
    expect(checkout.disabled).toBe(true);
    fireEvent.click(checkout);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('a one-kit workspace keeps the V2.4 card: "Итого" and "Добавить в корзину"', () => {
    priceAllKits();
    renderBar();
    expect(screen.getByText('Итого')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить в корзину' })).toBeTruthy();
  });
});
