/**
 * Parser / validator for metric formula expressions (HDX-5078).
 *
 * A formula is a letter-ref arithmetic expression over the chart's `select`
 * series: `A` references `select[0]`, `B` references `select[1]`, and so on
 * (Grafana/Datadog convention; stable against alias edits). Example:
 *
 *   A / (A + B + C) * 100
 *
 * Grammar (v1 — arithmetic only, no scalar functions, never raw SQL):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-' factor | primary
 *   primary    := number | seriesRef | '(' expression ')'
 *   seriesRef  := 'A'..'Z'          (single uppercase letter)
 *   number     := digits ('.' digits)? | '.' digits
 *
 * The expression parses to a validated AST which the query renderer
 * (HDX-5079) compiles into a SQL projection over pivoted per-series columns.
 * Validation failures are returned as structured results so the chart editor
 * (HDX-5080) can surface inline errors.
 */

// ─── AST ─────────────────────────────────────────────────────────────────────

export type FormulaBinaryOp = '+' | '-' | '*' | '/';

export type FormulaAst =
  | {
      type: 'binary';
      op: FormulaBinaryOp;
      left: FormulaAst;
      right: FormulaAst;
    }
  | { type: 'unary'; op: '-'; operand: FormulaAst }
  | { type: 'number'; value: number }
  // `ref` is the letter as written (e.g. 'B'); `index` is its zero-based
  // position in the chart's `select` list (e.g. 1).
  | { type: 'seriesRef'; ref: string; index: number };

// ─── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Maximum accepted expression length, in characters. Generous for a
 * human-typed formula while keeping parser recursion (one level per nesting
 * depth, and depth <= length) far below any engine's stack limit, so
 * validation always returns structured results instead of overflowing.
 * Mirrored by `MetricFormulaSchema.expression`'s max length in `types.ts`.
 */
export const MAX_FORMULA_EXPRESSION_LENGTH = 1024;

/**
 * Maximum nesting depth (parentheses + unary minus chains). Deterministic
 * recursion bound regardless of engine stack size; far beyond any real
 * formula.
 */
export const MAX_FORMULA_DEPTH = 64;

// ─── Structured validation errors ────────────────────────────────────────────

/**
 * One structured validation failure. `position` is the zero-based character
 * offset into the original expression (for inline error markers in the
 * editor); errors that apply to the expression as a whole omit it.
 */
export type FormulaValidationError =
  | { code: 'empty-expression'; message: string }
  | {
      code: 'expression-too-long';
      message: string;
      maxLength: number;
    }
  | { code: 'invalid-token'; message: string; position: number; token: string }
  | { code: 'syntax-error'; message: string; position: number }
  | {
      code: 'unknown-series-ref';
      message: string;
      position: number;
      ref: string;
    }
  | { code: 'constant-only-expression'; message: string };

export type FormulaParseResult =
  | {
      ok: true;
      ast: FormulaAst;
      /** Distinct zero-based `select` indices referenced, ascending. */
      referencedIndices: number[];
    }
  | { ok: false; errors: FormulaValidationError[] };

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
  | { type: 'number'; value: number; position: number; text: string }
  | { type: 'seriesRef'; ref: string; position: number }
  | { type: 'operator'; op: FormulaBinaryOp; position: number }
  | { type: 'lparen'; position: number }
  | { type: 'rparen'; position: number };

const isBinaryOp = (ch: string): ch is FormulaBinaryOp =>
  ch === '+' || ch === '-' || ch === '*' || ch === '/';

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const isUppercaseLetter = (ch: string) => ch >= 'A' && ch <= 'Z';
const isLowercaseLetter = (ch: string) => ch >= 'a' && ch <= 'z';
const isAnyLetter = (ch: string) =>
  isUppercaseLetter(ch) || isLowercaseLetter(ch);
const isWhitespace = (ch: string) => /\s/.test(ch);

/** Zero-based `select` index a series ref letter maps to ('A' -> 0). */
export const seriesRefToIndex = (ref: string): number =>
  ref.charCodeAt(0) - 'A'.charCodeAt(0);

/** Series ref letter for a zero-based `select` index (0 -> 'A'), or undefined past 'Z'. */
export const indexToSeriesRef = (index: number): string | undefined =>
  index >= 0 && index < 26
    ? String.fromCharCode('A'.charCodeAt(0) + index)
    : undefined;

