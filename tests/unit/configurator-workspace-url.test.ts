import { describe, expect, it } from 'vitest';
import {
  configurationToShareQuery,
  parseWorkspaceFromSearchParams,
  WORKSPACE_KIT_KEYS,
  WORKSPACE_URL_VERSION,
  workspaceToSearchParams,
  workspaceToShareQuery,
} from '@/lib/configurator/url';
import { MAX_WORKSPACE_KITS } from '@/lib/configurator/limits';
import { safeSwitchQuery, switchLocaleHref, SWITCHABLE_QUERY_KEYS } from '@/lib/i18n/locales';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * Configurator V2.5 workspace links (`v=3`): every kit, in order, with its
 * full configuration, and the active kit — deterministic, exact round trip
 * (apart from freshly minted section ids), all-or-nothing on malformed input,
 * and carried intact by the KZ/RU language switch.
 */

const section = (width: number, height: number, shelves: number, walls: Partial<ShelvingSection> = {}, id = `${width}-${height}`): ShelvingSection => ({
  id,
  width,
  height,
  shelves,
  rearWall: false,
  leftWall: false,
  rightWall: false,
  ...walls,
});

function kit(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections: [section(1000, 2000, 5)],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    // Optional flags are only written when set (a link never carries
    // `false`; opening one fills them from DEFAULT_CONFIGURATION).
    ...overrides,
  };
}

/** A realistic mixed workspace: mixed heights/shelves/widths, walls, section
 * accessories, kit-wide options, quantities and services per kit. */
function mixedWorkspace(): ShelvingConfiguration[] {
  const k1Sections = [section(700, 1000, 2, {}, 'a'), section(1000, 1500, 4, { rearWall: true }, 'b'), section(1200, 2500, 8, { leftWall: true, rightWall: true }, 'c')];
  const k3Sections = [section(1000, 2000, 5, {}, 'x'), section(1000, 3000, 6, { rightWall: true }, 'y')];
  return [
    kit({
      sections: k1Sections,
      accessories: [
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'b' },
        { accessoryId: 'acc-shelf-reinforcement', quantity: 14 },
      ],
      quantity: 2,
      metalFootPad: true,
    }),
    kit({ depth: 600, loadCapacity: 100, assemblyId: 'assembly-professional', deliveryId: 'delivery-city' }),
    kit({
      sections: k3Sections,
      accessories: [
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'x' },
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'y' },
        { accessoryId: 'acc-adjustable-feet', quantity: 1 },
      ],
      shelfCornerBrackets: true,
      promoCode: 'SPRING-10',
    }),
  ];
}

/** Section ids are minted fresh on every decode; everything else must survive. */
function withoutIds(config: Partial<ShelvingConfiguration>) {
  const ids = config.sections?.map((s) => s.id) ?? [];
  return {
    ...config,
    sections: config.sections?.map(({ id: _id, ...rest }) => rest),
    accessories: config.accessories?.map((a) => (a.sectionId === undefined ? a : { ...a, sectionId: `#${ids.indexOf(a.sectionId)}` })),
  };
}

const parse = (query: string) => parseWorkspaceFromSearchParams(new URLSearchParams(query));

