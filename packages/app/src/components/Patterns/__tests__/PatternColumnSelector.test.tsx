import { buildPatternColumnExpression } from '../PatternColumnSelector';

describe('buildPatternColumnExpression', () => {
  const fallback = 'Body';

  it('returns the fallback when no expression is provided', () => {
    expect(
      buildPatternColumnExpression({ patternColumn: null, fallback }),
    ).toBe(fallback);
    expect(
      buildPatternColumnExpression({ patternColumn: undefined, fallback }),
    ).toBe(fallback);
    expect(buildPatternColumnExpression({ patternColumn: '', fallback })).toBe(
      fallback,
    );
  });

  it('wraps a plain column reference in toString()', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: 'ResourceAttributes',
        fallback,
      }),
    ).toBe('toString(ResourceAttributes)');
  });

  it('wraps an arbitrary SQL expression in toString()', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: "concatWithSeparator(' ', Body, LogAttributes)",
        fallback,
      }),
    ).toBe("toString(concatWithSeparator(' ', Body, LogAttributes))");

    expect(
      buildPatternColumnExpression({
        patternColumn: "JSONExtractString(Body, 'message')",
        fallback,
      }),
    ).toBe("toString(JSONExtractString(Body, 'message'))");
  });
});