const tokenize = (
  expression: string,
): { tokens: Token[] } | { error: FormulaValidationError } => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression.charAt(i);
    if (isWhitespace(ch)) {
      i++;
    } else if (isBinaryOp(ch)) {
      tokens.push({ type: 'operator', op: ch, position: i });
      i++;
    } else if (ch === '(') {
      tokens.push({ type: 'lparen', position: i });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', position: i });
      i++;
    } else if (
      isDigit(ch) ||
      (ch === '.' && isDigit(expression.charAt(i + 1)))
    ) {
      const start = i;
      while (i < expression.length && isDigit(expression.charAt(i))) i++;
      if (expression.charAt(i) === '.') {
        i++;
        while (i < expression.length && isDigit(expression.charAt(i))) i++;
      }
      const text = expression.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return {
          error: {
            code: 'invalid-token',
            message: `Invalid number "${text}"`,
            position: start,
            token: text,
          },
        };
      }
      tokens.push({ type: 'number', value, position: start, text });
    } else if (isUppercaseLetter(ch)) {
      // Series refs are single letters; a run of letters (e.g. `AB`, `ABS`)
      // is not a valid ref and functions are not supported in v1.
      const start = i;
      while (i < expression.length && isAnyLetter(expression.charAt(i))) {
        i++;
      }
      const text = expression.slice(start, i);
      if (text.length > 1) {
        return {
          error: {
            code: 'invalid-token',
            message: `Unexpected "${text}" — series references are single letters (A, B, C, ...) and functions are not supported`,
            position: start,
            token: text,
          },
        };
      }
      tokens.push({ type: 'seriesRef', ref: text, position: start });
    } else if (isLowercaseLetter(ch)) {
      const start = i;
      while (i < expression.length && isAnyLetter(expression.charAt(i))) {
        i++;
      }
      const text = expression.slice(start, i);
      return {
        error: {
          code: 'invalid-token',
          message: `Unexpected "${text}" — series references are uppercase letters (A, B, C, ...)`,
          position: start,
          token: text,
        },
      };
    } else {
      return {
        error: {
          code: 'invalid-token',
          message: `Unexpected character "${ch}"`,
          position: i,
          token: ch,
        },
      };
    }
  }
  return { tokens };
};

// ─── Parser (recursive descent) ──────────────────────────────────────────────

class SyntaxError_ extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

class Parser {
  private pos = 0;
  // Current nesting depth (parentheses + unary minus chains). Binary
  // operator chains are parsed iteratively so they don't contribute. Keeps
  // recursion bounded deterministically (see MAX_FORMULA_DEPTH); the length
  // pre-check in parseFormula already makes overflow unreachable, this makes
  // the limit engine-independent and the error message precise.
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly expressionLength: number,
  ) {}

  private enterNested(position: number): void {
    this.depth++;
    if (this.depth > MAX_FORMULA_DEPTH) {
      throw new SyntaxError_(
        `Expression is nested too deeply (max ${MAX_FORMULA_DEPTH} levels)`,
        position,
      );
    }
  }

  private exitNested(): void {
    this.depth--;
  }

  parse(): FormulaAst {
    const ast = this.parseExpression();
    const trailing = this.peek();
    if (trailing !== undefined) {
      throw new SyntaxError_(
        trailing.type === 'rparen'
          ? 'Unmatched closing parenthesis'
          : `Unexpected ${describeToken(trailing)}`,
        trailing.position,
      );
    }
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  // expression := term (('+' | '-') term)*
  private parseExpression(): FormulaAst {
    let left = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (tok?.type !== 'operator' || (tok.op !== '+' && tok.op !== '-')) break;
      this.pos++;
      left = { type: 'binary', op: tok.op, left, right: this.parseTerm() };
    }
    return left;
  }

  // term := factor (('*' | '/') factor)*
  private parseTerm(): FormulaAst {
    let left = this.parseFactor();
    for (;;) {
      const tok = this.peek();
      if (tok?.type !== 'operator' || (tok.op !== '*' && tok.op !== '/')) break;
      this.pos++;
      left = { type: 'binary', op: tok.op, left, right: this.parseFactor() };
    }
    return left;
  }

  // factor := '-' factor | primary
  private parseFactor(): FormulaAst {
    const tok = this.peek();
    if (tok?.type === 'operator' && tok.op === '-') {
      this.pos++;
      this.enterNested(tok.position);
      const operand = this.parseFactor();
      this.exitNested();
      return { type: 'unary', op: '-', operand };
    }
    return this.parsePrimary();
  }

  // primary := number | seriesRef | '(' expression ')'
  private parsePrimary(): FormulaAst {
    const tok = this.next();
    if (tok === undefined) {
      throw new SyntaxError_(
        'Unexpected end of expression',
        this.expressionLength,
      );
    }
    switch (tok.type) {
      case 'number':
        return { type: 'number', value: tok.value };
      case 'seriesRef':
        return {
          type: 'seriesRef',
          ref: tok.ref,
          index: seriesRefToIndex(tok.ref),
        };
      case 'lparen': {
        this.enterNested(tok.position);
        const inner = this.parseExpression();
        this.exitNested();
        const closing = this.next();
        if (closing?.type !== 'rparen') {
          throw new SyntaxError_(
            'Missing closing parenthesis',
            closing?.position ?? this.expressionLength,
          );
        }
        return inner;
      }
      default:
        throw new SyntaxError_(
          `Unexpected ${describeToken(tok)}`,
          tok.position,
        );
    }
  }
}

