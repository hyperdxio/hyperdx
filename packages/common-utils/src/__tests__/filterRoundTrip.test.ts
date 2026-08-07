import {
  type FilterState,
  filterStateToWhereClause,
  getUnrepresentableWhereReason,
  getWhereParseError,
  mergeFilterStateIntoWhereClause,
  parseWhereClauseToFilterState,
  replaceFilterClauses,
} from '@/filters';
import { parse } from '@/queryParser';

describe('filterStateToWhereClause (lucene)', () => {
  it('emits a single included value', () => {
    const state: FilterState = {
      a: { included: new Set<string>(['b']), excluded: new Set<string>() },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'a:"b"',
    );
  });

  it('emits parenthesized OR group for multiple included values', () => {
    const state: FilterState = {
      c: { included: new Set<string>(['d', 'x']), excluded: new Set<string>() },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      '(c:"d" OR c:"x")',
    );
  });

  it('emits negated terms for excluded values', () => {
    const state: FilterState = {
      a: {
        included: new Set<string>(['b']),
        excluded: new Set<string>(['c']),
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'a:"b" AND -a:"c"',
    );
  });

  it('emits multiple excluded values joined with AND', () => {
    const state: FilterState = {
      a: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>([true, false]),
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      '-a:"true" AND -a:"false"',
    );
  });

  it('emits boolean values as strings', () => {
    const state: FilterState = {
      isRootSpan: {
        included: new Set<string | boolean>([true]),
        excluded: new Set<string | boolean>(),
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'isRootSpan:"true"',
    );
  });

  it('escapes double quotes in values', () => {
    const state: FilterState = {
      message: {
        included: new Set<string | boolean>(['say "hello"']),
        excluded: new Set<string | boolean>(),
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'message:"say \\"hello\\""',
    );
  });

  it('escapes backslashes in values', () => {
    const state: FilterState = {
      FilePath: {
        included: new Set<string | boolean>(['C:\\path\\to\\file']),
        excluded: new Set<string | boolean>(),
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'FilePath:"C:\\\\path\\\\to\\\\file"',
    );
  });

  it('normalizes bracket-notation map keys to dot form', () => {
    const state: FilterState = {
      "LogAttributes['service.name']": {
        included: new Set<string | boolean>(['my-app']),
        excluded: new Set<string | boolean>(),
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'LogAttributes.service.name:"my-app"',
    );
  });

  it('escapes colons in map keys', () => {
    const state: FilterState = {
      "LogAttributes['foo:bar']": {
        included: new Set<string | boolean>(['value1']),
        excluded: new Set<string | boolean>(),
      },
    };
    const emitted = filterStateToWhereClause(state, {
      language: 'lucene',
    });
    expect(emitted).toBe(String.raw`LogAttributes.foo\:bar:"value1"`);
    expect(() => parse(emitted)).not.toThrow();
  });

  it('emits range filters', () => {
    const state: FilterState = {
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 10, max: 500 },
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'duration:[10 TO 500]',
    );
  });
});

describe('parseWhereClauseToFilterState (lucene)', () => {
  it('parses a single included value', () => {
    expect(parseWhereClauseToFilterState('a:"b"', 'lucene')).toEqual({
      a: { included: new Set(['b']), excluded: new Set() },
    });
  });

  it('parses a negated term as excluded', () => {
    expect(parseWhereClauseToFilterState('-a:"c"', 'lucene')).toEqual({
      a: { included: new Set(), excluded: new Set(['c']) },
    });
  });

  it('parses an OR group into multiple included values', () => {
    expect(parseWhereClauseToFilterState('(c:"d" OR c:"x")', 'lucene')).toEqual(
      {
        c: { included: new Set(['d', 'x']), excluded: new Set() },
      },
    );
  });

  it('parses a range term', () => {
    expect(
      parseWhereClauseToFilterState('duration:[10 TO 500]', 'lucene'),
    ).toEqual({
      duration: {
        included: new Set(),
        excluded: new Set(),
        range: { min: 10, max: 500 },
      },
    });
  });

  it('coerces boolean values', () => {
    expect(
      parseWhereClauseToFilterState('isRootSpan:"true"', 'lucene'),
    ).toEqual({
      isRootSpan: { included: new Set([true]), excluded: new Set() },
    });
  });

  it('ignores free-text phrases (implicit field)', () => {
    expect(parseWhereClauseToFilterState('"error 404"', 'lucene')).toEqual({});
  });

  it('ignores unquoted terms', () => {
    expect(parseWhereClauseToFilterState('error 404', 'lucene')).toEqual({});
  });

  it('decodes escaped colons in field names', () => {
    expect(
      parseWhereClauseToFilterState(
        String.raw`LogAttributes.foo\:bar:"value1"`,
        'lucene',
      ),
    ).toEqual({
      'LogAttributes.foo:bar': {
        included: new Set(['value1']),
        excluded: new Set(),
      },
    });
  });

  it('returns empty state for invalid lucene', () => {
    expect(parseWhereClauseToFilterState('(((', 'lucene')).toEqual({});
  });

  it('returns empty state for empty text', () => {
    expect(parseWhereClauseToFilterState('', 'lucene')).toEqual({});
  });

  it('round-trips emitted state', () => {
    const state: FilterState = {
      service: { included: new Set(['app', 'api']), excluded: new Set() },
      level: { included: new Set(), excluded: new Set(['debug']) },
      duration: {
        included: new Set(),
        excluded: new Set(),
        range: { min: 1, max: 999 },
      },
    };
    const where = filterStateToWhereClause(state, { language: 'lucene' });
    expect(parseWhereClauseToFilterState(where, 'lucene')).toEqual(state);
  });
});

describe('replaceFilterClauses (lucene)', () => {
  it('replaces one managed clause and re-emits the rest from the full state', () => {
    const result = replaceFilterClauses(
      'foo:"x" AND host:"a" AND bar:"y"',
      'lucene',
      {
        host: { included: new Set(['b']), excluded: new Set() },
        foo: { included: new Set(['x']), excluded: new Set() },
        bar: { included: new Set(['y']), excluded: new Set() },
      },
    );
    expect(result).toBe('host:"b" AND foo:"x" AND bar:"y"');
  });

  it('preserves free-text terms and re-emits facets', () => {
    const result = replaceFilterClauses('error 404 AND host:"a"', 'lucene', {
      host: { included: new Set(['b']), excluded: new Set() },
    });
    expect(result).toBe('error 404 AND host:"b"');
  });

  it('preserves quoted free-text phrases', () => {
    const result = replaceFilterClauses(
      '"out of memory" AND host:"a"',
      'lucene',
      {
        host: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe('"out of memory" AND host:"b"');
  });

  it('removes a clause when the new state drops the field', () => {
    const result = replaceFilterClauses('host:"a" AND level:"info"', 'lucene', {
      level: { included: new Set(['warn']), excluded: new Set() },
    });
    expect(result).toBe('level:"warn"');
  });

  it('replaces all facets when given a full state', () => {
    const result = replaceFilterClauses(
      'host:"a" AND level:"info" AND foo:"x"',
      'lucene',
      {
        host: { included: new Set(['b']), excluded: new Set() },
        level: { included: new Set(['warn']), excluded: new Set() },
        foo: { included: new Set(['x']), excluded: new Set() },
      },
    );
    expect(result).toBe('host:"b" AND level:"warn" AND foo:"x"');
  });

  it('returns just the new clause for empty input', () => {
    const result = replaceFilterClauses('', 'lucene', {
      host: { included: new Set(['b']), excluded: new Set() },
    });
    expect(result).toBe('host:"b"');
  });

  it('returns empty for a fully-managed input with empty state', () => {
    const result = replaceFilterClauses('host:"a"', 'lucene', {});
    expect(result).toBe('');
  });

  it('replaces invalid lucene with the new clause (sidebar click applies)', () => {
    // Unparseable text (e.g. an incomplete query like `service:`) can't be
    // rewritten in place; a sidebar click should still apply by replacing the
    // broken text with the new state rather than silently no-oping.
    const result = replaceFilterClauses('(((', 'lucene', {
      host: { included: new Set(['b']), excluded: new Set() },
    });
    expect(result).toBe('host:"b"');
  });

  it('preserves an OR group without dangling connectors', () => {
    const result = replaceFilterClauses(
      '(env:"prod" OR env:"staging") AND host:"a"',
      'lucene',
      {
        env: { included: new Set(['qa']), excluded: new Set() },
        host: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe('env:"qa" AND host:"b"');
  });
});

describe('filterStateToWhereClause (sql)', () => {
  it('emits IN clauses', () => {
    const state: FilterState = {
      host: { included: new Set(['a', 'b']), excluded: new Set() },
    };
    expect(filterStateToWhereClause(state, { language: 'sql' })).toBe(
      "host IN ('a', 'b')",
    );
  });

  it('emits NOT IN clauses', () => {
    const state: FilterState = {
      host: { included: new Set(), excluded: new Set(['a']) },
    };
    expect(filterStateToWhereClause(state, { language: 'sql' })).toBe(
      "host NOT IN ('a')",
    );
  });
});

describe('parseWhereClauseToFilterState (sql)', () => {
  it('parses an IN clause', () => {
    const state = parseWhereClauseToFilterState("host IN ('a', 'b')", 'sql');
    expect(Array.from(state.host?.included ?? [])).toEqual(
      expect.arrayContaining(['a', 'b']),
    );
  });

  it('parses a NOT IN clause', () => {
    const state = parseWhereClauseToFilterState("host NOT IN ('a')", 'sql');
    expect(Array.from(state.host?.excluded ?? [])).toEqual(['a']);
  });

  it('parses a BETWEEN clause into a range', () => {
    const state = parseWhereClauseToFilterState(
      'duration BETWEEN 10 AND 500',
      'sql',
    );
    expect(state.duration?.range).toEqual({ min: 10, max: 500 });
  });
});

describe('replaceFilterClauses (sql)', () => {
  it('replaces a facet conjunct and preserves other conjuncts', () => {
    const result = replaceFilterClauses(
      "host IN ('a') AND foo = 'bar'",
      'sql',
      {
        host: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe("foo = 'bar' AND host IN ('b')");
  });

  it('handles BETWEEN conjuncts', () => {
    const result = replaceFilterClauses(
      'duration BETWEEN 1 AND 100 AND foo = 1',
      'sql',
      {
        duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 10, max: 50 },
        },
      },
    );
    expect(result).toBe('foo = 1 AND duration BETWEEN 10 AND 50');
  });

  it('preserves an IN value containing the separator', () => {
    const result = replaceFilterClauses(
      "host IN ('a AND b') AND foo = 'x'",
      'sql',
      {
        host: { included: new Set(['c']), excluded: new Set() },
      },
    );
    expect(result).toBe("foo = 'x' AND host IN ('c')");
  });

  it('removes a facet conjunct when the new state drops the field', () => {
    const result = replaceFilterClauses(
      "host IN ('a') AND level = 'info'",
      'sql',
      {},
    );
    expect(result).toBe("level = 'info'");
  });

  it('returns the new clause for empty input', () => {
    const result = replaceFilterClauses('', 'sql', {
      host: { included: new Set(['b']), excluded: new Set() },
    });
    expect(result).toBe("host IN ('b')");
  });
});

// Regression tests for the 10 WHERE-string generation bugs

describe('NOT prefix is preserved through replaceFilterClauses', () => {
  it('keeps the NOT prefix when a sibling facet clause is replaced', () => {
    // Original: NOT term AND ServiceName:"api"
    // Click sidebar to change ServiceName → "accounting"
    // Must NOT silently strip the `NOT` operator.
    const result = replaceFilterClauses(
      'NOT term AND ServiceName:"api"',
      'lucene',
      {
        ServiceName: { included: new Set(['accounting']), excluded: new Set() },
      },
    );
    expect(result).toBe('NOT term AND ServiceName:"accounting"');
  });
});

describe('cross-field OR is not silently converted to AND', () => {
  it('preserves a cross-field OR query as-is when a different facet is added', () => {
    // ServiceName:"api" OR SeverityText:"error" cannot be represented as a
    // FilterState (AND semantics), so the whole OR must be left untouched.
    const result = replaceFilterClauses(
      'ServiceName:"api" OR SeverityText:"error"',
      'lucene',
      {
        // We are NOT replacing ServiceName or SeverityText — we add a third field.
        level: { included: new Set(['warn']), excluded: new Set() },
      },
    );
    // The cross-field OR is preserved; the new clause is ANDed after.
    expect(result).toBe(
      '(ServiceName:"api" OR SeverityText:"error") AND level:"warn"',
    );
  });

  it('treats each side of a cross-field OR as unmanaged (no field collected)', () => {
    // parseWhereClauseToFilterState should return empty for cross-field OR
    // because neither side alone represents a reproducible facet state.
    const state = parseWhereClauseToFilterState(
      'ServiceName:"api" OR SeverityText:"error"',
      'lucene',
    );
    expect(state).toEqual({});
  });
});

describe('field-group syntax ServiceName:("api" OR "web") round-trips correctly', () => {
  it('parses a field group into the correct FilterState', () => {
    const state = parseWhereClauseToFilterState(
      'ServiceName:("api" OR "web")',
      'lucene',
    );
    expect(state).toEqual({
      ServiceName: { included: new Set(['api', 'web']), excluded: new Set() },
    });
  });

  it('replaces a field-group clause without duplicating or dropping the field name', () => {
    // Bug: was dropping ServiceName: and emitting ("api" OR "web") as free-text,
    // then also appending the new clause → duplication + full-text search.
    const result = replaceFilterClauses(
      'ServiceName:("api" OR "web") AND term',
      'lucene',
      {
        ServiceName: {
          included: new Set(['api', 'web', 'admin']),
          excluded: new Set(),
        },
      },
    );
    // `term` (free-text) preserved; ServiceName clause replaced (no duplication).
    expect(result).toBe(
      'term AND (ServiceName:"api" OR ServiceName:"web" OR ServiceName:"admin")',
    );
  });
});

describe('range clause at source offset 0 is not dropped', () => {
  it('replaces a range that starts at the beginning of the query string', () => {
    // Duration:[* TO 100] starts at offset 0 → fieldLocation.start.offset === 0,
    // which is falsy and was causing the span to be null (clause silently dropped).
    const result = replaceFilterClauses(
      'Duration:[0 TO 100] AND ServiceName:"api"',
      'lucene',
      {
        Duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 0, max: 50 },
        },
        ServiceName: { included: new Set(['web']), excluded: new Set() },
      },
    );
    expect(result).toBe('Duration:[0 TO 50] AND ServiceName:"web"');
  });

  it('parses a range at offset 0 into FilterState correctly', () => {
    const state = parseWhereClauseToFilterState(
      'Duration:[0 TO 100]',
      'lucene',
    );
    expect(state).toEqual({
      Duration: {
        included: new Set(),
        excluded: new Set(),
        range: { min: 0, max: 100 },
      },
    });
  });
});

describe('exclusive range bounds are preserved', () => {
  it('emits exclusive {…} brackets when the range has inclusive: none', () => {
    const state: FilterState = {
      Duration: {
        included: new Set(),
        excluded: new Set(),
        range: { min: 10, max: 20, inclusive: 'none' },
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'Duration:{10 TO 20}',
    );
  });

  it('round-trips an exclusive range without converting to inclusive', () => {
    const result = replaceFilterClauses('Duration:{10 TO 20}', 'lucene', {
      Duration: {
        included: new Set(),
        excluded: new Set(),
        range: { min: 10, max: 20, inclusive: 'none' },
      },
    });
    expect(result).toBe('Duration:{10 TO 20}');
  });

  it('parses an exclusive range and stores inclusive: none', () => {
    const state = parseWhereClauseToFilterState(
      'Duration:{10 TO 20}',
      'lucene',
    );
    expect(state.Duration?.range).toEqual({
      min: 10,
      max: 20,
      inclusive: 'none',
    });
  });

  it('emits left-exclusive {min TO max] for inclusive: right', () => {
    const state: FilterState = {
      score: {
        included: new Set(),
        excluded: new Set(),
        range: { min: 0, max: 100, inclusive: 'right' },
      },
    };
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      'score:{0 TO 100]',
    );
  });
});

describe('proximity/boost modifiers are not stripped', () => {
  it('preserves a proximity modifier when a sibling facet is replaced', () => {
    // msg:"hello"~2 should remain untouched when ServiceName is changed.
    const result = replaceFilterClauses(
      'msg:"hello"~2 AND ServiceName:"api"',
      'lucene',
      {
        ServiceName: { included: new Set(['web']), excluded: new Set() },
      },
    );
    expect(result).toBe('msg:"hello"~2 AND ServiceName:"web"');
  });

  it('preserves a boost modifier when a sibling facet is replaced', () => {
    const result = replaceFilterClauses(
      'title:"report"^3 AND level:"info"',
      'lucene',
      {
        level: { included: new Set(['warn']), excluded: new Set() },
      },
    );
    expect(result).toBe('title:"report"^3 AND level:"warn"');
  });

  it('does not collect a proximity term into FilterState', () => {
    // A proximity term cannot be faithfully represented; it should be skipped.
    const state = parseWhereClauseToFilterState(
      'msg:"hello"~2 AND ServiceName:"api"',
      'lucene',
    );
    expect(state).toEqual({
      ServiceName: { included: new Set(['api']), excluded: new Set() },
    });
  });
});

describe('modifier terms and negated ranges do not survive alongside new clause', () => {
  it('replaces a plain sibling clause when the field also has a modifier term', () => {
    // msg:"hello"~2 cannot round-trip into FilterState, but msg:"world" can.
    // When the sidebar sets msg:"goodbye", msg:"world" must be removed so it
    // does not pile up alongside the new clause.
    const result = replaceFilterClauses(
      'msg:"hello"~2 AND msg:"world" AND ServiceName:"api"',
      'lucene',
      {
        msg: { included: new Set(['goodbye']), excluded: new Set() },
        ServiceName: { included: new Set(['api']), excluded: new Set() },
      },
    );
    // msg:"world" is pruned; msg:"hello"~2 is preserved verbatim (unmanageable).
    expect(result).toBe(
      'msg:"hello"~2 AND msg:"goodbye" AND ServiceName:"api"',
    );
  });

  it('preserves a modifier-only field verbatim and appends the new clause', () => {
    // If there is no plain sibling, the modifier term is kept and the new
    // clause is appended — the sidebar click still applies.
    const result = replaceFilterClauses(
      'msg:"hello"~2 AND ServiceName:"api"',
      'lucene',
      {
        msg: { included: new Set(['goodbye']), excluded: new Set() },
        ServiceName: { included: new Set(['api']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      'msg:"hello"~2 AND msg:"goodbye" AND ServiceName:"api"',
    );
  });

  it('replaces a plain range clause when the field also has a negated range', () => {
    // NOT duration:[10 TO 20] cannot round-trip, but duration:[0 TO 5] can.
    // When the sidebar sets a new range for duration, duration:[0 TO 5] must
    // be removed so it does not duplicate alongside the new range.
    const result = replaceFilterClauses(
      'NOT duration:[10 TO 20] AND duration:[0 TO 5]',
      'lucene',
      {
        duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 1, max: 3 },
        },
      },
    );
    // duration:[0 TO 5] is pruned; NOT duration:[10 TO 20] is preserved.
    expect(result).toBe('NOT duration:[10 TO 20] AND duration:[1 TO 3]');
  });
});

describe('unquoted field term is replaced (not duplicated) by sidebar click', () => {
  it('replaces an unquoted field term when the sidebar emits a quoted one', () => {
    // level:error (unquoted) → sidebar adds level:"warn"
    // Was: level:error AND level:"warn" → zero rows (two conflicting conditions)
    // Fixed: level:"warn"
    const result = replaceFilterClauses('level:error', 'lucene', {
      level: { included: new Set(['warn']), excluded: new Set() },
    });
    expect(result).toBe('level:"warn"');
  });

  it('does not add a quoted duplicate alongside an unquoted term', () => {
    const result = replaceFilterClauses(
      'level:error AND ServiceName:"api"',
      'lucene',
      {
        level: { included: new Set(['warn']), excluded: new Set() },
        ServiceName: { included: new Set(['api']), excluded: new Set() },
      },
    );
    expect(result).toBe('level:"warn" AND ServiceName:"api"');
  });
});

describe('attribute keys with special chars are properly escaped', () => {
  it('escapes ( and ) in attribute key names', () => {
    const state: FilterState = {
      "LogAttributes['a(b)']": {
        included: new Set(['value']),
        excluded: new Set(),
      },
    };
    const emitted = filterStateToWhereClause(state, { language: 'lucene' });
    // Must be parseable (not throw) and contain the correct field.
    expect(() => parse(emitted)).not.toThrow();
    expect(emitted).toContain('"value"');
  });

  it('escapes [ and ] in attribute key names', () => {
    const state: FilterState = {
      "LogAttributes['arr[0]']": {
        included: new Set(['x']),
        excluded: new Set(),
      },
    };
    const emitted = filterStateToWhereClause(state, { language: 'lucene' });
    expect(() => parse(emitted)).not.toThrow();
  });

  it('escapes { in attribute key names', () => {
    const state: FilterState = {
      "LogAttributes['{key}']": {
        included: new Set(['v']),
        excluded: new Set(),
      },
    };
    const emitted = filterStateToWhereClause(state, { language: 'lucene' });
    expect(() => parse(emitted)).not.toThrow();
  });

  it('escapes spaces in attribute key names', () => {
    const state: FilterState = {
      "LogAttributes['my key']": {
        included: new Set(['v']),
        excluded: new Set(),
      },
    };
    const emitted = filterStateToWhereClause(state, { language: 'lucene' });
    expect(() => parse(emitted)).not.toThrow();
  });
});

describe('closing paren inside a quoted value does not break top-level OR detection', () => {
  it('wraps the residual in parens when it has a top-level OR with a paren inside a quoted value', () => {
    // "timeout)" OR "error" → the ) inside the quoted string must NOT be counted
    // as a closing paren for depth tracking.
    const result = replaceFilterClauses('"timeout)" OR "error"', 'lucene', {
      level: { included: new Set(['x']), excluded: new Set() },
    });
    // The residual "timeout)" OR "error" has a top-level OR → must be wrapped.
    expect(result).toBe('("timeout)" OR "error") AND level:"x"');
  });

  it('does not double-wrap when the residual is already parenthesized', () => {
    const result = replaceFilterClauses('("a)" OR "b")', 'lucene', {
      level: { included: new Set(['x']), excluded: new Set() },
    });
    // Already parenthesized; top-level OR is inside parens → no extra wrap.
    expect(result).toBe('("a)" OR "b") AND level:"x"');
  });
});

describe('no extra spaces accumulate on repeated sidebar clicks', () => {
  it('does not grow extra spaces inside the OR group after multiple interactions', () => {
    // First click
    const step1 = replaceFilterClauses('term1 OR term2', 'lucene', {
      ServiceName: { included: new Set(['api']), excluded: new Set() },
    });
    // step1 should be "(term1 OR term2) AND ServiceName:\"api\""
    expect(step1).toBe('(term1 OR term2) AND ServiceName:"api"');

    // Second click (simulates toggling another value)
    const step2 = replaceFilterClauses(step1, 'lucene', {
      ServiceName: { included: new Set(['web']), excluded: new Set() },
    });
    expect(step2).toBe('(term1 OR term2) AND ServiceName:"web"');

    // Third click
    const step3 = replaceFilterClauses(step2, 'lucene', {
      ServiceName: { included: new Set(['admin']), excluded: new Set() },
    });
    expect(step3).toBe('(term1 OR term2) AND ServiceName:"admin"');

    // Fourth click — must still be the same paren group with no extra spaces.
    const step4 = replaceFilterClauses(step3, 'lucene', {
      ServiceName: {
        included: new Set(['api', 'admin']),
        excluded: new Set(),
      },
    });
    expect(step4).toBe(
      '(term1 OR term2) AND (ServiceName:"api" OR ServiceName:"admin")',
    );
  });

  it('does not add trailing space to individual terms when re-joining', () => {
    const step1 = replaceFilterClauses('term1 OR term2', 'lucene', {
      level: { included: new Set(['warn']), excluded: new Set() },
    });
    // Should be exactly "(term1 OR term2) AND level:\"warn\"" — no extra spaces
    expect(step1).not.toMatch(/term1 {2,}OR|OR {2,}term2/);
    expect(step1).toBe('(term1 OR term2) AND level:"warn"');
  });
});

describe('top-level OR residual is parenthesized before AND join', () => {
  it('wraps the residual in parens so the facet only applies to the whole OR', () => {
    const result = replaceFilterClauses(
      "ServiceName = 'a' OR ServiceName = 'b'",
      'sql',
      {
        ServiceName: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "(ServiceName = 'a' OR ServiceName = 'b') AND ServiceName IN ('b')",
    );
  });

  it('handles lowercase or operator', () => {
    const result = replaceFilterClauses(
      "ServiceName = 'a' or ServiceName = 'b'",
      'sql',
      {
        SeverityText: { included: new Set(['error']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "(ServiceName = 'a' or ServiceName = 'b') AND SeverityText IN ('error')",
    );
  });

  it('does not double-wrap when the OR is already inside parens', () => {
    const result = replaceFilterClauses(
      "ServiceName = 'a' AND (level = 'info' OR level = 'warn')",
      'sql',
      {
        host: { included: new Set(['web']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "ServiceName = 'a' AND (level = 'info' OR level = 'warn') AND host IN ('web')",
    );
  });

  it('does not treat an OR inside a quoted value as top-level', () => {
    const result = replaceFilterClauses("msg = 'a OR b'", 'sql', {
      host: { included: new Set(['web']), excluded: new Set() },
    });
    expect(result).toBe("msg = 'a OR b' AND host IN ('web')");
  });
});

describe('line comments do not swallow appended facets', () => {
  it('re-appends a trailing -- comment after the new predicate', () => {
    const result = replaceFilterClauses(
      "ServiceName = 'a' -- temp note",
      'sql',
      {
        ServiceName: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "ServiceName = 'a' AND ServiceName IN ('b') -- temp note",
    );
  });

  it('does not treat a commented-out AND as a conjunct separator', () => {
    const result = replaceFilterClauses(
      "ServiceName = 'a' -- note AND should stay commented",
      'sql',
      {
        host: { included: new Set(['web']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "ServiceName = 'a' AND host IN ('web') -- note AND should stay commented",
    );
  });

  it('leaves a -- inside a quoted value untouched', () => {
    const result = replaceFilterClauses("msg = 'a -- b'", 'sql', {
      host: { included: new Set(['web']), excluded: new Set() },
    });
    expect(result).toBe("msg = 'a -- b' AND host IN ('web')");
  });

  it('re-appends a block comment after the new predicate', () => {
    const result = replaceFilterClauses(
      "ServiceName = 'a' /* temp note */",
      'sql',
      {
        ServiceName: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "ServiceName = 'a' AND ServiceName IN ('b') /* temp note */",
    );
  });
});

describe('unbalanced paren inside a string and quotes in backtick keys', () => {
  it('does not pile up conjuncts when a string contains an unmatched (', () => {
    const step1 = replaceFilterClauses("msg = 'x AND y IN ('", 'sql', {
      ServiceName: { included: new Set(['a']), excluded: new Set() },
    });
    expect(step1).toBe("msg = 'x AND y IN (' AND ServiceName IN ('a')");

    // Second click must replace, not duplicate.
    const step2 = replaceFilterClauses(step1, 'sql', {
      ServiceName: { included: new Set(['a', 'b']), excluded: new Set() },
    });
    expect(step2).toBe("msg = 'x AND y IN (' AND ServiceName IN ('a', 'b')");
  });

  it('treats a single quote inside a backtick identifier as literal', () => {
    const step1 = replaceFilterClauses("`it's` = 1", 'sql', {
      ServiceName: { included: new Set(['a']), excluded: new Set() },
    });
    expect(step1).toBe("`it's` = 1 AND ServiceName IN ('a')");

    // Second click must replace, not duplicate.
    const step2 = replaceFilterClauses(step1, 'sql', {
      ServiceName: { included: new Set(['a', 'b']), excluded: new Set() },
    });
    expect(step2).toBe("`it's` = 1 AND ServiceName IN ('a', 'b')");
  });
});

describe('backticked column facet replaces cleanly on repeat clicks', () => {
  it('does not duplicate a backticked key with a hyphen', () => {
    const escapeKey = (key: string) => `\`${key}\``;
    const step1 = replaceFilterClauses(
      '',
      'sql',
      {
        'service-name': { included: new Set(['a']), excluded: new Set() },
      },
      { escapeKey },
    );
    expect(step1).toBe("`service-name` IN ('a')");

    const step2 = replaceFilterClauses(
      step1,
      'sql',
      {
        'service-name': { included: new Set(['a', 'b']), excluded: new Set() },
      },
      { escapeKey },
    );
    expect(step2).toBe("`service-name` IN ('a', 'b')");
  });
});

describe('IN (SELECT ...) subqueries are preserved, not treated as facets', () => {
  it('does not destroy a subquery when a different facet is added', () => {
    const result = replaceFilterClauses(
      'ServiceName IN (SELECT name FROM t) AND foo = 1',
      'sql',
      {
        ServiceName: { included: new Set(['b']), excluded: new Set() },
      },
    );
    expect(result).toBe(
      "ServiceName IN (SELECT name FROM t) AND foo = 1 AND ServiceName IN ('b')",
    );
  });

  it('does not render a checkbox for a subquery value', () => {
    const state = parseWhereClauseToFilterState(
      'ServiceName IN (SELECT name FROM t) AND foo = 1',
      'sql',
    );
    expect(state).toEqual({});
  });
});

describe('repeated SQL predicates for the same field are all replaced by a sidebar click', () => {
  it('replaces all conjuncts when the same key appears twice', () => {
    // host IN ('a') AND host IN ('b') contains duplicate predicates for the
    // same field (can arise from manual edits or legacy saved searches). When
    // the user clicks a sidebar value for host, ALL existing host conjuncts
    // must be replaced — leaving the old restrictions active causes the
    // sidebar selection to return zero rows.
    const result = replaceFilterClauses(
      "host IN ('a') AND host IN ('b')",
      'sql',
      {
        host: { included: new Set(['c']), excluded: new Set() },
      },
    );
    expect(result).toBe("host IN ('c')");
  });

  it('still replaces a key that appears exactly once', () => {
    const result = replaceFilterClauses(
      "host IN ('a') AND level IN ('error')",
      'sql',
      {
        host: { included: new Set(['b']), excluded: new Set() },
        level: { included: new Set(['warn']), excluded: new Set() },
      },
    );
    expect(result).toBe("host IN ('b') AND level IN ('warn')");
  });

  it('replaces all conjuncts for a duplicate key while also replacing a single-occurrence key', () => {
    const result = replaceFilterClauses(
      "host IN ('a') AND host IN ('b') AND level IN ('error')",
      'sql',
      {
        host: { included: new Set(['c']), excluded: new Set() },
        level: { included: new Set(['warn']), excluded: new Set() },
      },
    );
    expect(result).toBe("host IN ('c') AND level IN ('warn')");
  });

  it('drops all duplicate conjuncts for a field when it is removed from the sidebar', () => {
    const result = replaceFilterClauses(
      "host IN ('a') AND host IN ('b') AND level IN ('error')",
      'sql',
      {
        level: { included: new Set(['warn']), excluded: new Set() },
      },
    );
    expect(result).toBe("level IN ('warn')");
  });
});

describe('mergeFilterStateIntoWhereClause preserves the existing where text', () => {
  const errorSeverity: FilterState = {
    SeverityText: { included: new Set(['error']), excluded: new Set() },
  };

  it('appends lucene filters to a lucene where clause', () => {
    expect(
      mergeFilterStateIntoWhereClause(
        'ServiceName:"api"',
        'lucene',
        errorSeverity,
      ),
    ).toBe('ServiceName:"api" AND SeverityText:"error"');
  });

  it('appends SQL filters to a SQL where clause', () => {
    expect(
      mergeFilterStateIntoWhereClause("ServiceName = 'api'", 'sql', {
        SeverityText: { included: new Set(['error']), excluded: new Set() },
      }),
    ).toBe("ServiceName = 'api' AND SeverityText IN ('error')");
  });

  it('parenthesizes a top-level OR in the existing lucene text before appending', () => {
    expect(
      mergeFilterStateIntoWhereClause(
        'a:"1" OR b:"2"',
        'lucene',
        errorSeverity,
      ),
    ).toBe('(a:"1" OR b:"2") AND SeverityText:"error"');
  });

  it('does not double-wrap an already-parenthesized lucene OR', () => {
    expect(
      mergeFilterStateIntoWhereClause('(a:"1" OR b:"2")', 'lucene', {
        SeverityText: { included: new Set(['error']), excluded: new Set() },
      }),
    ).toBe('(a:"1" OR b:"2") AND SeverityText:"error"');
  });

  it('parenthesizes a top-level OR in the existing SQL text before appending', () => {
    expect(
      mergeFilterStateIntoWhereClause(
        "ServiceName = 'a' OR ServiceName = 'b'",
        'sql',
        errorSeverity,
      ),
    ).toBe(
      "(ServiceName = 'a' OR ServiceName = 'b') AND SeverityText IN ('error')",
    );
  });

  it('re-appends SQL comments after the appended predicate', () => {
    expect(
      mergeFilterStateIntoWhereClause(
        "ServiceName = 'a' -- temp note",
        'sql',
        errorSeverity,
      ),
    ).toBe("ServiceName = 'a' AND SeverityText IN ('error') -- temp note");
  });

  it('uses escapeKey for the emitted SQL clauses while preserving the original text', () => {
    const escapeKey = (key: string) => `\`${key}\``;
    expect(
      mergeFilterStateIntoWhereClause(
        "`service-name` = 'a'",
        'sql',
        { 'service-name': { included: new Set(['b']), excluded: new Set() } },
        { escapeKey },
      ),
    ).toBe("`service-name` = 'a' AND `service-name` IN ('b')");
  });

  it('returns only the emitted state when the where text is empty', () => {
    expect(mergeFilterStateIntoWhereClause('', 'lucene', errorSeverity)).toBe(
      'SeverityText:"error"',
    );
  });

  it('returns the trimmed where text when the state emits nothing', () => {
    expect(mergeFilterStateIntoWhereClause('  a:"1"  ', 'lucene', {})).toBe(
      'a:"1"',
    );
  });
});

describe('replaceFilterClauses emitLanguage (query-language translation)', () => {
  const serviceApi: FilterState = {
    ServiceName: { included: new Set(['api']), excluded: new Set() },
  };

  it('translates lucene facets to SQL while preserving free text', () => {
    expect(
      replaceFilterClauses(
        'ServiceName:"api" AND error',
        'lucene',
        serviceApi,
        { emitLanguage: 'sql' },
      ),
    ).toBe("error AND ServiceName IN ('api')");
  });

  it('translates SQL facets to lucene', () => {
    expect(
      replaceFilterClauses("ServiceName IN ('api')", 'sql', serviceApi, {
        emitLanguage: 'lucene',
      }),
    ).toBe('ServiceName:"api"');
  });

  it('wraps a cross-field OR residual in parens before the SQL clause', () => {
    expect(
      replaceFilterClauses(
        'a:"1" OR b:"2"',
        'lucene',
        { c: { included: new Set(['3']), excluded: new Set() } },
        { emitLanguage: 'sql' },
      ),
    ).toBe('(a:"1" OR b:"2") AND c IN (\'3\')');
  });

  it('emits SQL ranges via escapeKey when translating lucene to SQL', () => {
    const escapeKey = (key: string) => `\`${key}\``;
    expect(
      replaceFilterClauses(
        'service-name:"a"',
        'lucene',
        { 'service-name': { included: new Set(['b']), excluded: new Set() } },
        { emitLanguage: 'sql', escapeKey },
      ),
    ).toBe("`service-name` IN ('b')");
  });

  it('returns the where text unchanged when there is nothing to translate', () => {
    expect(
      replaceFilterClauses(
        'error 404',
        'lucene',
        {},
        {
          emitLanguage: 'sql',
        },
      ),
    ).toBe('error 404');
  });
});

describe('getWhereParseError', () => {
  it('returns null for empty, valid, and SQL input', () => {
    expect(getWhereParseError('', 'lucene')).toBeNull();
    expect(getWhereParseError('ServiceName:"api"', 'lucene')).toBeNull();
    expect(getWhereParseError("ServiceName = 'api'", 'sql')).toBeNull();
  });

  it('returns a message for unparseable lucene', () => {
    expect(getWhereParseError('service:', 'lucene')).not.toBeNull();
    expect(getWhereParseError('(((', 'lucene')).not.toBeNull();
  });
});

describe('getUnrepresentableWhereReason', () => {
  it('flags a cross-field OR', () => {
    expect(
      getUnrepresentableWhereReason(
        'ServiceName:"api" OR SeverityText:"error"',
        'lucene',
      ),
    ).not.toBeNull();
  });

  it('flags an OR NOT across fields', () => {
    expect(
      getUnrepresentableWhereReason('a:"1" OR NOT b:"2"', 'lucene'),
    ).not.toBeNull();
  });

  it('does not flag AND or same-field OR', () => {
    expect(
      getUnrepresentableWhereReason(
        'ServiceName:"api" AND SeverityText:"error"',
        'lucene',
      ),
    ).toBeNull();
    expect(
      getUnrepresentableWhereReason('a:"1" OR a:"2"', 'lucene'),
    ).toBeNull();
  });

  it('does not flag SQL or unparseable input', () => {
    expect(
      getUnrepresentableWhereReason(
        "ServiceName = 'api' OR SeverityText = 'error'",
        'sql',
      ),
    ).toBeNull();
    expect(getUnrepresentableWhereReason('service:', 'lucene')).toBeNull();
  });
});

describe('lucene NOT keyword negation', () => {
  it('parses NOT field:"value" as excluded', () => {
    expect(
      parseWhereClauseToFilterState('NOT ServiceName:"api"', 'lucene'),
    ).toEqual({
      ServiceName: { included: new Set(), excluded: new Set(['api']) },
    });
  });

  it('parses term AND NOT field:"value" as excluded', () => {
    expect(
      parseWhereClauseToFilterState('term AND NOT ServiceName:"api"', 'lucene'),
    ).toEqual({
      ServiceName: { included: new Set(), excluded: new Set(['api']) },
    });
  });

  it('parses AND NOT on a second field', () => {
    expect(
      parseWhereClauseToFilterState('a:"1" AND NOT b:"2"', 'lucene'),
    ).toEqual({
      a: { included: new Set(['1']), excluded: new Set() },
      b: { included: new Set(), excluded: new Set(['2']) },
    });
  });

  it('parses NOT prefix on a binary left subtree', () => {
    expect(
      parseWhereClauseToFilterState('NOT a:"1" AND b:"2"', 'lucene'),
    ).toEqual({
      a: { included: new Set(), excluded: new Set(['1']) },
      b: { included: new Set(['2']), excluded: new Set() },
    });
  });

  it('treats a double negation as included', () => {
    expect(parseWhereClauseToFilterState('NOT -a:"1"', 'lucene')).toEqual({
      a: { included: new Set(['1']), excluded: new Set() },
    });
  });

  it('does not collect a cross-field OR NOT as facets', () => {
    expect(
      parseWhereClauseToFilterState('a:"1" OR NOT b:"2"', 'lucene'),
    ).toEqual({});
  });

  it('round-trips NOT via excluded emission', () => {
    const state = parseWhereClauseToFilterState(
      'term AND NOT ServiceName:"api"',
      'lucene',
    );
    expect(filterStateToWhereClause(state, { language: 'lucene' })).toBe(
      '-ServiceName:"api"',
    );
  });
});
