// @vitest-environment jsdom
import { createElement, type ComponentType, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIGURATION, MAX_SECTIONS } from '@/store/configurator-store';
import { ParametersSectionsTable } from '@/components/configurator/ParametersSectionsTable';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog, type PublicCatalog } from '@/lib/data/public-catalog';
import { getAllowedKitDepths, getAllowedSectionWidths, getSectionLimits } from '@/lib/configurator/section-limits';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import type { Locale } from '@/lib/i18n/locales';
import { activeConfig, activeSectionIdOf, loadSingleKit } from '../helpers/workspace';

/**
 * Configurator V2.4 — per-section controls. Every section owns its width,
 * height, shelf count and walls; the panel shows every section as its own
 * column of its own controls (2026-10-01), each control edits only its own
 * section, and every range comes from that section alone. The preview's height handle and shelf column act
 * on the active section too. No shared height or shelf value exists.
 */

const Provider = LocaleProvider as ComponentType<{ locale: Locale; children?: ReactNode }>;
const CAPACITY = { width: 1500, height: 3000, depth: 800 };

function section(id: string, width: number, height: number, shelves: number, walls: Partial<ShelvingSection> = {}): ShelvingSection {
  return { id, width, height, shelves, rearWall: false, leftWall: false, rightWall: false, corner: 'NONE', ...walls };
}

function load(sections: ShelvingSection[], activeSectionId = sections[0].id) {
  loadSingleKit({ ...DEFAULT_CONFIGURATION, sections, accessories: [] }, activeSectionId);
}

const heights = () => activeConfig().sections.map((s) => s.height);
const shelves = () => activeConfig().sections.map((s) => s.shelves);

let catalog: PublicCatalog;
beforeAll(async () => {
  catalog = toPublicCatalog(await getCatalog());
});
beforeEach(() => load([section('a', 1000, 1500, 4), section('b', 1200, 2500, 8)]));
afterEach(cleanup);

function renderPanel() {
  return render(createElement(Provider, { locale: 'ru' }, createElement(ParametersSectionsTable, { catalog })));
}

const select = (label: string) => screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
const optionValues = (el: HTMLSelectElement) => Array.from(el.options).map((o) => Number(o.value));
/** Section `n`'s own column (2026-10-01: one column per section). */
const column = (n: number) => {
  const el = document.querySelector<HTMLElement>(`[data-section-column="${n}"]`);
  if (!el) throw new Error(`section column ${n} not found`);
  return within(el);
};
const shelfCount = (n = 1) => column(n).getByTestId('shelf-count').textContent;
const increase = (n = 1) => column(n).getByRole('button', { name: 'Увеличить' }) as HTMLButtonElement;
const decrease = (n = 1) => column(n).getByRole('button', { name: 'Уменьшить' }) as HTMLButtonElement;

