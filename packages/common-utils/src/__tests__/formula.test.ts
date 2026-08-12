import {
  FormulaAst,
  indexToSeriesRef,
  parseFormula,
  seriesRefToIndex,
  validateFormula,
} from '@/core/formula';

const expectOk = (
  result: ReturnType<typeof parseFormula>,
): Extract<ReturnType<typeof parseFormula>, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok result');
  return result;
};

const expectErrors = (
  result: ReturnType<typeof parseFormula>,
): Extract<ReturnType<typeof parseFormula>, { ok: false }> => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected error result');
  return result;
};

describe('seriesRefToIndex / indexToSeriesRef', () => {
  it('maps letters to zero-based select indices and back', () => {
    expect(seriesRefToIndex('A')).toBe(0);
    expect(seriesRefToIndex('B')).toBe(1);
    expect(seriesRefToIndex('Z')).toBe(25);
    expect(indexToSeriesRef(0)).toBe('A');
    expect(indexToSeriesRef(25)).toBe('Z');
  });

  it('returns undefined for indices without a single-letter ref', () => {
    expect(indexToSeriesRef(26)).toBeUndefined();
    expect(indexToSeriesRef(-1)).toBeUndefined();
  });
});

describe('parseFormula', () => {
  // ─── Success cases ─────────────────────────────────────────────────────────

  it('parses a single series ref', () => {
    const { ast, referencedIndices } = expectOk(parseFormula('A'));
    expect(ast).toEqual({ type: 'seriesRef', ref: 'A', index: 0 });
    expect(referencedIndices).toEqual([0]);
  });

  it('parses the motivating HDX-4938 example: A / (A + B + C) * 100', () => {
    const { ast, referencedIndices } = expectOk(
      parseFormula('A / (A + B + C) * 100'),
    );
    const a: FormulaAst = { type: 'seriesRef', ref: 'A', index: 0 };
    const b: FormulaAst = { type: 'seriesRef', ref: 'B', index: 1 };
    const c: FormulaAst = { type: 'seriesRef', ref: 'C', index: 2 };
    expect(ast).toEqual({
      type: 'binary',
      op: '*',
      left: {
        type: 'binary',
        op: '/',
        left: a,
        right: {
          type: 'binary',
          op: '+',
          left: { type: 'binary', op: '+', left: a, right: b },
          right: c,
        },
      },
      right: { type: 'number', value: 100 },
    });
    expect(referencedIndices).toEqual([0, 1, 2]);
  });

  it('applies multiplication/division precedence over addition/subtraction', () => {
    const { ast } = expectOk(parseFormula('A + B * C'));
    expect(ast).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'seriesRef', ref: 'A', index: 0 },
      right: {
        type: 'binary',
        op: '*',
        left: { type: 'seriesRef', ref: 'B', index: 1 },
        right: { type: 'seriesRef', ref: 'C', index: 2 },
      },
    });
  });

  it('is left-associative for same-precedence operators', () => {
    const { ast } = expectOk(parseFormula('A - B - C'));
    expect(ast).toEqual({
      type: 'binary',
      op: '-',
      left: {
        type: 'binary',
        op: '-',
        left: { type: 'seriesRef', ref: 'A', index: 0 },
        right: { type: 'seriesRef', ref: 'B', index: 1 },
      },
      right: { type: 'seriesRef', ref: 'C', index: 2 },
    });
  });

  it('parentheses override precedence', () => {
    const { ast } = expectOk(parseFormula('(A + B) * C'));
    expect(ast).toEqual({
      type: 'binary',
      op: '*',
      left: {
        type: 'binary',
        op: '+',
        left: { type: 'seriesRef', ref: 'A', index: 0 },
        right: { type: 'seriesRef', ref: 'B', index: 1 },
      },
      right: { type: 'seriesRef', ref: 'C', index: 2 },
    });
  });

  it('parses numeric constants (integer, decimal, leading-dot)', () => {
    expect(expectOk(parseFormula('A * 2')).ast).toEqual({
      type: 'binary',
      op: '*',
      left: { type: 'seriesRef', ref: 'A', index: 0 },
      right: { type: 'number', value: 2 },
    });
    expect(expectOk(parseFormula('A * 0.5')).ast).toMatchObject({
      right: { type: 'number', value: 0.5 },
    });
    expect(expectOk(parseFormula('A * .25')).ast).toMatchObject({
      right: { type: 'number', value: 0.25 },
    });
  });

  it('parses unary minus', () => {
    expect(expectOk(parseFormula('-A + B')).ast).toEqual({
      type: 'binary',
      op: '+',
      left: {
        type: 'unary',
        op: '-',
        operand: { type: 'seriesRef', ref: 'A', index: 0 },
      },
      right: { type: 'seriesRef', ref: 'B', index: 1 },
    });
    // Double negation and negation of a parenthesized expression.
    expect(expectOk(parseFormula('--A')).ast).toEqual({
      type: 'unary',
      op: '-',
      operand: {
        type: 'unary',
        op: '-',
        operand: { type: 'seriesRef', ref: 'A', index: 0 },
      },
    });
    expect(expectOk(parseFormula('-(A + B)')).ast).toMatchObject({
      type: 'unary',
      op: '-',
    });
    // Unary minus binds tighter than binary operators to its right.
    expect(expectOk(parseFormula('A * -B')).ast).toEqual({
      type: 'binary',
      op: '*',
      left: { type: 'seriesRef', ref: 'A', index: 0 },
      right: {
        type: 'unary',
        op: '-',
        operand: { type: 'seriesRef', ref: 'B', index: 1 },
      },
    });
  });

  it('tolerates arbitrary whitespace', () => {
    const compact = expectOk(parseFormula('A/(A+B)*100'));
    const spaced = expectOk(parseFormula('  A /\t( A +  B ) * 100  '));
    expect(spaced.ast).toEqual(compact.ast);
  });

  it('deduplicates and sorts referencedIndices', () => {
    const { referencedIndices } = expectOk(parseFormula('C + A + C + A'));
    expect(referencedIndices).toEqual([0, 2]);
  });

  it('parses a constant-only expression (range checks are validateFormula concerns)', () => {
    const { ast, referencedIndices } = expectOk(parseFormula('1 + 2'));
    expect(ast).toMatchObject({ type: 'binary', op: '+' });
    expect(referencedIndices).toEqual([]);
  });

  it('parses division by a zero constant (divide-by-zero is a render-time concern)', () => {
    expectOk(parseFormula('A / 0'));
  });

  // ─── Error cases ───────────────────────────────────────────────────────────

  it('rejects an empty expression', () => {
    for (const expression of ['', '   ', '\t\n']) {
      const { errors } = expectErrors(parseFormula(expression));
      expect(errors).toEqual([
        { code: 'empty-expression', message: expect.any(String) },
      ]);
    }
  });

  it('rejects a trailing operator', () => {
    const { errors } = expectErrors(parseFormula('A +'));
    expect(errors).toEqual([
      {
        code: 'syntax-error',
        message: expect.stringContaining('end of expression'),
        position: 3,
      },
    ]);
  });

  it('rejects a leading binary operator', () => {
    const { errors } = expectErrors(parseFormula('* A'));
    expect(errors).toMatchObject([{ code: 'syntax-error', position: 0 }]);
  });

  it('rejects adjacent operands with no operator', () => {
    const { errors } = expectErrors(parseFormula('A B'));
    expect(errors).toEqual([
      {
        code: 'syntax-error',
        message: expect.stringContaining('series reference "B"'),
        position: 2,
      },
    ]);
  });

  it('rejects adjacent ref and number (e.g. A1)', () => {
    const { errors } = expectErrors(parseFormula('A1'));
    expect(errors).toMatchObject([{ code: 'syntax-error', position: 1 }]);
  });

  it('rejects doubled binary operators', () => {
    const { errors } = expectErrors(parseFormula('A + * B'));
    expect(errors).toMatchObject([{ code: 'syntax-error', position: 4 }]);
  });

  it('rejects unbalanced parentheses', () => {
    expect(expectErrors(parseFormula('(A + B')).errors).toEqual([
      {
        code: 'syntax-error',
        message: expect.stringContaining('closing parenthesis'),
        position: 6,
      },
    ]);
    expect(expectErrors(parseFormula('A + B)')).errors).toEqual([
      {
        code: 'syntax-error',
        message: expect.stringContaining('closing parenthesis'),
        position: 5,
      },
    ]);
    expect(expectErrors(parseFormula('()')).errors).toMatchObject([
      { code: 'syntax-error', position: 1 },
    ]);
  });

  it('rejects lowercase series refs with a helpful message', () => {
    const { errors } = expectErrors(parseFormula('a + b'));
    expect(errors).toEqual([
      {
        code: 'invalid-token',
        message: expect.stringContaining('uppercase'),
        position: 0,
        token: 'a',
      },
    ]);
  });

  it('rejects multi-letter identifiers (no functions in v1)', () => {
    const { errors } = expectErrors(parseFormula('ABS(A)'));
    expect(errors).toEqual([
      {
        code: 'invalid-token',
        message: expect.stringContaining('functions are not supported'),
        position: 0,
        token: 'ABS',
      },
    ]);
    expect(expectErrors(parseFormula('A + Foo')).errors).toMatchObject([
      { code: 'invalid-token', position: 4, token: 'Foo' },
    ]);
  });

  it('rejects unexpected characters with their position', () => {
    expect(expectErrors(parseFormula('$A + B')).errors).toEqual([
      {
        code: 'invalid-token',
        message: expect.any(String),
        position: 0,
        token: '$',
      },
    ]);
    expect(expectErrors(parseFormula('A % B')).errors).toMatchObject([
      { code: 'invalid-token', position: 2, token: '%' },
    ]);
    expect(expectErrors(parseFormula('A + "B"')).errors).toMatchObject([
      { code: 'invalid-token', position: 4, token: '"' },
    ]);
  });

  it('rejects a bare dot', () => {
    const { errors } = expectErrors(parseFormula('A + .'));
    expect(errors).toMatchObject([
      { code: 'invalid-token', position: 4, token: '.' },
    ]);
  });
});

