import { describe, expect, it } from 'vitest';
import { configurationToSearchParams, parseConfigurationFromSearchParams } from '@/lib/configurator/url';
import type { ShelvingConfiguration } from '@/lib/types/domain';

function baseConfig(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
    sections: [
      { id: 'a', width: 700, rearWall: true, leftWall: false, rightWall: false },
      { id: 'b', width: 1500, rearWall: false, leftWall: false, rightWall: true },
      { id: 'c', width: 1000, rearWall: false, leftWall: true, rightWall: true },
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

describe('configurator URL — round trip', () => {
  it('preserves section order, widths and wall panels exactly', () => {
    const config = baseConfig();
    const params = configurationToSearchParams(config);
    const restored = parseConfigurationFromSearchParams(params);

    expect(restored.sections?.map((s) => s.width)).toEqual([700, 1500, 1000]);
    expect(restored.sections?.map((s) => s.rearWall)).toEqual([true, false, false]);
    expect(restored.sections?.map((s) => s.leftWall)).toEqual([false, false, true]);
    expect(restored.sections?.map((s) => s.rightWall)).toEqual([false, true, true]);
  });

  it('preserves height, depth and every scalar field', () => {
    const config = baseConfig({ height: 2400, depth: 500, shelves: 6, quantity: 3, promoCode: 'SKLAD2026' });
    const restored = parseConfigurationFromSearchParams(configurationToSearchParams(config));
    expect(restored.height).toBe(2400);
    expect(restored.depth).toBe(500);
    expect(restored.shelves).toBe(6);
    expect(restored.quantity).toBe(3);
    expect(restored.promoCode).toBe('SKLAD2026');
  });

  it('preserves accessory selections', () => {
    const config = baseConfig({ accessories: [{ accessoryId: 'acc-extra-shelf', quantity: 2 }] });
    const restored = parseConfigurationFromSearchParams(configurationToSearchParams(config));
    expect(restored.accessories).toEqual([{ accessoryId: 'acc-extra-shelf', quantity: 2 }]);
  });
});

describe('configurator URL — legacy link migration', () => {
  it('expands a legacy `width` + `sections=<count>` URL into N equal sections', () => {
    const params = new URLSearchParams('model=ms-standard&height=2000&width=1000&depth=400&shelves=5&sections=4');
    const restored = parseConfigurationFromSearchParams(params);
    expect(restored.sections?.length).toBe(4);
    expect(restored.sections?.every((s) => s.width === 1000)).toBe(true);
    expect(restored.sections?.every((s) => !s.rearWall && !s.leftWall && !s.rightWall)).toBe(true);
  });

  it('handles a legacy URL with only `width` and no `sections` param at all', () => {
    const params = new URLSearchParams('model=ms-standard&width=1200');
    const restored = parseConfigurationFromSearchParams(params);
    expect(restored.sections?.length).toBe(1);
    expect(restored.sections?.[0].width).toBe(1200);
  });
});

describe('configurator URL — malformed input never crashes', () => {
  it('ignores a garbage `sections` value instead of throwing', () => {
    const params = new URLSearchParams('model=ms-standard&sections=not-a-real-value,,;;');
    expect(() => parseConfigurationFromSearchParams(params)).not.toThrow();
  });

  it('ignores an out-of-range or non-numeric legacy section count', () => {
    const params = new URLSearchParams('width=1000&sections=abc');
    const restored = parseConfigurationFromSearchParams(params);
    expect(restored.sections?.length).toBeGreaterThanOrEqual(1);
  });

  it('caps a maliciously large section list at the maximum of 10', () => {
    const many = Array.from({ length: 40 }, () => '1000:0:0:0').join(',');
    const params = new URLSearchParams(`sections=${many}`);
    const restored = parseConfigurationFromSearchParams(params);
    expect(restored.sections?.length).toBeLessThanOrEqual(10);
  });

  it('returns an empty partial for a completely empty query string', () => {
    const restored = parseConfigurationFromSearchParams(new URLSearchParams(''));
    expect(restored.modelSlug).toBeUndefined();
    expect(restored.sections).toBeUndefined();
  });
});
