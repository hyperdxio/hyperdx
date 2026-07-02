import { rewriteSqlFilterWithKvItems } from '@/core/renderChartConfig';
import { KvItemsLookup } from '@/queryParser';

const makeLookup = (
  entries: Array<[string, { kvItemsColumn: string; separator: string }]>,
): KvItemsLookup => new Map(entries);

const defaultLookup: KvItemsLookup = makeLookup([
  ['LogAttributes', { kvItemsColumn: 'LogAttributeItems', separator: '=' }],
]);

describe('rewriteSqlFilterWithKvItems', () => {
  describe('early returns', () => {
    it('returns the condition verbatim when the lookup is empty', () => {
      expect(
        rewriteSqlFilterWithKvItems('this is not valid SQL', new Map()),
      ).toBe('this is not valid SQL');

      expect(
        rewriteSqlFilterWithKvItems("LogAttributes['k'] = 'v'", new Map()),
      ).toBe("LogAttributes['k'] = 'v'");
    });

    it('returns the condition verbatim when the SQL fails to parse', () => {
      const condition = 'this is not valid SQL ???';
      expect(rewriteSqlFilterWithKvItems(condition, defaultLookup)).toBe(
        condition,
      );
    });

    it('returns the condition verbatim for an empty condition string', () => {
      expect(rewriteSqlFilterWithKvItems('', defaultLookup)).toBe('');
    });
  });

  describe('= operator', () => {
    it("rewrites Map['key'] = 'value' to has(kvItems, concat(key, sep, value))", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['service.name'] = 'api'",
        defaultLookup,
      );
      expect(result).toBe(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
    });

    it('does not rewrite when the value is an empty string', () => {
      // Map(String, String) subscript defaults to '' for absent keys, so
      // `Map['k'] = ''` would silently match records where 'k' is unset if
      // rewritten to has(items, 'k='). Same rationale as the source comment.
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = ''",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).toContain("LogAttributes['k'] = ''");
    });

    it('does not rewrite when the right side is a numeric literal', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 5",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).toContain("LogAttributes['k'] = 5");
    });

    it('does not rewrite when the right side is a column reference', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = Severity",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
    });

    it('does not rewrite when the subscript appears on the right side', () => {
      const result = rewriteSqlFilterWithKvItems(
        "'api' = LogAttributes['k']",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
    });

    it('does not rewrite when the map column is not in the lookup', () => {
      const result = rewriteSqlFilterWithKvItems(
        "ResourceAttributes['k'] = 'v'",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).toContain("ResourceAttributes['k'] = 'v'");
    });

    it('does not rewrite plain column comparisons (no subscript)', () => {
      const result = rewriteSqlFilterWithKvItems(
        "Severity = 'error'",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).toContain("Severity = 'error'");
    });
  });

  describe('IN operator', () => {
    it("rewrites Map['key'] IN ('a') (single item) to has(...) not hasAny(...)", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a')",
        defaultLookup,
      );
      expect(result).toBe("has(`LogAttributeItems`, concat('k', '=', 'a'))");
    });

    it("rewrites Map['key'] IN ('a','b','c') to hasAny(... array(...))", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', 'b', 'c')",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAny(`LogAttributeItems`, array(concat('k', '=', 'a'), concat('k', '=', 'b'), concat('k', '=', 'c')))",
      );
    });

    it('does not rewrite when any IN value is an empty string', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', '')",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).not.toContain('hasAny(');
    });

    it('does not rewrite when any IN value is non-string', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', 5)",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).not.toContain('hasAny(');
    });

    it('does not rewrite NOT IN', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] NOT IN ('a', 'b')",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).not.toContain('hasAny(');
    });
  });

  describe('other operators are not rewritten', () => {
    it.each([
      ["LogAttributes['k'] != 'v'", '!='],
      ["LogAttributes['k'] < 'v'", '<'],
      ["LogAttributes['k'] > 'v'", '>'],
      ["LogAttributes['k'] <= 'v'", '<='],
      ["LogAttributes['k'] >= 'v'", '>='],
      ["LogAttributes['k'] LIKE '%v%'", 'LIKE'],
      ["LogAttributes['k'] BETWEEN 'a' AND 'z'", 'BETWEEN'],
    ])('leaves %s untouched (operator: %s)', condition => {
      const result = rewriteSqlFilterWithKvItems(condition, defaultLookup);
      expect(result).not.toContain('has(');
      expect(result).not.toContain('hasAny(');
    });
  });

  describe('compound conditions', () => {
    it('rewrites only the matching subscript in an AND chain', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['service.name'] = 'api' AND Severity = 'error'",
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
      expect(result).toContain("Severity = 'error'");
      expect(result).not.toContain("LogAttributes['service.name']");
    });

    it('rewrites only the matching subscript in an OR chain', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' OR Severity = 'error'",
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k', '=', 'v'))",
      );
      expect(result).toContain("Severity = 'error'");
    });

    it('rewrites every matching subscript when several appear together', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['a'] = 'x' AND LogAttributes['b'] = 'y'",
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('a', '=', 'x'))",
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('b', '=', 'y'))",
      );
      expect(result).not.toContain("LogAttributes['");
    });

    it('rewrites subscripts inside nested AND/OR groups', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND (LogAttributes['k2'] = 'v2' OR Severity = 'x')",
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k', '=', 'v'))",
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k2', '=', 'v2'))",
      );
      expect(result).toContain("Severity = 'x'");
    });

    it('mixes = and IN rewrites in the same condition', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND LogAttributes['env'] IN ('prod', 'staging')",
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k', '=', 'v'))",
      );
      expect(result).toContain(
        "hasAny(`LogAttributeItems`, array(concat('env', '=', 'prod'), concat('env', '=', 'staging')))",
      );
    });
  });

  describe('lookup configuration', () => {
    it('uses the configured separator in the rewritten concat', () => {
      const colonLookup = makeLookup([
        [
          'LogAttributes',
          { kvItemsColumn: 'LogAttributeItems', separator: ':' },
        ],
      ]);
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v'",
        colonLookup,
      );
      expect(result).toBe("has(`LogAttributeItems`, concat('k', ':', 'v'))");
    });

    it('uses the configured kv items column name (backtick-quoted)', () => {
      const lookup = makeLookup([
        [
          'LogAttributes',
          { kvItemsColumn: 'CustomItemsColumn', separator: '=' },
        ],
      ]);
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v'",
        lookup,
      );
      expect(result).toBe("has(`CustomItemsColumn`, concat('k', '=', 'v'))");
    });

    it('applies independent lookup entries to each map column', () => {
      const lookup = makeLookup([
        [
          'LogAttributes',
          { kvItemsColumn: 'LogAttributeItems', separator: '=' },
        ],
        [
          'ResourceAttributes',
          { kvItemsColumn: 'ResourceAttributeItems', separator: ':' },
        ],
      ]);
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND ResourceAttributes['k2'] = 'v2'",
        lookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k', '=', 'v'))",
      );
      expect(result).toContain(
        "has(`ResourceAttributeItems`, concat('k2', ':', 'v2'))",
      );
    });

    it('rewrites only map columns present in the lookup', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND OtherMap['k2'] = 'v2'",
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k', '=', 'v'))",
      );
      expect(result).toContain("OtherMap['k2'] = 'v2'");
    });
  });

  describe('edge cases', () => {
    it('preserves whitespace and special characters in map keys', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['key with spaces'] = 'value'",
        defaultLookup,
      );
      expect(result).toBe(
        "has(`LogAttributeItems`, concat('key with spaces', '=', 'value'))",
      );
    });

    it('does not rewrite chained subscripts (Map[a][b])', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k']['k2'] = 'v'",
        defaultLookup,
      );
      expect(result).not.toContain('has(');
    });

    it('is idempotent on an already-rewritten has() condition', () => {
      const alreadyRewritten =
        "has(`LogAttributeItems`, concat('k', '=', 'v'))";
      const result = rewriteSqlFilterWithKvItems(
        alreadyRewritten,
        defaultLookup,
      );
      expect(result).toContain(
        "has(`LogAttributeItems`, concat('k', '=', 'v'))",
      );
    });
  });
});