describe('workspace URL v3 — format and exact round trip', () => {
  it('is versioned, carries the active kit (1-based) and one key per kit, each a complete v2 kit query', () => {
    const configs = mixedWorkspace();
    const params = workspaceToSearchParams(configs, 2);
    expect(WORKSPACE_URL_VERSION).toBe('3');
    expect(params.get('v')).toBe('3');
    expect(params.get('active')).toBe('3');
    expect([...params.keys()]).toEqual(['v', 'active', 'k1', 'k2', 'k3']);
    configs.forEach((config, i) => expect(params.get(`k${i + 1}`)).toBe(configurationToShareQuery(config)));
    // No internal ids (kit ids, section ids) and no corner fields in any kit.
    const query = workspaceToShareQuery(configs, 0);
    expect(query).not.toMatch(/kitId|sectionId|%3Aa%2C/);
    for (const key of WORKSPACE_KIT_KEYS.slice(0, 3)) {
      expect([...new URLSearchParams(params.get(key)!).keys()].filter((k) => /corner/i.test(k) && k !== 'shelfCornerBrackets')).toEqual([]);
    }
  });

  it('is deterministic', () => {
    expect(workspaceToShareQuery(mixedWorkspace(), 1)).toBe(workspaceToShareQuery(mixedWorkspace(), 1));
  });

  it('round-trips every kit exactly — order, sections, walls, options, services, quantity, section accessories', () => {
    const configs = mixedWorkspace();
    const link = parse(workspaceToShareQuery(configs, 1))!;
    expect(link.activeIndex).toBe(1);
    expect(link.kits).toHaveLength(3);
    link.kits.forEach((parsed, i) => expect(withoutIds(parsed)).toEqual(withoutIds(configs[i])));
    // Section-scoped accessories point at the right (freshly minted) section.
    const k3 = link.kits[2];
    expect(k3.accessories!.filter((a) => a.sectionId).map((a) => k3.sections!.findIndex((s) => s.id === a.sectionId))).toEqual([0, 1]);
  });

  it('round-trips workspace → URL → workspace → URL byte for byte', () => {
    const first = workspaceToShareQuery(mixedWorkspace(), 2);
    const link = parse(first)!;
    const again = workspaceToShareQuery(link.kits as ShelvingConfiguration[], link.activeIndex);
    expect(again).toBe(first);
  });

  it('round-trips a full 5-kit workspace, every kit a distinct mixed rack', () => {
    const configs = Array.from({ length: MAX_WORKSPACE_KITS }, (_, i) =>
      kit({ sections: [section(700, 1000 + i * 500, 2 + i, { rearWall: i % 2 === 0 }), section(1000, 2000, 5)], quantity: 1 }),
    );
    const link = parse(workspaceToShareQuery(configs, 4))!;
    expect(link.activeIndex).toBe(4);
    expect(link.kits.map(withoutIds)).toEqual(configs.map(withoutIds));
  });
});

describe('workspace URL v3 — safe parsing', () => {
  const valid = () => workspaceToSearchParams(mixedWorkspace(), 0);

  it('an unusable active kit selects the first kit (kits are still opened)', () => {
    for (const active of ['0', '9', '-1', 'x', '1.5', '']) {
      const params = valid();
      params.set('active', active);
      expect(parseWorkspaceFromSearchParams(params)?.activeIndex, active).toBe(0);
    }
    const params = valid();
    params.delete('active');
    expect(parseWorkspaceFromSearchParams(params)?.kits).toHaveLength(3);
  });

  it('rejects the whole link (null) when any kit is malformed or incomplete — never a partial workspace', () => {
    const mutations: ((p: URLSearchParams) => void)[] = [
      (p) => p.delete('k1'), // gap: k2, k3 without k1
      (p) => p.delete('k2'), // gap
      (p) => {
        p.set('k4', configurationToShareQuery(kit()));
        p.delete('k3');
      }, // k4 without k3
      (p) => p.set('k2', 'garbage'),
      (p) => p.set('k2', ''),
      (p) => p.set('k2', configurationToShareQuery(kit()).replace('v=2', 'v=9')),
      (p) => p.set('k2', configurationToShareQuery(kit()).replace(/&sections=[^&]*/, '')),
      (p) => p.set('k2', configurationToShareQuery(kit()).replace(/sections=[^&]*/, 'sections=1000%3A2000%3A5%3A0%3A0')),
      (p) => p.set('k2', configurationToShareQuery(kit()).replace(/&qty=\d+/, '')),
      (p) => p.set('k2', configurationToShareQuery(kit()).replace(/&delivery=[^&]*/, '')),
      (p) => p.set('k2', configurationToShareQuery(kit()).replace(/model=[^&]*/, 'model=%3Cscript%3E')),
    ];
    for (const mutate of mutations) {
      const params = valid();
      mutate(params);
      expect(() => parseWorkspaceFromSearchParams(params)).not.toThrow();
      expect(parseWorkspaceFromSearchParams(params), params.toString().slice(0, 120)).toBeNull();
    }
  });

  it('rejects more than 5 kits', () => {
    const configs = Array.from({ length: MAX_WORKSPACE_KITS + 1 }, () => kit());
    const params = new URLSearchParams(workspaceToShareQuery(configs.slice(0, 5), 0));
    params.set('k6', configurationToShareQuery(kit()));
    expect(parseWorkspaceFromSearchParams(params)).toBeNull();
  });

  it('keeps Σ quantity as linked (the cart/order refuse more than 5 racks; nothing is silently clamped)', () => {
    const link = parse(workspaceToShareQuery([kit({ quantity: 3 }), kit({ quantity: 3 })], 0))!;
    expect(link.kits.map((k) => k.quantity)).toEqual([3, 3]);
  });

  it('a v3 link with no kits, and a page without configuration parameters, open nothing', () => {
    expect(parse('v=3')).toBeNull();
    expect(parse('v=3&active=1')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('utm_source=x')).toBeNull();
  });

  it('malformed input never throws', () => {
    for (const query of ['v=3&k1=%%%', 'v=3&k1=v%3D2%26sections%3D%2C%2C', 'v=3&k1=' + 'x'.repeat(10_000), 'v=3&k0=a&k1=b']) {
      expect(() => parse(query), query.slice(0, 40)).not.toThrow();
      expect(parse(query)).toBeNull();
    }
  });
});

