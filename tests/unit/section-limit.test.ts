// @vitest-environment jsdom
import { createElement, type ComponentType, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_MAX_SECTIONS, MAX_SECTIONS, MIN_SECTIONS } from '@/lib/configurator/limits';
import * as schema from '@/lib/pricing/schema';
import * as store from '@/store/configurator-store';
import { DEFAULT_CONFIGURATION, migrateConfiguratorState, useConfiguratorStore } from '@/store/configurator-store';
import { configurationToShareQuery, parseConfigurationFromSearchParams } from '@/lib/configurator/url';
import { ParametersSectionsTable } from '@/components/configurator/ParametersSectionsTable';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog, type PublicCatalog } from '@/lib/data/public-catalog';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import type { Locale } from '@/lib/i18n/locales';

/**
 * V2.1: one shelving configuration holds at most 5 sections. One shared
 * constant (src/lib/configurator/limits.ts); the server schema is the
 * authority, the store/UI mirror it, and older 6–10 section data is kept
 * intact (shown as invalid) rather than silently truncated.
 */

function sections(n: number): ShelvingSection[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false }));
}

function config(n: number): ShelvingConfiguration {
  return { ...DEFAULT_CONFIGURATION, sections: sections(n) };
}

function resetStore(n = 1) {
  const c = config(n);
  useConfiguratorStore.setState({ config: c, activeSectionId: c.sections[0].id, priceResult: null, pricingError: null });
}

describe('one authoritative section limit', () => {
  it('is 5, and the schema and store re-export the very same constant', () => {
    expect(MAX_SECTIONS).toBe(5);
    expect(MIN_SECTIONS).toBe(1);
    expect(schema.MAX_SECTIONS).toBe(MAX_SECTIONS);
    expect(store.MAX_SECTIONS).toBe(MAX_SECTIONS);
    expect(schema.MIN_SECTIONS).toBe(MIN_SECTIONS);
    expect(store.MIN_SECTIONS).toBe(MIN_SECTIONS);
  });
});

describe('server schema', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    it(`accepts ${n} section(s)`, () => {
      expect(schema.parseConfiguration(config(n)).success).toBe(true);
    });
  }

  for (const n of [6, 10]) {
    it(`rejects ${n} sections`, () => {
      const parsed = schema.parseConfiguration(config(n));
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.some((i) => i.path.join('.') === 'sections')).toBe(true);
    });
  }
});

describe('configurator store', () => {
  beforeEach(() => resetStore(1));

  it('cannot add a 6th section', () => {
    resetStore(5);
    useConfiguratorStore.getState().addSection();
    expect(useConfiguratorStore.getState().config.sections).toHaveLength(5);
  });

  it('cannot duplicate into a 6th section', () => {
    resetStore(5);
    useConfiguratorStore.getState().duplicateSection('s0');
    expect(useConfiguratorStore.getState().config.sections).toHaveLength(5);
  });

  it('keeps a persisted 8-section configuration intact — not truncated (v3 and migrated V2.1 v2)', () => {
    const current = migrateConfiguratorState({ config: config(8), activeSectionId: 's3' }, 3);
    expect(current.config.sections.map((s) => s.id)).toEqual(sections(8).map((s) => s.id));
    expect(current.activeSectionId).toBe('s3');

    const rowLevelSections = sections(8).map(({ height: _h, shelves: _s, ...rest }) => rest);
    const v21 = { config: { ...DEFAULT_CONFIGURATION, height: 2000, shelves: 5, sections: rowLevelSections }, activeSectionId: 's3' };
    const migrated = migrateConfiguratorState(v21, 2);
    expect(migrated.config.sections).toEqual(sections(8));
    expect(migrated.activeSectionId).toBe('s3');
  });

  it('lets an over-limit configuration shrink but never grow', () => {
    resetStore(7);
    useConfiguratorStore.getState().addSection();
    useConfiguratorStore.getState().duplicateSection('s1');
    expect(useConfiguratorStore.getState().config.sections).toHaveLength(7);
    useConfiguratorStore.getState().removeSection('s6');
    useConfiguratorStore.getState().removeSection('s5');
    expect(useConfiguratorStore.getState().config.sections).toHaveLength(5);
    expect(schema.parseConfiguration(useConfiguratorStore.getState().config).success).toBe(true);
  });
});

describe('share links', () => {
  it('opens an older 6–10 section link with every section (shown as invalid), not a truncated one', () => {
    const query = configurationToShareQuery(config(7));
    const parsed = parseConfigurationFromSearchParams(new URLSearchParams(query));
    expect(parsed.sections).toHaveLength(7);
  });

  it('refuses a hand-edited link above the old parse ceiling outright (never a silent truncation)', () => {
    const atCeiling = parseConfigurationFromSearchParams(new URLSearchParams(configurationToShareQuery(config(LEGACY_MAX_SECTIONS))));
    expect(atCeiling.sections).toHaveLength(LEGACY_MAX_SECTIONS);
    const query = configurationToShareQuery(config(25));
    const parsed = parseConfigurationFromSearchParams(new URLSearchParams(query));
    expect(parsed.sections).toBeUndefined();
  });
});

describe('sections panel', () => {
  let catalog: PublicCatalog;
  beforeAll(async () => {
    catalog = toPublicCatalog(await getCatalog());
  });

  // Same cast as tests/integration/helpers/public-page.ts: children passed positionally.
  const Provider = LocaleProvider as ComponentType<{ locale: Locale; children?: ReactNode }>;

  function renderPanel() {
    return render(createElement(Provider, { locale: 'ru' }, createElement(ParametersSectionsTable, { catalog })));
  }

  afterEach(cleanup);

  const addButton = () => screen.getByRole('button', { name: 'Добавить секцию' }) as HTMLButtonElement;

  it('disables adding a 6th section and says the maximum is reached', () => {
    resetStore(4);
    renderPanel();
    expect(addButton().disabled).toBe(false);
    fireEvent.click(addButton());
    expect(useConfiguratorStore.getState().config.sections).toHaveLength(5);
    expect(addButton().disabled).toBe(true);
    expect(screen.getByText('Достигнуто максимальное количество секций.')).toBeTruthy();
    fireEvent.click(addButton());
    expect(useConfiguratorStore.getState().config.sections).toHaveLength(5);
  });

  it('explains an over-limit (persisted) configuration instead of hiding or trimming it', () => {
    resetStore(7);
    renderPanel();
    expect(screen.getAllByRole('button', { name: 'Удалить секцию' })).toHaveLength(7);
    expect(screen.getByRole('alert').textContent).toBe('В одном стеллаже не более 5 секций. Удалите лишние секции.');
  });
});