const describeToken = (tok: Token): string => {
  switch (tok.type) {
    case 'number':
      return `number "${tok.text}"`;
    case 'seriesRef':
      return `series reference "${tok.ref}"`;
    case 'operator':
      return `operator "${tok.op}"`;
    case 'lparen':
      return 'opening parenthesis';
    case 'rparen':
      return 'closing parenthesis';
  }
};

const collectReferencedIndices = (ast: FormulaAst, out: Set<number>): void => {
  switch (ast.type) {
    case 'binary':
      collectReferencedIndices(ast.left, out);
      collectReferencedIndices(ast.right, out);
      break;
    case 'unary':
      collectReferencedIndices(ast.operand, out);
      break;
    case 'seriesRef':
      out.add(ast.index);
      break;
    case 'number':
      break;
  }
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a formula expression into a validated AST.
 *
 * Purely syntactic — does not know how many series the chart has; use
 * `validateFormula` for the full check (range validation of series refs).
 */
export const parseFormula = (expression: string): FormulaParseResult => {
  if (expression.trim() === '') {
    return {
      ok: false,
      errors: [{ code: 'empty-expression', message: 'Expression is empty' }],
    };
  }
  // Checked before tokenizing so an oversized (possibly hostile) expression
  // can never drive the recursive parser toward a stack overflow — the
  // validation API always returns structured results rather than throwing.
  if (expression.length > MAX_FORMULA_EXPRESSION_LENGTH) {
    return {
      ok: false,
      errors: [
        {
          code: 'expression-too-long',
          message: `Expression is too long (${expression.length} characters, max ${MAX_FORMULA_EXPRESSION_LENGTH})`,
          maxLength: MAX_FORMULA_EXPRESSION_LENGTH,
        },
      ],
    };
  }
  const tokenized = tokenize(expression);
  if ('error' in tokenized) {
    return { ok: false, errors: [tokenized.error] };
  }
  try {
    const ast = new Parser(tokenized.tokens, expression.length).parse();
    const indices = new Set<number>();
    collectReferencedIndices(ast, indices);
    return {
      ok: true,
      ast,
      referencedIndices: [...indices].sort((a, b) => a - b),
    };
  } catch (e) {
    if (e instanceof SyntaxError_) {
      return {
        ok: false,
        errors: [
          { code: 'syntax-error', message: e.message, position: e.position },
        ],
      };
    }
    throw e;
  }
};

/**
 * Parse and fully validate a formula expression against a chart's series.
 *
 * On top of `parseFormula`, checks that:
 *  - every series ref resolves to an existing `select` entry
 *    (`seriesCount` is the length of the chart's `select` list), and
 *  - the expression references at least one series (a constant-only formula
 *    like `1 + 2` is almost certainly a mistake).
 *
 * All failures for a parseable expression are reported together so the
 * editor can surface every invalid ref at once.
 */
export const validateFormula = (
  expression: string,
  { seriesCount }: { seriesCount: number },
): FormulaParseResult => {
  const parsed = parseFormula(expression);
  if (!parsed.ok) {
    return parsed;
  }

  const errors: FormulaValidationError[] = [];

  const checkRefs = (ast: FormulaAst): void => {
    switch (ast.type) {
      case 'binary':
        checkRefs(ast.left);
        checkRefs(ast.right);
        break;
      case 'unary':
        checkRefs(ast.operand);
        break;
      case 'seriesRef':
        if (ast.index >= seriesCount) {
          errors.push({
            code: 'unknown-series-ref',
            message:
              seriesCount > 0
                ? `Unknown series "${ast.ref}" — this chart only has series A through ${indexToSeriesRef(seriesCount - 1)}`
                : `Unknown series "${ast.ref}" — this chart has no series`,
            position: findRefPosition(expression, ast.ref),
            ref: ast.ref,
          });
        }
        break;
      case 'number':
        break;
    }
  };
  checkRefs(parsed.ast);

  // Dedupe repeated refs to the same unknown letter (e.g. `Z + Z`).
  const seenRefs = new Set<string>();
  const dedupedErrors = errors.filter(err => {
    if (err.code !== 'unknown-series-ref') return true;
    if (seenRefs.has(err.ref)) return false;
    seenRefs.add(err.ref);
    return true;
  });

  if (parsed.referencedIndices.length === 0) {
    dedupedErrors.push({
      code: 'constant-only-expression',
      message: 'Expression must reference at least one series (A, B, C, ...)',
    });
  }

  return dedupedErrors.length > 0
    ? { ok: false, errors: dedupedErrors }
    : parsed;
};

/** First character offset of a series-ref letter in the expression. */
const findRefPosition = (expression: string, ref: string): number => {
  const position = expression.indexOf(ref);
  return position >= 0 ? position : 0;
};
