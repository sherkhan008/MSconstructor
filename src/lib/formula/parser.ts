import { FormulaError, tokenize, type Token } from './tokenizer';

/**
 * Recursive-descent parser producing an immutable AST.
 *
 * Grammar (lowest precedence first):
 *
 *   expression  := ternary
 *   ternary     := logicalOr ( '?' expression ':' expression )?
 *   logicalOr   := logicalAnd ( '||' logicalAnd )*
 *   logicalAnd  := equality ( '&&' equality )*
 *   equality    := comparison ( ('=='|'!=') comparison )*
 *   comparison  := additive ( ('<'|'<='|'>'|'>=') additive )*
 *   additive    := multiplicative ( ('+'|'-') multiplicative )*
 *   multiplicative := unary ( ('*'|'/'|'%') unary )*
 *   unary       := ('-'|'+'|'!') unary | primary
 *   primary     := NUMBER | IDENT | call | '(' expression ')'
 *   call        := IDENT '(' (expression (',' expression)*)? ')'
 */

export type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: '-' | '+' | '!'; operand: AstNode }
  | { kind: 'binary'; operator: BinaryOperator; left: AstNode; right: AstNode }
  | { kind: 'ternary'; condition: AstNode; whenTrue: AstNode; whenFalse: AstNode }
  | { kind: 'call'; name: AllowedFunction; args: AstNode[] };

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||';

/**
 * Whitelisted pure helpers. Anything not in this map is a parse error, so an
 * administrator cannot reach a host global from a formula.
 */
export const ALLOWED_FUNCTIONS = {
  min: (...args: number[]) => Math.min(...args),
  max: (...args: number[]) => Math.max(...args),
  ceil: (value: number) => Math.ceil(value),
  floor: (value: number) => Math.floor(value),
  round: (value: number) => Math.round(value),
  abs: (value: number) => Math.abs(value),
} as const;

export type AllowedFunction = keyof typeof ALLOWED_FUNCTIONS;

const FUNCTION_ARITY: Record<AllowedFunction, { min: number; max: number }> = {
  min: { min: 1, max: 8 },
  max: { min: 1, max: 8 },
  ceil: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
};

function isAllowedFunction(name: string): name is AllowedFunction {
  return Object.prototype.hasOwnProperty.call(ALLOWED_FUNCTIONS, name);
}

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): AstNode {
    const node = this.expression();
    const token = this.peek();
    if (token.type !== 'EOF') {
      throw new FormulaError(`Неожиданный символ «${token.value}»`, token.position);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (token.type !== 'EOF') this.index += 1;
    return token;
  }

  private matchOperator(...values: string[]): Token | null {
    const token = this.peek();
    if (token.type === 'OPERATOR' && values.includes(token.value)) {
      this.index += 1;
      return token;
    }
    return null;
  }

  private expect(type: Token['type'], description: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new FormulaError(`Ожидается ${description}`, token.position);
    }
    return this.next();
  }

  private expression(): AstNode {
    return this.ternary();
  }

  private ternary(): AstNode {
    const condition = this.logicalOr();
    if (this.peek().type === 'QUESTION') {
      this.next();
      const whenTrue = this.expression();
      this.expect('COLON', '«:»');
      const whenFalse = this.expression();
      return { kind: 'ternary', condition, whenTrue, whenFalse };
    }
    return condition;
  }

  private logicalOr(): AstNode {
    let left = this.logicalAnd();
    for (;;) {
      const op = this.matchOperator('||');
      if (!op) return left;
      left = { kind: 'binary', operator: '||', left, right: this.logicalAnd() };
    }
  }

  private logicalAnd(): AstNode {
    let left = this.equality();
    for (;;) {
      const op = this.matchOperator('&&');
      if (!op) return left;
      left = { kind: 'binary', operator: '&&', left, right: this.equality() };
    }
  }

  private equality(): AstNode {
    let left = this.comparison();
    for (;;) {
      const op = this.matchOperator('==', '!=');
      if (!op) return left;
      left = {
        kind: 'binary',
        operator: op.value as BinaryOperator,
        left,
        right: this.comparison(),
      };
    }
  }

  private comparison(): AstNode {
    let left = this.additive();
    for (;;) {
      const op = this.matchOperator('<', '<=', '>', '>=');
      if (!op) return left;
      left = {
        kind: 'binary',
        operator: op.value as BinaryOperator,
        left,
        right: this.additive(),
      };
    }
  }

  private additive(): AstNode {
    let left = this.multiplicative();
    for (;;) {
      const op = this.matchOperator('+', '-');
      if (!op) return left;
      left = {
        kind: 'binary',
        operator: op.value as BinaryOperator,
        left,
        right: this.multiplicative(),
      };
    }
  }

  private multiplicative(): AstNode {
    let left = this.unary();
    for (;;) {
      const op = this.matchOperator('*', '/', '%');
      if (!op) return left;
      left = {
        kind: 'binary',
        operator: op.value as BinaryOperator,
        left,
        right: this.unary(),
      };
    }
  }

  private unary(): AstNode {
    const op = this.matchOperator('-', '+', '!');
    if (op) {
      return { kind: 'unary', operator: op.value as '-' | '+' | '!', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): AstNode {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.next();
      const value = Number(token.value);
      if (!Number.isFinite(value)) {
        throw new FormulaError(`Некорректное число «${token.value}»`, token.position);
      }
      return { kind: 'number', value };
    }

    if (token.type === 'IDENT') {
      this.next();
      if (this.peek().type === 'LPAREN') {
        if (!isAllowedFunction(token.value)) {
          throw new FormulaError(`Функция «${token.value}» недоступна`, token.position);
        }
        this.next(); // consume '('
        const args: AstNode[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.expression());
          while (this.peek().type === 'COMMA') {
            this.next();
            args.push(this.expression());
          }
        }
        this.expect('RPAREN', '«)»');
        const arity = FUNCTION_ARITY[token.value];
        if (args.length < arity.min || args.length > arity.max) {
          throw new FormulaError(
            `Функция «${token.value}» принимает от ${arity.min} до ${arity.max} аргументов`,
            token.position,
          );
        }
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'variable', name: token.value };
    }

    if (token.type === 'LPAREN') {
      this.next();
      const node = this.expression();
      this.expect('RPAREN', '«)»');
      return node;
    }

    throw new FormulaError(
      token.type === 'EOF' ? 'Формула не завершена' : `Неожиданный символ «${token.value}»`,
      token.position,
    );
  }
}

/** Parse a formula string into an AST. Throws FormulaError on invalid input. */
export function parseFormula(formula: string): AstNode {
  return new Parser(tokenize(formula)).parse();
}

/** Collect every variable name referenced by an AST. */
export function collectVariables(node: AstNode, into: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case 'number':
      break;
    case 'variable':
      into.add(node.name);
      break;
    case 'unary':
      collectVariables(node.operand, into);
      break;
    case 'binary':
      collectVariables(node.left, into);
      collectVariables(node.right, into);
      break;
    case 'ternary':
      collectVariables(node.condition, into);
      collectVariables(node.whenTrue, into);
      collectVariables(node.whenFalse, into);
      break;
    case 'call':
      node.args.forEach((arg) => collectVariables(arg, into));
      break;
  }
  return into;
}

export { FormulaError };
