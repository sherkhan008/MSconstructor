import { describe, expect, it } from 'vitest';
import {
  CONFIGURATION_URL_VERSION,
  configurationToSearchParams,
  configurationToShareQuery,
  parseConfigurationFromSearchParams,
} from '@/lib/configurator/url';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

function baseConfig(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    depth: 400,
    sections: [
      { id: 'a', width: 700, height: 2000, shelves: 5, rearWall: true, leftWall: false, rightWall: false },
      { id: 'b', width: 1500, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: true },
      { id: 'c', width: 1000, height: 2000, shelves: 5, rearWall: false, leftWall: true, rightWall: true },
    ],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}

/** Section ids are minted fresh on every decode; everything else must survive. */
function withoutIds(config: Partial<ShelvingConfiguration>) {
  const ids = config.sections?.map((s) => s.id) ?? [];
  return {
    ...config,
    sections: config.sections?.map(({ id: _id, ...rest }) => rest),
    accessories: config.accessories?.map((a) =>
      a.sectionId === undefined ? a : { ...a, sectionId: `#${ids.indexOf(a.sectionId)}` },
    ),
  };
}

function roundTrip(config: ShelvingConfiguration) {
  return parseConfigurationFromSearchParams(new URLSearchParams(configurationToShareQuery(config)));
}

describe('configurator URL v2 — exact round trip', () => {
  it('marks the format version and has no row-level height/shelves', () => {
    const params = configurationToSearchParams(baseConfig());
    expect(params.get('v')).toBe(CONFIGURATION_URL_VERSION);
    expect(CONFIGURATION_URL_VERSION).toBe('2');
    expect(params.has('height')).toBe(false);
    expect(params.has('shelves')).toBe(false);
    expect(params.get('sections')).toBe('700:2000:5:1:0:0,1500:2000:5:0:0:1,1000:2000:5:0:1:1');
  });

  it('configuration → URL → configuration is exact (ids aside) for a representative spread', () => {
    const cases: ShelvingConfiguration[] = [
      baseConfig(),
      baseConfig({ depth: 600, quantity: 3, promoCode: 'SKLAD2026', loadCapacity: 100, deliveryId: 'delivery-city' }),
      baseConfig({ metalFootPad: true, shelfCornerBrackets: true, assemblyId: 'assembly-professional' }),
      baseConfig({
        sections: [
          { id: 'x', width: 700, height: 1000, shelves: 4, rearWall: false, leftWall: false, rightWall: false },
          { id: 'y', width: 1000, height: 1000, shelves: 4, rearWall: true, leftWall: true, rightWall: true },
        ],
        accessories: [
          { accessoryId: 'acc-adjustable-feet', quantity: 1 },
          { accessoryId: 'acc-shelf-reinforcement', quantity: 8 },
          { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'y' },
        ],
      }),
      baseConfig({
        sections: Array.from({ length: 5 }, (_, i) => ({
          id: `s${i}`,
          width: 1000,
          height: 3000,
          shelves: 8,
          rearWall: i % 2 === 0,
          leftWall: false,
          rightWall: false,
        })),
      }),
    ];
    // Applied the way the configurator applies a link (loadFromPartial):
    // onto a different draft, which must not leak into the result.
    const otherDraft = baseConfig({
      depth: 300,
      quantity: 2,
      accessories: [{ accessoryId: 'acc-adjustable-feet', quantity: 1 }],
      sections: [{ id: 'z', width: 1200, height: 1800, shelves: 6, rearWall: true, leftWall: true, rightWall: true }],
    });
    for (const config of cases) {
      expect(withoutIds({ ...otherDraft, ...roundTrip(config) })).toEqual(withoutIds(config));
    }
  });

  it('carries each section’s own height and shelf count (not a shared value)', () => {
    const config = baseConfig({
      sections: [
        { id: 'a', width: 1000, height: 1500, shelves: 4, rearWall: false, leftWall: false, rightWall: false },
        { id: 'b', width: 1000, height: 2500, shelves: 6, rearWall: false, leftWall: false, rightWall: false },
        { id: 'c', width: 1000, height: 1000, shelves: 3, rearWall: false, leftWall: false, rightWall: false },
      ],
    });
    const restored = roundTrip(config);
    expect(restored.sections?.map((s) => [s.height, s.shelves])).toEqual([
      [1500, 4],
      [2500, 6],
      [1000, 3],
    ]);
  });

  it('remaps a section-scoped accessory to the freshly decoded section in the same position', () => {
    const config = baseConfig({ accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 'c' }] });
    const restored = roundTrip(config);
    const targetId = restored.sections?.[2]?.id;
    expect(targetId).toBeDefined();
    expect(targetId).not.toBe('c');
    expect(restored.accessories).toEqual([{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: targetId }]);
  });

  it('omits metalFootPad/shelfCornerBrackets from the URL and the restored partial when unset', () => {
    const params = configurationToSearchParams(baseConfig());
    expect(params.has('metalFootPad')).toBe(false);
    expect(params.has('shelfCornerBrackets')).toBe(false);
    const restored = parseConfigurationFromSearchParams(params);
    expect(restored.metalFootPad).toBeUndefined();
    expect(restored.shelfCornerBrackets).toBeUndefined();
  });
});

