import type { Filter } from '@hyperdx/common-utils/dist/types';

import {
  andSqlWhere,
  buildPatternColumnExpression,
  drainTemplateToLikePattern,
  nextSearchForPatternMatch,
  patternMatchSqlCondition,
} from '@/components/Patterns/patternColumn';

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

describe('drainTemplateToLikePattern', () => {
  it('replaces each Drain placeholder with %', () => {
    expect(drainTemplateToLikePattern('POST /users/<*> failed')).toBe(
      'POST /users/% failed',
    );
  });

  it('escapes LIKE wildcards in the literal parts', () => {
    expect(drainTemplateToLikePattern('100% done id=_<*>')).toBe(
      '100\\% done id=\\_%',
    );
  });

  it('leaves a template with no placeholders as an exact pattern', () => {
    expect(drainTemplateToLikePattern('connection refused')).toBe(
      'connection refused',
    );
  });
});

describe('patternMatchSqlCondition', () => {
  it('builds a LIKE predicate against the clustered expression', () => {
    expect(patternMatchSqlCondition('Body', 'POST /users/<*> failed')).toBe(
      "Body LIKE 'POST /users/% failed'",
    );
  });

  it('SQL-escapes quotes in the template', () => {
    expect(patternMatchSqlCondition('Body', "can't <*>")).toBe(
      "Body LIKE 'can''t %'",
    );
  });

  it('skips an empty template or expression', () => {
    expect(patternMatchSqlCondition('Body', '')).toBeNull();
    expect(patternMatchSqlCondition('', 'foo <*>')).toBeNull();
  });

  it('skips a template that is only wildcards', () => {
    expect(patternMatchSqlCondition('Body', '<*>')).toBeNull();
    expect(patternMatchSqlCondition('Body', '<*><*>')).toBeNull();
  });
});

describe('andSqlWhere', () => {
  it('returns the extra clause when nothing was typed', () => {
    expect(andSqlWhere('', "Body LIKE 'a%'")).toBe("Body LIKE 'a%'");
  });

  it('ANDs onto an existing WHERE', () => {
    expect(andSqlWhere("ServiceName = 'api'", "Body LIKE 'a%'")).toBe(
      "(ServiceName = 'api') AND (Body LIKE 'a%')",
    );
  });
});

describe('nextSearchForPatternMatch', () => {
  const sqlCondition = "Body LIKE 'POST /users/% failed'";
  const filters: Filter[] = [
    { type: 'sql', condition: "ServiceName IN ('api')" },
  ];

  it('folds the LIKE into a SQL WHERE', () => {
    expect(
      nextSearchForPatternMatch({
        where: "SeverityText = 'error'",
        whereLanguage: 'sql',
        filters,
        sqlCondition,
      }),
    ).toEqual({
      where: "(SeverityText = 'error') AND (Body LIKE 'POST /users/% failed')",
      filters,
    });
  });

  it('keeps Lucene WHERE and appends a SQL filter instead', () => {
    expect(
      nextSearchForPatternMatch({
        where: 'level:error',
        whereLanguage: 'lucene',
        filters,
        sqlCondition,
      }),
    ).toEqual({
      where: 'level:error',
      filters: [...filters, { type: 'sql', condition: sqlCondition }],
    });
  });
});
