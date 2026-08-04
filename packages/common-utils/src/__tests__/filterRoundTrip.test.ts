import {
  type FilterState,
  filterStateToWhereClause,
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

  it('leaves invalid lucene unchanged', () => {
    const result = replaceFilterClauses('(((', 'lucene', {
      host: { included: new Set(['b']), excluded: new Set() },
    });
    expect(result).toBe('(((');
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
