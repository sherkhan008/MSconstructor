import { describe, expect, it } from 'vitest';
import {
  getMaxSectionHeight,
  getMaxSectionShelves,
  getTotalSectionShelves,
  getUniformSectionHeight,
  getUniformSectionShelves,
  hasUniformSectionDimensions,
  sectionHeightsSummary,
  sectionShelvesSummary,
} from '@/lib/configurator/section-dimensions';
import { sectionShelvesLabel } from '@/lib/plural';

const s = (height: number, shelves: number) => ({ height, shelves });

describe('section-dimension readers (V2.2A)', () => {
  it('uniform sections have one height/shelf reading', () => {
    const sections = [s(2000, 5), s(2000, 5), s(2000, 5)];
    expect(getUniformSectionHeight(sections)).toBe(2000);
    expect(getUniformSectionShelves(sections)).toBe(5);
    expect(hasUniformSectionDimensions(sections)).toBe(true);
    expect(sectionHeightsSummary(sections)).toBe('2000');
    expect(sectionShelvesSummary(sections)).toBe('5');
    expect(sectionShelvesLabel(sections, 'ru')).toBe('5 полок');
    expect(sectionShelvesLabel(sections, 'kk')).toBe('5 сөре');
  });

  it('mixed sections have no uniform reading; summaries list every section in row order', () => {
    const sections = [s(1500, 4), s(2500, 6), s(1000, 3)];
    expect(getUniformSectionHeight(sections)).toBeUndefined();
    expect(getUniformSectionShelves(sections)).toBeUndefined();
    expect(hasUniformSectionDimensions(sections)).toBe(false);
    expect(hasUniformSectionDimensions([s(2000, 4), s(2000, 5)])).toBe(false);
    expect(hasUniformSectionDimensions([s(2000, 5), s(2200, 5)])).toBe(false);
    expect(sectionHeightsSummary(sections)).toBe('1500 / 2500 / 1000');
    expect(sectionShelvesSummary(sections)).toBe('4 / 6 / 3');
    expect(sectionShelvesLabel(sections, 'ru')).toBe('4 полки / 6 полок / 3 полки');
  });

  it('envelope and totals use every section, never just the first', () => {
    const sections = [s(1000, 3), s(3000, 8), s(1500, 4)];
    expect(getMaxSectionHeight(sections)).toBe(3000);
    expect(getMaxSectionShelves(sections)).toBe(8);
    expect(getTotalSectionShelves(sections)).toBe(15);
  });

  it('is safe with no sections', () => {
    expect(getUniformSectionHeight([])).toBeUndefined();
    expect(hasUniformSectionDimensions([])).toBe(false);
    expect(getMaxSectionHeight([])).toBe(0);
    expect(sectionHeightsSummary([])).toBe('');
  });
});
