import { describe, expect, it } from 'vitest';
import { resolveRackFill, shade, STANDARD_RACK_HEX } from '@/components/configurator/rack-colors';
import { DEFAULT_CONFIGURATION } from '@/store/configurator-store';
import type { ColorOption } from '@/lib/types/domain';

function color(overrides: Partial<ColorOption> = {}): ColorOption {
  return {
    id: 'color-blue',
    name: { ru: 'Синий', kk: 'Көк' },
    hex: '#2F5D8A',
    pricePercent: 5,
    leadTimeDays: 7,
    available: true,
    sortOrder: 5,
    ...overrides,
  };
}

describe('resolveRackFill', () => {
  it('uses the reference light-grey constant when no color is resolved', () => {
    expect(resolveRackFill(undefined)).toBe(STANDARD_RACK_HEX);
  });

  it('uses the reference light-grey constant for the default/standard color id, not its own catalog hex', () => {
    const grey = color({ id: DEFAULT_CONFIGURATION.colorId, hex: '#8B939D' });
    expect(resolveRackFill(grey)).toBe(STANDARD_RACK_HEX);
  });

  it('uses the real selected hex for any other color — the configurable color system still works', () => {
    const blue = color({ id: 'color-blue', hex: '#2F5D8A' });
    expect(resolveRackFill(blue)).toBe('#2F5D8A');
  });
});

describe('shade', () => {
  it('lightens toward white for a positive percent', () => {
    expect(shade('#000000', 50)).toBe('#808080');
  });

  it('darkens toward black for a negative percent', () => {
    expect(shade('#ffffff', -50)).toBe('#808080');
  });

  it('never returns fully black/white from a small restrained shift (subtle depth, not a new material)', () => {
    const lighter = shade(STANDARD_RACK_HEX, 4);
    const darker = shade(STANDARD_RACK_HEX, -6);
    expect(lighter.toLowerCase()).not.toBe('#ffffff');
    expect(darker.toLowerCase()).not.toBe('#000000');
    // Both stay in the same light-grey family as the base color.
    expect(lighter.toLowerCase()).not.toBe(darker.toLowerCase());
  });
});
