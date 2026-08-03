/**
 * Tokenizer for the BOM formula language.
 *
 * The formula language is deliberately tiny. It exists so that component
 * quantity rules ("sections * 4", "sections > 1 ? sections * 2 + 2 : 4") live
 * in the database and can be edited by an administrator without a deploy.
 *
 * SECURITY: this is a hand-written lexer + recursive descent parser.
 * `eval`, `new Function` and any other dynamic code execution are never used.
 */

export type TokenType =
  | 'NUMBER'
  | 'IDENT'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'QUESTION'
  | 'COLON'
  | 'COMMA'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export class FormulaError extends Error {
  readonly position: number;

  constructor(message: string, position = -1) {
    super(position >= 0 ? `${message} (позиция ${position})` : message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

/** Multi-character operators must be tested before single-character ones. */
const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!'];

const MAX_FORMULA_LENGTH = 500;

export function tokenize(input: string): Token[] {
  if (typeof input !== 'string') {
    throw new FormulaError('Формула должна быть строкой');
  }
  if (input.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`Формула слишком длинная (максимум ${MAX_FORMULA_LENGTH} символов)`);
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1;
      continue;
    }

    if (char >= '0' && char <= '9') {
      let j = i;
      let seenDot = false;
      while (j < input.length) {
        const c = input[j];
        if (c >= '0' && c <= '9') {
          j += 1;
        } else if (c === '.' && !seenDot) {
          seenDot = true;
          j += 1;
        } else {
          break;
        }
      }
      const raw = input.slice(i, j);
      if (raw.endsWith('.')) {
        throw new FormulaError(`Некорректное число «${raw}»`, i);
      }
      tokens.push({ type: 'NUMBER', value: raw, position: i });
      i = j;
      continue;
    }

    // A leading dot number such as ".5" is rejected on purpose — rules must be explicit.
    if (isIdentStart(char)) {
      let j = i;
      while (j < input.length && isIdentPart(input[j])) j += 1;
      tokens.push({ type: 'IDENT', value: input.slice(i, j), position: i });
      i = j;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: char, position: i });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: char, position: i });
      i += 1;
      continue;
    }
    if (char === '?') {
      tokens.push({ type: 'QUESTION', value: char, position: i });
      i += 1;
      continue;
    }
    if (char === ':') {
      tokens.push({ type: 'COLON', value: char, position: i });
      i += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'COMMA', value: char, position: i });
      i += 1;
      continue;
    }

    const operator = OPERATORS.find((op) => input.startsWith(op, i));
    if (operator) {
      // A lone "=" is a common authoring mistake; report it precisely.
      if (operator === '!' && input[i + 1] !== '=' ) {
        tokens.push({ type: 'OPERATOR', value: '!', position: i });
        i += 1;
        continue;
      }
      tokens.push({ type: 'OPERATOR', value: operator, position: i });
      i += operator.length;
      continue;
    }

    if (char === '=') {
      throw new FormulaError('Используйте «==» для сравнения', i);
    }

    throw new FormulaError(`Недопустимый символ «${char}»`, i);
  }

  tokens.push({ type: 'EOF', value: '', position: input.length });
  return tokens;
}

function isIdentStart(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || (char >= '0' && char <= '9');
}