describe('validateFormula', () => {
  it('accepts refs within the series count', () => {
    const result = expectOk(
      validateFormula('A / (A + B + C) * 100', { seriesCount: 3 }),
    );
    expect(result.referencedIndices).toEqual([0, 1, 2]);
  });

  it('rejects refs beyond the series count', () => {
    const { errors } = expectErrors(
      validateFormula('A + C', { seriesCount: 2 }),
    );
    expect(errors).toEqual([
      {
        code: 'unknown-series-ref',
        message: expect.stringContaining('A through B'),
        position: 4,
        ref: 'C',
      },
    ]);
  });

  it('reports each unknown ref once, even when repeated', () => {
    const { errors } = expectErrors(
      validateFormula('C + D + C', { seriesCount: 2 }),
    );
    expect(errors).toMatchObject([
      { code: 'unknown-series-ref', ref: 'C' },
      { code: 'unknown-series-ref', ref: 'D' },
    ]);
  });

  it('handles a chart with no series', () => {
    const { errors } = expectErrors(validateFormula('A', { seriesCount: 0 }));
    expect(errors).toEqual([
      {
        code: 'unknown-series-ref',
        message: expect.stringContaining('no series'),
        position: 0,
        ref: 'A',
      },
    ]);
  });

  it('accepts the boundary ref exactly at seriesCount - 1', () => {
    expectOk(validateFormula('Z', { seriesCount: 26 }));
    expectErrors(validateFormula('Z', { seriesCount: 25 }));
  });

  it('rejects constant-only expressions', () => {
    const { errors } = expectErrors(
      validateFormula('1 + 2', { seriesCount: 3 }),
    );
    expect(errors).toEqual([
      { code: 'constant-only-expression', message: expect.any(String) },
    ]);
  });

  it('propagates parse errors unchanged', () => {
    const { errors } = expectErrors(validateFormula('A +', { seriesCount: 3 }));
    expect(errors).toMatchObject([{ code: 'syntax-error' }]);
  });

  it('propagates empty-expression errors unchanged', () => {
    const { errors } = expectErrors(validateFormula('', { seriesCount: 3 }));
    expect(errors).toMatchObject([{ code: 'empty-expression' }]);
  });
});