describe('configurator URL v2 — strict, unambiguous parsing', () => {
  const v2 = (sections: string, extra = '') => parseConfigurationFromSearchParams(new URLSearchParams(`v=2&model=ms-standard&sections=${sections}${extra}`));

  it.each([
    ['too few fields', '1000:2000:5:0:0'],
    ['too many fields', '1000:2000:5:0:0:0:0'],
    ['non-numeric width', 'abc:2000:5:0:0:0'],
    ['zero height', '1000:0:5:0:0:0'],
    ['negative shelves', '1000:2000:-5:0:0:0'],
    ['fractional height', '1000:2000.5:5:0:0:0'],
    ['flag not 0/1', '1000:2000:5:true:0:0'],
    ['empty entry', '1000:2000:5:0:0:0,'],
    ['V2.1-shaped entry under v=2', '1000:0:0:0'],
  ])('rejects the whole section list for %s', (_label, sections) => {
    expect(v2(sections).sections).toBeUndefined();
  });

  it('drops the whole list when one entry is malformed (row positions never shift)', () => {
    const restored = v2('700:2000:5:0:0:0,oops,1000:2000:5:0:0:0', '&acc=acc-cross-brace:1:2');
    expect(restored.sections).toBeUndefined();
    expect(restored.accessories).toEqual([{ accessoryId: 'acc-cross-brace', quantity: 1 }]);
  });

  it('ignores the sections of an unknown format version', () => {
    const restored = parseConfigurationFromSearchParams(new URLSearchParams('v=3&model=ms-standard&depth=400&sections=1000:2000:5:0:0:0'));
    expect(restored.sections).toBeUndefined();
    expect(restored.depth).toBe(400);
  });

  it('never reads a row-level height/shelves in v2', () => {
    const restored = v2('1000:1500:4:0:0:0', '&height=3000&shelves=8');
    expect(restored.sections?.map((s) => [s.height, s.shelves])).toEqual([[1500, 4]]);
    expect(restored).not.toHaveProperty('height');
    expect(restored).not.toHaveProperty('shelves');
  });

  it('keeps up to 10 sections (the old parse ceiling) and refuses a longer list outright', () => {
    const entry = '1000:2000:5:0:0:0';
    expect(v2(Array.from({ length: 7 }, () => entry).join(',')).sections).toHaveLength(7);
    expect(v2(Array.from({ length: 40 }, () => entry).join(',')).sections).toBeUndefined();
  });

  it('never throws on garbage', () => {
    expect(() => parseConfigurationFromSearchParams(new URLSearchParams('v=2&sections=not-a-real-value,,;;'))).not.toThrow();
    expect(() => parseConfigurationFromSearchParams(new URLSearchParams('sections=%%%&height=x'))).not.toThrow();
  });

  it('returns an empty partial for a completely empty query string', () => {
    const restored = parseConfigurationFromSearchParams(new URLSearchParams(''));
    expect(restored.modelSlug).toBeUndefined();
    expect(restored.sections).toBeUndefined();
  });
});

describe('configurator URL — small V2.1 legacy reader', () => {
  it('copies the old row-level height/shelves into every section (lossless)', () => {
    const restored = parseConfigurationFromSearchParams(
      new URLSearchParams('model=ms-standard&height=2500&depth=600&shelves=6&sections=1000:1:0:0,700:0:0:1'),
    );
    const sections = restored.sections as ShelvingSection[];
    expect(sections.map(({ id: _id, ...s }) => s)).toEqual([
      { width: 1000, height: 2500, shelves: 6, rearWall: true, leftWall: false, rightWall: false },
      { width: 700, height: 2500, shelves: 6, rearWall: false, leftWall: false, rightWall: true },
    ]);
    expect(restored.depth).toBe(600);
  });

  it.each([
    ['non-0/1 rear flag', '1000:x:0:0'],
    ['non-0/1 left flag', '1000:0:true:0'],
    ['non-0/1 right flag', '1000:0:0:false'],
    ['empty flag', '1000::0:0'],
    ['one bad entry among good ones', '1000:1:0:0,700:0:2:0,1200:0:0:1'],
  ])('rejects the whole legacy section list for a malformed wall flag (%s)', (_label, sections) => {
    const restored = parseConfigurationFromSearchParams(
      new URLSearchParams(`model=ms-standard&height=2000&depth=400&shelves=5&sections=${sections}`),
    );
    expect(restored.sections).toBeUndefined();
    expect(restored.depth).toBe(400);
  });

  it.each([
    ['height=2000abc&shelves=5'],
    ['height=2000.5&shelves=5'],
    ['height=2000&shelves=5x'],
    ['height=0&shelves=5'],
  ])('rejects the legacy section list for a malformed row-level value (%s)', (query) => {
    const restored = parseConfigurationFromSearchParams(new URLSearchParams(`model=ms-standard&${query}&sections=1000:0:0:0`));
    expect(restored.sections).toBeUndefined();
  });

  it('does not guess sections when the legacy link lacks its height or shelves', () => {
    expect(parseConfigurationFromSearchParams(new URLSearchParams('model=ms-standard&shelves=5&sections=1000:0:0:0')).sections).toBeUndefined();
    expect(parseConfigurationFromSearchParams(new URLSearchParams('model=ms-standard&height=2000&sections=1000:0:0:0')).sections).toBeUndefined();
  });

  it('does not read the pre-V2 `width` + section-count shape any more', () => {
    const restored = parseConfigurationFromSearchParams(new URLSearchParams('model=ms-standard&height=2000&width=1000&shelves=5&sections=4'));
    expect(restored.sections).toBeUndefined();
  });
});
