import { rewriteSqlFilterWithKvItems } from '@/core/renderChartConfig';
import { KvItemsLookup } from '@/queryParser';

type PartialKvItemsInfo = {
  kvItemsColumn: string;
  separator: string;
  useHasAny?: boolean;
};

const makeLookup = (
  entries: Array<[string, PartialKvItemsInfo]>,
): KvItemsLookup =>
  new Map(entries.map(([k, v]) => [k, { useHasAny: true, ...v }]));

const defaultLookup: KvItemsLookup = makeLookup([
  ['LogAttributes', { kvItemsColumn: 'LogAttributeItems', separator: '=' }],
]);

const legacyLookup: KvItemsLookup = makeLookup([
  [
    'LogAttributes',
    {
      kvItemsColumn: 'LogAttributeItems',
      separator: '=',
      useHasAny: false,
    },
  ],
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
    it("rewrites Map['key'] = 'value' to hasAllTokens(kvItems, array('key=value'))", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['service.name'] = 'api'",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAllTokens(`LogAttributeItems`, array('service.name=api'))",
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
    it("rewrites Map['key'] IN ('a') (single item) to hasAllTokens(...) not hasAnyTokens(...)", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a')",
        defaultLookup,
      );
      expect(result).toBe("hasAllTokens(`LogAttributeItems`, array('k=a'))");
    });

    it("rewrites Map['key'] IN ('a','b','c') to hasAnyTokens(... array(...))", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', 'b', 'c')",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('k=a', 'k=b', 'k=c'))",
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
        "hasAllTokens(`LogAttributeItems`, array('service.name=api'))",
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
        "hasAllTokens(`LogAttributeItems`, array('k=v'))",
      );
      expect(result).toContain("Severity = 'error'");
    });

    it('collapses AND-connected equality matchers into ONE hasAllTokens per items column', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['a'] = 'x' AND LogAttributes['b'] = 'y'",
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('a=x', 'b=y'))",
      );
      expect((result.match(/hasAllTokens\(/g) ?? []).length).toBe(1);
      expect(result).not.toContain("LogAttributes['");
    });

    it('rewrites subscripts inside nested AND/OR groups', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND (LogAttributes['k2'] = 'v2' OR Severity = 'x')",
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=v'))",
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k2=v2'))",
      );
      expect(result).toContain("Severity = 'x'");
    });

    it('mixes = and IN rewrites in the same condition', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND LogAttributes['env'] IN ('prod', 'staging')",
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=v'))",
      );
      expect(result).toContain(
        "hasAnyTokens(`LogAttributeItems`, array('env=prod', 'env=staging'))",
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
      expect(result).toBe("hasAllTokens(`LogAttributeItems`, array('k:v'))");
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
      expect(result).toBe("hasAllTokens(`CustomItemsColumn`, array('k=v'))");
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
        "hasAllTokens(`LogAttributeItems`, array('k=v'))",
      );
      expect(result).toContain(
        "hasAllTokens(`ResourceAttributeItems`, array('k2:v2'))",
      );
    });

    it('rewrites only map columns present in the lookup', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v' AND OtherMap['k2'] = 'v2'",
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=v'))",
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
        "hasAllTokens(`LogAttributeItems`, array('key with spaces=value'))",
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
        "hasAllTokens(`LogAttributeItems`, array('k=v'))";
      const result = rewriteSqlFilterWithKvItems(
        alreadyRewritten,
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=v'))",
      );
    });
  });

  describe('hasAny fallback (useHasAny: false)', () => {
    it("still rewrites Map['key'] = 'value' to hasAllTokens(...)", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] = 'v'",
        legacyLookup,
      );
      expect(result).toBe("hasAllTokens(`LogAttributeItems`, array('k=v'))");
    });

    it("still rewrites Map['key'] IN ('a') (single item) to hasAllTokens(...)", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a')",
        legacyLookup,
      );
      expect(result).toBe("hasAllTokens(`LogAttributeItems`, array('k=a'))");
    });

    it("rewrites Map['key'] IN ('a','b','c') to a chain of hasAllTokens(...) OR ...", () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', 'b', 'c')",
        legacyLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=a'))",
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=b'))",
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=c'))",
      );
      expect(result).not.toContain('hasAnyTokens(');
      const orCount = (result.match(/ OR /g) ?? []).length;
      expect(orCount).toBeGreaterThanOrEqual(2);
    });

    it('preserves precedence when the fallback OR chain sits inside an AND (IN on the left)', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', 'b') AND Severity = 'error'",
        legacyLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=a'))",
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('k=b'))",
      );
      expect(result).toContain("Severity = 'error'");
      expect(result).not.toContain('hasAny(');
      // The OR chain MUST be parenthesized so AND doesn't bind tighter than OR
      // and cause the right-hand `AND Severity` to attach to only the last has().
      expect(result).toMatch(
        /\(hasAllTokens\(.+?\) OR hasAllTokens\(.+?\)\) AND /,
      );
    });

    it('preserves precedence when the fallback OR chain sits inside an AND (IN on the right)', () => {
      const result = rewriteSqlFilterWithKvItems(
        "Severity = 'error' AND LogAttributes['k'] IN ('a', 'b')",
        legacyLookup,
      );
      expect(result).toContain("Severity = 'error'");
      expect(result).not.toContain('hasAny(');
      // Same rationale as the mirror case above: precedence-sensitive parens.
      expect(result).toMatch(
        / AND \(hasAllTokens\(.+?\) OR hasAllTokens\(.+?\)\)/,
      );
    });

    it('does not rewrite when any IN value is an empty string', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', '')",
        legacyLookup,
      );
      expect(result).not.toContain('has(');
      expect(result).not.toContain('hasAny(');
    });
  });

  describe('OR groups (round 2 §3)', () => {
    const multiLookup: KvItemsLookup = makeLookup([
      ['LogAttributes', { kvItemsColumn: 'LogAttributeItems', separator: '=' }],
      [
        'ResourceAttributes',
        { kvItemsColumn: 'ResourceAttributeItems', separator: '=' },
      ],
    ]);

    it('collapses an OR of two equalities on the same map into ONE hasAnyTokens', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['env'] = 'production' OR LogAttributes['environment'] = 'production'",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('env=production', 'environment=production'))",
      );
    });

    it('merges IN disjuncts into the group token set', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['k'] IN ('a', 'b') OR LogAttributes['j'] = 'c'",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('k=a', 'k=b', 'j=c'))",
      );
    });

    it('keeps an OR group intact inside a wider AND spine', () => {
      const result = rewriteSqlFilterWithKvItems(
        "Severity = 'error' AND (LogAttributes['env'] = 'prod' OR LogAttributes['environment'] = 'prod')",
        defaultLookup,
      );
      expect(result).toContain("Severity = 'error'");
      expect(result).toContain(
        "hasAnyTokens(`LogAttributeItems`, array('env=prod', 'environment=prod'))",
      );
      expect(result).not.toContain('hasAllTokens');
    });

    it('splits an OR group spanning two items columns into per-column probes', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['env'] = 'prod' OR ResourceAttributes['env'] = 'prod' OR LogAttributes['stage'] = 'prod'",
        multiLookup,
      );
      expect(result).toContain(
        "hasAnyTokens(`LogAttributeItems`, array('env=prod', 'stage=prod'))",
      );
      expect(result).toContain(
        "hasAllTokens(`ResourceAttributeItems`, array('env=prod'))",
      );
      expect(result).toMatch(/hasAnyTokens\(.+?\) OR hasAllTokens\(.+?\)/);
    });

    it('leaves the whole OR group un-collapsed when one disjunct is not tokenizable (per-node rewrites still apply)', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['env'] = 'prod' OR Severity = 'error'",
        defaultLookup,
      );
      expect(result).not.toContain('hasAnyTokens');
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('env=prod'))",
      );
      expect(result).toContain("Severity = 'error'");
    });

    it('dedupes repeated tokens within an OR group', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['env'] = 'prod' OR LogAttributes['env'] = 'prod' OR LogAttributes['env'] = 'dev'",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('env=prod', 'env=dev'))",
      );
    });

    it('falls back to an OR chain of hasAllTokens without hasAnyTokens support', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['env'] = 'prod' OR LogAttributes['environment'] = 'prod'",
        legacyLookup,
      );
      expect(result).not.toContain('hasAnyTokens');
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('env=prod'))",
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('environment=prod'))",
      );
    });

    it('parenthesizes the legacy OR chain inside a wider AND (precedence)', () => {
      // Without parens, `x = 1 AND a OR b` rebinds to `(x = 1 AND a) OR b`
      // and rows failing the AND leak through.
      const result = rewriteSqlFilterWithKvItems(
        "Severity = 'error' AND (LogAttributes['env'] = 'prod' OR LogAttributes['environment'] = 'prod')",
        legacyLookup,
      );
      expect(result).toMatch(
        / AND \(hasAllTokens\(.+?\) OR hasAllTokens\(.+?\)\)/,
      );
    });

    it('does not merge an OR group into the AND-spine collapse', () => {
      const result = rewriteSqlFilterWithKvItems(
        "LogAttributes['a'] = '1' AND LogAttributes['b'] = '2' AND (LogAttributes['env'] = 'prod' OR LogAttributes['environment'] = 'prod')",
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('a=1', 'b=2'))",
      );
      expect(result).toContain(
        "hasAnyTokens(`LogAttributeItems`, array('env=prod', 'environment=prod'))",
      );
    });
  });

  describe('match() anchored alternations (round 2 §4)', () => {
    it('rewrites a fully anchored group alternation to hasAnyTokens', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(LogAttributes['endpoint'], '^(a|b|c)$')",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('endpoint=a', 'endpoint=b', 'endpoint=c'))",
      );
    });

    it('rewrites the non-capturing form ^(?:a|b)$', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(LogAttributes['endpoint'], '^(?:a|b)$')",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('endpoint=a', 'endpoint=b'))",
      );
    });

    it('rewrites the per-piece anchored form ^a$|^b$', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(LogAttributes['endpoint'], '^a$|^b$')",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('endpoint=a', 'endpoint=b'))",
      );
    });

    it('rewrites a single anchored literal to hasAllTokens', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(LogAttributes['endpoint'], '^checkout$')",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAllTokens(`LogAttributeItems`, array('endpoint=checkout'))",
      );
    });

    it('keeps an UNANCHORED alternation as match() — ClickHouse match is substring search', () => {
      const condition = "match(LogAttributes['endpoint'], 'a|b|c')";
      const result = rewriteSqlFilterWithKvItems(condition, defaultLookup);
      expect(result).not.toContain('hasAnyTokens');
      expect(result).not.toContain('hasAllTokens');
      expect(result).toContain('match(');
    });

    it('keeps true regexes (classes, wildcards, escapes) as match()', () => {
      for (const pattern of [
        '^(a.*|b)$',
        '^(a|b[0-9])$',
        '^(a\\\\.b|c)$',
        '^a$|b',
        '^(a|)$',
      ]) {
        const result = rewriteSqlFilterWithKvItems(
          `match(LogAttributes['endpoint'], '${pattern}')`,
          defaultLookup,
        );
        expect(result).not.toContain('hasAnyTokens');
        expect(result).not.toContain('hasAllTokens');
      }
    });

    it('keeps match() on maps without an items column', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(SpanAttributes['endpoint'], '^(a|b)$')",
        defaultLookup,
      );
      expect(result).not.toContain('hasAnyTokens');
      expect(result).toContain('match(');
    });

    it('joins an OR group as a disjunct alongside equalities', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(LogAttributes['endpoint'], '^(a|b)$') OR LogAttributes['env'] = 'prod'",
        defaultLookup,
      );
      expect(result).toBe(
        "hasAnyTokens(`LogAttributeItems`, array('endpoint=a', 'endpoint=b', 'env=prod'))",
      );
    });

    it('merges a single-literal anchored match() into the AND-spine collapse', () => {
      const result = rewriteSqlFilterWithKvItems(
        "match(LogAttributes['endpoint'], '^checkout$') AND LogAttributes['env'] = 'prod'",
        defaultLookup,
      );
      expect(result).toContain(
        "hasAllTokens(`LogAttributeItems`, array('endpoint=checkout', 'env=prod'))",
      );
    });

    it('does not rewrite NOT match()', () => {
      const condition = "NOT match(LogAttributes['endpoint'], '^(a|b)$')";
      const result = rewriteSqlFilterWithKvItems(condition, defaultLookup);
      expect(result).not.toContain('hasAnyTokens');
    });
  });
});
