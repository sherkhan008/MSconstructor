import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  evaluateFormula,
  evaluateQuantity,
  FormulaError,
  parseFormula,
  validateFormula,
} from '@/lib/formula';

describe('formula tokenizer + parser', () => {
  it('evaluates arithmetic with correct precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', {})).toBe(14);
    expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20);
    expect(evaluateFormula('10 / 2 - 1', {})).toBe(4);
    expect(evaluateFormula('2 * (3 + (4 - 1))', {})).toBe(12);
  });

  it('reads variables from scope', () => {
    expect(evaluateFormula('sections * 4', { sections: 3 })).toBe(12);
    expect(evaluateFormula('shelves * sections', { shelves: 5, sections: 2 })).toBe(10);
  });

  it('supports comparisons and ternary expressions', () => {
    expect(evaluateFormula('sections > 1 ? sections * 2 + 2 : 4', { sections: 1 })).toBe(4);
    expect(evaluateFormula('sections > 1 ? sections * 2 + 2 : 4', { sections: 3 })).toBe(8);
    expect(evaluateFormula('sections >= 2 && shelves >= 3', { sections: 2, shelves: 3 })).toBe(1);
    expect(evaluateFormula('sections >= 2 && shelves >= 3', { sections: 1, shelves: 3 })).toBe(0);
  });

  it('supports logical or and short-circuiting', () => {
    expect(evaluateFormula('sections == 1 || sections == 3', { sections: 3 })).toBe(1);
    expect(evaluateFormula('sections == 1 || sections == 3', { sections: 2 })).toBe(0);
  });

  it('supports the whitelisted helper functions', () => {
    expect(evaluateFormula('max(sections, 2)', { sections: 5 })).toBe(5);
    expect(evaluateFormula('min(sections, 2)', { sections: 5 })).toBe(2);
    expect(evaluateFormula('ceil(width / 300)', { width: 1000 })).toBe(4);
    expect(evaluateFormula('floor(width / 300)', { width: 1000 })).toBe(3);
    expect(evaluateFormula('round(2.5)', {})).toBe(3);
    expect(evaluateFormula('abs(-4)', {})).toBe(4);
  });

  it('supports unary operators', () => {
    expect(evaluateFormula('-sections + 5', { sections: 2 })).toBe(3);
    expect(evaluateFormula('!0', {})).toBe(1);
    expect(evaluateFormula('!1', {})).toBe(0);
  });

  it('rejects unknown variables', () => {
    expect(() => evaluateFormula('doorCount * 2', {})).toThrow(FormulaError);
  });

  it('rejects unknown functions — no arbitrary code execution surface', () => {
    expect(() => parseFormula('eval(sections)')).toThrow(FormulaError);
    expect(() => parseFormula('constructor(sections)')).toThrow(FormulaError);
    expect(() => parseFormula('require(sections)')).toThrow(FormulaError);
  });

  it('rejects disallowed characters and malformed syntax', () => {
    expect(() => parseFormula('sections = 4')).toThrow(FormulaError);
    expect(() => parseFormula('sections ; shelves')).toThrow(FormulaError);
    expect(() => parseFormula('sections +')).toThrow(FormulaError);
    expect(() => parseFormula('(sections + 1')).toThrow(FormulaError);
    expect(() => parseFormula('sections `shelves`')).toThrow(FormulaError);
  });

  it('rejects division by zero at evaluation time', () => {
    expect(() => evaluateFormula('sections / 0', { sections: 4 })).toThrow(FormulaError);
  });

  it('rejects formulas longer than the configured limit', () => {
    const huge = Array.from({ length: 600 }, () => '1').join('+');
    expect(() => parseFormula(huge)).toThrow(FormulaError);
  });

  it('evaluateQuantity rounds up and floors negative results at zero', () => {
    expect(evaluateQuantity('width / 300', { width: 1000 })).toBe(4);
    expect(evaluateQuantity('sections * 2', { sections: 3 })).toBe(6);
    expect(evaluateQuantity('sections - 10', { sections: 2 })).toBe(0);
  });

  it('evaluateCondition treats any non-zero result as true', () => {
    expect(evaluateCondition('rearBrace == 1', { rearBrace: 1 })).toBe(true);
    expect(evaluateCondition('rearBrace == 1', { rearBrace: 0 })).toBe(false);
  });

  it('validateFormula reports unknown variables without throwing', () => {
    const result = validateFormula('sections * doorCount');
    expect(result.valid).toBe(false);
    expect(result.unknownVariables).toContain('doorCount');
  });

  it('validateFormula accepts real BOM formulas used by the seed rules', () => {
    const formulas = [
      'sharedUprights == 1 ? (sections + 1) * 2 : sections * 4',
      'shelves * sections',
      'shelves * sections * 2',
      'sharedUprights == 1 ? (sections + 1) * 4 : sections * 8',
      'rearBrace * sections * 2',
      'shelves * sections * 8 + sections * 16',
      'sharedUprights * (sections - 1)',
      '(rearSolid + rearPerforated) * sections',
      'sideCount',
    ];
    for (const formula of formulas) {
      const result = validateFormula(formula);
      expect(result.valid, `expected "${formula}" to be valid: ${result.error}`).toBe(true);
    }
  });
});