describe('V2.4 sections panel — every section is its own column of its OWN controls', () => {
  it('gives every section its own column holding its own width, height and shelves', () => {
    renderPanel();
    expect(document.querySelectorAll('[data-section-column]')).toHaveLength(2);
    // Each column is one labelled unit: "Секция N" names its group.
    expect(screen.getByRole('group', { name: 'Секция 1' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Секция 2' })).toBeTruthy();
    expect((column(1).getByRole('combobox', { name: 'Ширина секции 1' }) as HTMLSelectElement).value).toBe('1000');
    expect((column(1).getByRole('combobox', { name: 'Высота секции 1' }) as HTMLSelectElement).value).toBe('1500');
    expect(shelfCount(1)).toBe('4');
    expect((column(2).getByRole('combobox', { name: 'Ширина секции 2' }) as HTMLSelectElement).value).toBe('1200');
    expect((column(2).getByRole('combobox', { name: 'Высота секции 2' }) as HTMLSelectElement).value).toBe('2500');
    expect(shelfCount(2)).toBe('8');
    // A column never holds another section's controls.
    expect(column(1).queryByRole('combobox', { name: 'Ширина секции 2' })).toBeNull();
    expect(column(2).queryByRole('combobox', { name: 'Высота секции 1' })).toBeNull();

    // The header selects its section; the selected one is marked.
    const header2 = screen.getByRole('button', { name: 'Секция 2' });
    expect(header2.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(header2);
    expect(activeSectionIdOf()).toBe('b');
    expect(header2.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Секция 1' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('changing section 1 height leaves section 2 untouched', () => {
    renderPanel();
    fireEvent.change(select('Высота секции 1'), { target: { value: '2000' } });
    expect(heights()).toEqual([2000, 2500]);
    expect(shelves()).toEqual([4, 8]);
  });

  it('editing section 2 (width, height, shelves) never modifies section 1, without selecting it first', () => {
    renderPanel();
    fireEvent.change(select('Ширина секции 2'), { target: { value: '1000' } });
    fireEvent.change(select('Высота секции 2'), { target: { value: '3000' } });
    fireEvent.click(decrease(2));
    expect(activeConfig().sections.map((s) => [s.width, s.height, s.shelves])).toEqual([
      [1000, 1500, 4],
      [1000, 3000, 7],
    ]);
  });

  it('changing section 1 shelves leaves section 2 untouched', () => {
    renderPanel();
    fireEvent.click(increase(1));
    expect(shelves()).toEqual([5, 8]);
    fireEvent.click(decrease(1));
    fireEvent.click(decrease(1));
    expect(shelves()).toEqual([3, 8]);
    expect(heights()).toEqual([1500, 2500]);
  });

  it('each section shelf maximum follows its OWN height', () => {
    load([section('a', 1000, 1500, 6), section('b', 1200, 2500, 6)]);
    renderPanel();
    // 1500 mm stops at 6 …
    expect(increase(1).disabled).toBe(true);
    // … while 2500 mm, in the same kit, still goes to 8.
    expect(increase(2).disabled).toBe(false);
    fireEvent.click(increase(2));
    fireEvent.click(increase(2));
    expect(shelves()).toEqual([6, 8]);
    expect(increase(2).disabled).toBe(true);
  });

  it('each section height options follow its OWN shelf count', () => {
    renderPanel();
    // 4 shelves: every height, 1000 included.
    expect(optionValues(select('Высота секции 1'))).toEqual([1000, 1500, 1800, 2000, 2200, 2500, 3000]);
    // 8 shelves: only heights whose ceiling is 8.
    expect(optionValues(select('Высота секции 2'))).toEqual([2000, 2200, 2500, 3000]);
  });

  it('walls and the cross brace belong to their own section', () => {
    renderPanel();
    fireEvent.click(column(1).getByRole('checkbox', { name: 'Задняя' }));
    expect(activeConfig().sections.map((s) => s.rearWall)).toEqual([true, false]);
    fireEvent.click(column(2).getByRole('checkbox', { name: 'Правая' }));
    expect(activeConfig().sections.map((s) => s.rightWall)).toEqual([false, true]);
    fireEvent.click(column(1).getByRole('checkbox', { name: /^Крестовина жесткости\./ }));
    expect(activeConfig().accessories).toEqual([{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'a' }]);
    // A 1200 mm section cannot take one.
    expect((column(2).getByRole('checkbox', { name: /^Крестовина жесткости\./ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('add copies the active section width, height and shelves; duplicate copies walls too, with a new id', () => {
    load([section('a', 1000, 1500, 4, { rearWall: true }), section('b', 1200, 2500, 8)], 'b');
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить секцию' }));
    const [, , added] = activeConfig().sections;
    expect([added.width, added.height, added.shelves, added.rearWall]).toEqual([1200, 2500, 8, false]);
    expect(activeSectionIdOf()).toBe(added.id);

    fireEvent.click(screen.getByRole('button', { name: 'Секция 1' }));
    // Duplicate/remove are the selected section's own: one of each, on its column.
    expect(screen.getAllByRole('button', { name: 'Дублировать' })).toHaveLength(1);
    expect(column(1).getByRole('button', { name: 'Дублировать' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Дублировать' }));
    const [original, copy] = activeConfig().sections;
    const { id: originalId, ...originalRest } = original;
    const { id: copyId, ...copyRest } = copy;
    expect(copyRest).toEqual(originalRest);
    expect(copyId).not.toBe(originalId);
    expect(activeSectionIdOf()).toBe(copyId);
  });

  it('never allows a sixth section: add and duplicate are disabled at the maximum', () => {
    load(Array.from({ length: MAX_SECTIONS }, (_, i) => section(`s${i}`, 1000, 2000, 5)));
    renderPanel();
    expect(document.querySelectorAll('[data-section-column]')).toHaveLength(MAX_SECTIONS);
    expect((screen.getByRole('button', { name: 'Добавить секцию' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Дублировать' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Дублировать' }));
    expect(activeConfig().sections).toHaveLength(MAX_SECTIONS);
  });

  it('shows the kit depth ONCE, as the kit value, right above the section columns', () => {
    load([section('a', 1000, 1500, 4), section('b', 1200, 2500, 8), section('c', 700, 2000, 5)]);
    renderPanel();
    const depths = screen.getAllByRole('combobox', { name: /Глубина/ });
    expect(depths).toHaveLength(1);
    expect(screen.getByText('Глубина комплекта')).toBeTruthy();
    expect(screen.getByText('Одна для всех секций')).toBeTruthy();
    // Not inside any section's column …
    expect(depths[0].closest('[data-section-column]')).toBeNull();
    // … but in the same dimensions group as the columns, directly before them.
    const sectionsGroup = screen.getByRole('region', { name: 'Секции' });
    expect(sectionsGroup.contains(depths[0])).toBe(true);
    const firstColumn = document.querySelector('[data-section-column="1"]')!;
    expect(screen.getByTestId('kit-depth').nextElementSibling).toBe(firstColumn.parentElement);

    // One depth for every section: changing it changes the kit, no section.
    fireEvent.change(depths[0], { target: { value: '300' } });
    expect(activeConfig().depth).toBe(300);
    expect(activeConfig().sections.every((s) => !('depth' in s))).toBe(true);
  });

  it('keeps kit-wide load separate from the section controls, and never reintroduces a shared height or shelf count', () => {
    renderPanel();
    const kit = screen.getByRole('group', { name: 'Параметры комплекта' });
    expect(within(kit).getByText('Нагрузка')).toBeTruthy();
    expect(within(kit).queryByText(/Высота/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Комплект 1' })).toBeTruthy();
    fireEvent.change(select('Высота секции 1'), { target: { value: '1800' } });
    fireEvent.click(increase(1));
    const config = activeConfig() as ShelvingConfiguration & Record<string, unknown>;
    expect(config).not.toHaveProperty('height');
    expect(config).not.toHaveProperty('shelves');
  });
});

describe('V2.4 section limits — from the section alone', () => {
  const model = () => catalog.models.find((m) => m.slug === 'ms-standard')!;

  it('reads height options and the shelf ceiling from that section only', () => {
    expect(getSectionLimits(model(), { height: 1500, shelves: 4 })).toEqual({
      heights: [1000, 1500, 1800, 2000, 2200, 2500, 3000],
      minShelves: 2,
      maxShelves: 6,
    });
    expect(getSectionLimits(model(), { height: 2500, shelves: 8 })).toEqual({ heights: [2000, 2200, 2500, 3000], minShelves: 2, maxShelves: 8 });
    expect(getSectionLimits(model(), { height: 1000, shelves: 3 }).maxShelves).toBe(4);
  });

  it('keeps the width × depth rules for widths and kit depths', () => {
    expect(getAllowedSectionWidths(model(), 700)).toEqual([1000]);
    expect(getAllowedKitDepths(model(), [{ width: 1000 }, { width: 1200 }])).toEqual([300, 400, 500, 600]);
  });
});

describe('V2.4 preview — the height handle and shelf column act on the ACTIVE section', () => {
  const MIXED = [section('a', 1000, 1500, 4), section('b', 1200, 2500, 8)];
  function renderPreview(activeSectionId: string, extra: Record<string, unknown> = {}) {
    const cfg: ShelvingConfiguration = { ...DEFAULT_CONFIGURATION, sections: MIXED };
    return render(
      createElement(
        Provider,
        { locale: 'ru' },
        createElement(ShelvingPreview, { config: cfg, interactive: true, framed: true, capacityMm: CAPACITY, activeSectionId, ...extra }),
      ),
    );
  }

  it('carries the active section’s own height and shelf count', () => {
    const onIncreaseShelves = vi.fn();
    const { container } = renderPreview('a', { minShelves: 2, maxShelves: 6, onIncreaseShelves });
    const handle = container.querySelector('button[data-axis="height"]')!;
    expect(handle.getAttribute('aria-valuenow')).toBe('1500');
    expect(container.querySelector('[data-testid="height-dimension-tag"]')!.textContent).toBe('1500');
    const shelvesGroup = screen.getByRole('group', { name: 'Полки · Секция 1' });
    expect(shelvesGroup.textContent).toContain('4');
    fireEvent.click(within(shelvesGroup).getByRole('button', { name: 'Увеличить количество полок' }));
    expect(onIncreaseShelves).toHaveBeenCalledTimes(1);
    // Section 1 is the first: no extension line is needed.
    expect(container.querySelector('[data-testid="height-extension-line"]')).toBeNull();
    cleanup();

    const second = renderPreview('b', { minShelves: 2, maxShelves: 8 });
    expect(second.container.querySelector('button[data-axis="height"]')!.getAttribute('aria-valuenow')).toBe('2500');
    expect(second.container.querySelector('[data-testid="height-dimension-tag"]')!.textContent).toBe('2500');
    const group2 = screen.getByRole('group', { name: 'Полки · Секция 2' });
    expect(group2.textContent).toContain('8');
    expect((within(group2).getByRole('button', { name: 'Увеличить количество полок' }) as HTMLButtonElement).disabled).toBe(true);
    expect(second.container.querySelector('[data-testid="height-extension-line"]')).not.toBeNull();
  });

  it('gives every section its own height strip; pressing a non-active one selects that section first', () => {
    const onSelectSection = vi.fn();
    // jsdom has no pointer capture; the drag itself is covered elsewhere.
    Object.assign(Element.prototype, { setPointerCapture() {}, releasePointerCapture() {} });
    const { container } = renderPreview('a', { onSelectSection });
    const zones = container.querySelectorAll('[data-testid="height-resize-zone"]');
    expect(zones).toHaveLength(2);
    fireEvent.pointerDown(zones[1], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onSelectSection).toHaveBeenCalledWith('b');
  });
});

describe('V2.4 preview — dimension labels stay readable on a small stage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderAtStageWidth(px: number, sections: ShelvingSection[]) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: px, height: px * 0.75 } as DOMRect);
    const cfg: ShelvingConfiguration = { ...DEFAULT_CONFIGURATION, sections };
    const result = render(createElement(ShelvingPreview, { config: cfg, interactive: true, framed: true, capacityMm: CAPACITY, activeSectionId: sections[0].id }));
    rect.mockRestore();
    return result.container.querySelector('svg')!;
  }

  const FIVE = [
    section('s1', 700, 1000, 2),
    section('s2', 1000, 1500, 4),
    section('s3', 1200, 2000, 6),
    section('s4', 1500, 2500, 8),
    section('s5', 1000, 3000, 5),
  ];

  it('enlarges text so it renders at ≥ 11px, and drops the informational depth tag when space is tight', () => {
    // A 5-section phone stage: 1 viewBox unit ≈ 0.75 px (unscaled text ≈ 7.5 px).
    const svg = renderAtStageWidth(480, FIVE);
    const unitPx = 480 / 640;
    for (const text of Array.from(svg.querySelectorAll('text'))) {
      expect(Number(text.getAttribute('font-size')) * unitPx).toBeGreaterThanOrEqual(11 - 1e-9);
    }
    expect(svg.querySelector('[data-testid="depth-dimension-tag"]')).toBeNull();
    // Every section width label still fits under its own section.
    expect(svg.querySelectorAll('text').length).toBeGreaterThanOrEqual(1 + FIVE.length + 1);
  });

  it('leaves labels at their normal size on a roomy stage', () => {
    const svg = renderAtStageWidth(900, [section('a', 1000, 2000, 5)]);
    for (const text of Array.from(svg.querySelectorAll('text'))) expect(Number(text.getAttribute('font-size'))).toBe(10);
    expect(svg.querySelector('[data-testid="depth-dimension-tag"]')).not.toBeNull();
  });
});