describe('old single-kit links → a one-kit workspace', () => {
  it('a V2.4 (v2) link opens as kit 1 with every value it carries', () => {
    const config = mixedWorkspace()[0];
    const link = parse(configurationToShareQuery(config))!;
    expect(link.activeIndex).toBe(0);
    expect(link.kits).toHaveLength(1);
    expect(withoutIds(link.kits[0])).toEqual(withoutIds(config));
  });

  it('an unversioned V2.1 link opens as one kit (row-level height/shelves copied into every section)', () => {
    const link = parse('model=ms-standard&height=2000&shelves=5&depth=400&sections=1000:1:0:0,700:0:0:1&qty=2')!;
    expect(link.kits).toHaveLength(1);
    expect(link.kits[0].sections!.map((s) => [s.width, s.height, s.shelves, s.rearWall, s.rightWall])).toEqual([
      [1000, 2000, 5, true, false],
      [700, 2000, 5, false, true],
    ]);
    expect(link.kits[0].quantity).toBe(2);
  });
});

describe('language switch carries the whole workspace', () => {
  it('allow-lists every key a workspace link can contain', () => {
    const keys = [...workspaceToSearchParams(Array.from({ length: MAX_WORKSPACE_KITS }, () => kit()), 0).keys()];
    expect(keys).toEqual(['v', 'active', ...WORKSPACE_KIT_KEYS]);
    for (const key of keys) expect(SWITCHABLE_QUERY_KEYS['/configurator'], key).toContain(key);
  });

  it('KZ → RU → KZ keeps v=3, the active kit and every kit byte for byte', () => {
    const query = workspaceToShareQuery(mixedWorkspace(), 2);
    const ru = switchLocaleHref('/configurator', `?${query}`, 'ru');
    expect(ru.startsWith('/ru/configurator?')).toBe(true);
    const carried = new URLSearchParams(ru.split('?')[1]);
    expect(carried.get('v')).toBe('3');
    expect(carried.get('active')).toBe('3');
    for (const [key, value] of new URLSearchParams(query)) expect(carried.get(key), key).toBe(value);
    const kk = switchLocaleHref('/ru/configurator', `?${carried}`, 'kk');
    expect(new URLSearchParams(kk.split('?')[1]).toString()).toBe(carried.toString());
    // …and what arrives is still the same workspace.
    const link = parseWorkspaceFromSearchParams(new URLSearchParams(kk.split('?')[1]))!;
    expect(link.kits.map(withoutIds)).toEqual(mixedWorkspace().map(withoutIds));
    expect(link.activeIndex).toBe(2);
  });

  it('keeps a long kit (5 sections, every option and accessory) that is over the generic 500-character value limit', () => {
    const sections = Array.from({ length: 5 }, (_, i) => section(1000, 2000, 5, { rearWall: true, leftWall: true, rightWall: true }, `s${i}`));
    const big = kit({
      sections,
      accessories: [
        ...sections.map((s) => ({ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: s.id })),
        ...Array.from({ length: 10 }, (_, i) => ({ accessoryId: `acc-some-long-accessory-name-${i}`, quantity: 40 })),
      ],
      promoCode: 'A'.repeat(40),
      metalFootPad: true,
      shelfCornerBrackets: true,
    });
    const query = workspaceToShareQuery([big, kit()], 0);
    expect(new URLSearchParams(query).get('k1')!.length).toBeGreaterThan(500);
    expect(safeSwitchQuery('/configurator', `?${query}`)).toBe(`?${query}`);
  });

  it('still drops an absurdly large kit value and every non-configurator parameter', () => {
    const search = `?v=3&active=1&k1=${'x'.repeat(5000)}&utm_source=x&next=//evil`;
    expect(safeSwitchQuery('/configurator', search)).toBe('?v=3&active=1');
  });
});
