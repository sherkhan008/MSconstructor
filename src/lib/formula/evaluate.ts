import {
  ALLOWED_FUNCTIONS,
  collectVariables,
  FormulaError,
  parseFormula,
  type AstNode,
} from './parser';

/**
 * Evaluation of a parsed formula against a bounded variable scope.
 * Booleans are represented as 1 / 0 so a condition can be used arithmetically.
 */

export type FormulaScope = Record<string, number>;

/** Variables the configurator always provides to every rule. */
export const CORE_VARIABLES = [
  'sections',
  'shelves',
  'width',
  'depth',
  'height',
  'quantity',
  'loadCapacity',
] as const;

/**
 * Additional variables exposed to rules so wall/brace quantities can be
 * expressed as formulas instead of hardcoded branches in React.
 */
export const EXTENDED_VARIABLES = [
  'rearSolid',
  'rearPerforated',
  'rearBrace',
  'sideCount',
  'sidePerforated',
  'sharedUprights',
  'isRow',
  'shelfReinforced',
] as const;

export const ALLOWED_VARIABLES: readonly string[] = [...CORE_VARIABLES, ...EXTENDED_VARIABLES];

const MAX_RESULT = 100_000;

export function evaluateAst(node: AstNode, scope: FormulaScope): number {
  switch (node.kind) {
    case 'number':
      return node.value;

    case 'variable': {
      if (!Object.prototype.hasOwnProperty.call(scope, node.name)) {
        throw new FormulaError(`Неизвестная переменная «${node.name}»`);
      }
      const value = scope[node.name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new FormulaError(`Переменная «${node.name}» не является числом`);
      }
      return value;
    }

    case 'unary': {
      const operand = evaluateAst(node.operand, scope);
      if (node.operator === '-') return -operand;
      if (node.operator === '+') return operand;
      return operand === 0 ? 1 : 0;
    }

    case 'binary': {
      // Short-circuit the logical operators before evaluating the right side.
      if (node.operator === '&&') {
        return evaluateAst(node.left, scope) !== 0 && evaluateAst(node.right, scope) !== 0 ? 1 : 0;
      }
      if (node.operator === '||') {
        return evaluateAst(node.left, scope) !== 0 || evaluateAst(node.right, scope) !== 0 ? 1 : 0;
      }

      const left = evaluateAst(node.left, scope);
      const right = evaluateAst(node.right, scope);

      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (right === 0) throw new FormulaError('Деление на ноль');
          return left / right;
        case '%':
          if (right === 0) throw new FormulaError('Деление на ноль');
          return left % right;
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        case '==':
          return left === right ? 1 : 0;
        case '!=':
          return left !== right ? 1 : 0;
        default: {
          const never: never = node.operator;
          throw new FormulaError(`Неизвестный оператор «${String(never)}»`);
        }
      }
    }

    case 'ternary':
      return evaluateAst(node.condition, scope) !== 0
        ? evaluateAst(node.whenTrue, scope)
        : evaluateAst(node.whenFalse, scope);

    case 'call': {
      const args = node.args.map((arg) => evaluateAst(arg, scope));
      const fn = ALLOWED_FUNCTIONS[node.name] as (...values: number[]) => number;
      return fn(...args);
    }
  }
}

/** Parse + evaluate in one step. Throws FormulaError on any problem. */
export function evaluateFormula(formula: string, scope: FormulaScope): number {
  const result = evaluateAst(parseFormula(formula), scope);
  if (!Number.isFinite(result)) {
    throw new FormulaError('Результат формулы не является конечным числом');
  }
  if (Math.abs(result) > MAX_RESULT) {
    throw new FormulaError(`Результат формулы превышает допустимый предел (${MAX_RESULT})`);
  }
  return result;
}

/**
 * Evaluate a formula that must yield a component quantity: a non-negative
 * integer. Fractional results are rounded up — you cannot order 3.2 uprights.
 */
export function evaluateQuantity(formula: string, scope: FormulaScope): number {
  const value = evaluateFormula(formula, scope);
  if (value < 0) return 0;
  return Math.ceil(value - 1e-9);
}

/** Evaluate a guard formula; anything non-zero is truthy. */
export function evaluateCondition(formula: string, scope: FormulaScope): boolean {
  return evaluateFormula(formula, scope) !== 0;
}

export interface FormulaValidation {
  valid: boolean;
  error?: string;
  variables: string[];
  unknownVariables: string[];
  sample?: number;
}

/**
 * Validate a formula before it is stored by an administrator: checks syntax,
 * rejects variables outside the allowed list and runs it against a sample
 * scope so obvious runtime failures surface in the admin UI.
 */
export function validateFormula(
  formula: string,
  allowed: readonly string[] = ALLOWED_VARIABLES,
  sampleScope?: FormulaScope,
): FormulaValidation {
  try {
    const ast = parseFormula(formula);
    const variables = [...collectVariables(ast)];
    const unknownVariables = variables.filter((name) => !allowed.includes(name));

    if (unknownVariables.length > 0) {
      return {
        valid: false,
        error: `Недопустимые переменные: ${unknownVariables.join(', ')}`,
        variables,
        unknownVariables,
      };
    }

    const scope: FormulaScope =
      sampleScope ??
      Object.fromEntries(allowed.map((name) => [name, DEFAULT_SAMPLE_SCOPE[name] ?? 1]));

    const sample = evaluateAst(ast, scope);
    return { valid: true, variables, unknownVariables: [], sample };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Ошибка разбора формулы',
      variables: [],
      unknownVariables: [],
    };
  }
}

/** Representative values used by the admin formula tester. */
export const DEFAULT_SAMPLE_SCOPE: FormulaScope = {
  sections: 3,
  shelves: 5,
  width: 1000,
  depth: 400,
  height: 2000,
  quantity: 1,
  loadCapacity: 150,
  rearSolid: 0,
  rearPerforated: 0,
  rearBrace: 1,
  sideCount: 0,
  sidePerforated: 0,
  sharedUprights: 1,
  isRow: 1,
  shelfReinforced: 0,
};

export { FormulaError, parseFormula, collectVariables };
