import {
  filtersToQuery,
  isRenderablePinnedFilter,
  parseQuery,
  validateDashboardFilterQueries,
  validateSavedFilterValues,
  validateSavedQuery,
} from '@/filters';
import type { DashboardFilter, Filter } from '@/types';

describe('filters', () => {
  describe('filtersToQuery', () => {
    it('should return empty string when no filters', () => {
      const filters = {};
      expect(filtersToQuery(filters)).toEqual([]);
    });

    it('should return query for one filter', () => {
      const filters = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
      ]);
    });

    it('should return query for multiple filters', () => {
      const filters = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
        c: {
          included: new Set<string>(['d', 'x']),
          excluded: new Set<string>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
        { type: 'sql', condition: "c IN ('d', 'x')" },
      ]);
    });

    it('should handle excluded values', () => {
      const filters = {
        a: {
          included: new Set<string>(['b']),
          excluded: new Set<string>(['c']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
        { type: 'sql', condition: "a NOT IN ('c')" },
      ]);
    });

    it('should wrap keys with toString() when specified', () => {
      const filters = {
        'json.key': {
          included: new Set<string>(['value']),
          excluded: new Set<string>(['other value']),
        },
      };
      expect(filtersToQuery(filters, { stringifyKeys: true })).toEqual([
        { type: 'sql', condition: "toString(json.key) IN ('value')" },
        { type: 'sql', condition: "toString(json.key) NOT IN ('other value')" },
      ]);
    });

    it('should should handle boolean filter values', () => {
      const filters = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>([]),
        },
        another_column: {
          included: new Set<string | boolean>([]),
          excluded: new Set<string | boolean>([true, false]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: 'isRootSpan IN (true)' },
        { type: 'sql', condition: 'another_column NOT IN (true, false)' },
      ]);
    });

    it('should escape single quotes in filter values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(["my 'filter' key"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "message IN ('my ''filter'' key')",
        },
      ]);
    });

    it('should escape single quotes in excluded filter values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(["it's a test"]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "message NOT IN ('it''s a test')",
        },
      ]);
    });

    it('should escape single quotes with stringifyKeys', () => {
      const filters = {
        'json.key': {
          included: new Set<string | boolean>(["value with 'quotes'"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters, { stringifyKeys: true })).toEqual([
        {
          type: 'sql',
          condition: "toString(json.key) IN ('value with ''quotes''')",
        },
      ]);
    });

    it('should escape backslashes in filter values', () => {
      const filters = {
        FilePath: {
          included: new Set<string | boolean>(['C:\\path\\to\\file']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "FilePath IN ('C:\\\\path\\\\to\\\\file')",
        },
      ]);
    });

    it('should escape backslashes in excluded filter values', () => {
      const filters = {
        FilePath: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['C:\\path\\to\\file']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "FilePath NOT IN ('C:\\\\path\\\\to\\\\file')",
        },
      ]);
    });

    it('should escape backslashes before single quotes so quotes stay escaped', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(["a\\'b"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "message IN ('a\\\\''b')",
        },
      ]);
    });

    describe('dateTimeColumns', () => {
      const dateTimeColumns = new Map<string, string>([
        ['Timestamp', 'DateTime64(9)'],
        ['TimestampTime', 'DateTime'],
      ]);

      it('wraps an excluded DateTime64 value in parseDateTime64BestEffort', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>(),
            excluded: new Set<string | boolean>([
              '2026-06-16T15:35:16.731000000Z',
            ]),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          {
            type: 'sql',
            condition:
              "Timestamp NOT IN (parseDateTime64BestEffort('2026-06-16T15:35:16.731000000Z', 9))",
          },
        ]);
      });

      it('wraps an included DateTime64 value in parseDateTime64BestEffort', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>([
              '2026-06-16T15:35:16.731000000Z',
            ]),
            excluded: new Set<string | boolean>(),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          {
            type: 'sql',
            condition:
              "Timestamp IN (parseDateTime64BestEffort('2026-06-16T15:35:16.731000000Z', 9))",
          },
        ]);
      });

      it('wraps a plain DateTime column with parseDateTimeBestEffort (IN does not promote DateTime↔DateTime64)', () => {
        const filters = {
          TimestampTime: {
            included: new Set<string | boolean>(['2026-06-17T11:56:41Z']),
            excluded: new Set<string | boolean>(),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          {
            type: 'sql',
            condition:
              "TimestampTime IN (parseDateTimeBestEffort('2026-06-17T11:56:41Z'))",
          },
        ]);
      });

      it('matches the precision of a non-9 DateTime64 column', () => {
        const filters = {
          ts3: {
            included: new Set<string | boolean>(['2026-06-17T11:56:41.123Z']),
            excluded: new Set<string | boolean>(),
          },
        };
        expect(
          filtersToQuery(filters, {
            dateTimeColumns: new Map([['ts3', "DateTime64(3, 'UTC')"]]),
          }),
        ).toEqual([
          {
            type: 'sql',
            condition:
              "ts3 IN (parseDateTime64BestEffort('2026-06-17T11:56:41.123Z', 3))",
          },
        ]);
      });

      it('wraps a Date column with toDate', () => {
        const filters = {
          day: {
            included: new Set<string | boolean>(['2026-06-17']),
            excluded: new Set<string | boolean>(),
          },
        };
        expect(
          filtersToQuery(filters, {
            dateTimeColumns: new Map([['day', 'Date']]),
          }),
        ).toEqual([
          { type: 'sql', condition: "day IN (toDate('2026-06-17'))" },
        ]);
      });

      it('wraps multiple DateTime64 values', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>(),
            excluded: new Set<string | boolean>(['2026-06-16', '2026-06-17']),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          {
            type: 'sql',
            condition:
              "Timestamp NOT IN (parseDateTime64BestEffort('2026-06-16', 9), parseDateTime64BestEffort('2026-06-17', 9))",
          },
        ]);
      });

      it('wraps both included and excluded values for the same DateTime key', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>(['2026-06-16']),
            excluded: new Set<string | boolean>(['2026-06-17']),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          {
            type: 'sql',
            condition:
              "Timestamp IN (parseDateTime64BestEffort('2026-06-16', 9))",
          },
          {
            type: 'sql',
            condition:
              "Timestamp NOT IN (parseDateTime64BestEffort('2026-06-17', 9))",
          },
        ]);
      });

      it('does not wrap when stringifyKeys is set (string comparison)', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>(),
            excluded: new Set<string | boolean>(['2026-06-16']),
          },
        };
        expect(
          filtersToQuery(filters, { dateTimeColumns, stringifyKeys: true }),
        ).toEqual([
          {
            type: 'sql',
            condition: "toString(Timestamp) NOT IN ('2026-06-16')",
          },
        ]);
      });

      it('does not wrap non-DateTime keys', () => {
        const filters = {
          ServiceName: {
            included: new Set<string | boolean>(['api']),
            excluded: new Set<string | boolean>(),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          { type: 'sql', condition: "ServiceName IN ('api')" },
        ]);
      });

      it('does not wrap boolean values on a DateTime key', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>([true]),
            excluded: new Set<string | boolean>(),
          },
        };
        expect(filtersToQuery(filters, { dateTimeColumns })).toEqual([
          { type: 'sql', condition: 'Timestamp IN (true)' },
        ]);
      });

      it('leaves output unchanged when no dateTimeColumns are provided', () => {
        const filters = {
          Timestamp: {
            included: new Set<string | boolean>(),
            excluded: new Set<string | boolean>(['2026-06-16']),
          },
        };
        expect(filtersToQuery(filters)).toEqual([
          { type: 'sql', condition: "Timestamp NOT IN ('2026-06-16')" },
        ]);
      });
    });
  });

  describe('validateSavedFilterValues', () => {
    it('returns no issues for an empty array', () => {
      expect(validateSavedFilterValues([])).toEqual([]);
    });

    it('accepts a valid single-value lucene condition', () => {
      const filters: Filter[] = [
        { type: 'lucene', condition: 'ServiceName:"hdx-oss-dev-api"' },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('accepts a valid multi-value (OR) lucene condition', () => {
      const filters: Filter[] = [
        {
          type: 'lucene',
          condition:
            '(ServiceName:"hdx-oss-dev-api" OR ServiceName:"hdx-oss-dev-app")',
        },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('accepts lucene conditions over map / bracket-notation keys', () => {
      const filters: Filter[] = [
        {
          type: 'lucene',
          condition: 'ResourceAttributes.k8s\\.pod\\.name:"checkout-0"',
        },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('accepts a valid sql condition', () => {
      const filters: Filter[] = [
        { type: 'sql', condition: "ServiceName = 'hdx-oss-dev-api'" },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('accepts a valid sql condition over a map access column', () => {
      const filters: Filter[] = [
        {
          type: 'sql',
          condition: "ResourceAttributes['service.name'] = 'checkout'",
        },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('flags a malformed lucene condition', () => {
      const filters: Filter[] = [
        { type: 'lucene', condition: 'ServiceName:((("broken' },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([
        {
          index: 0,
          language: 'lucene',
          condition: 'ServiceName:((("broken',
        },
      ]);
    });

    it('flags a malformed sql condition', () => {
      const filters: Filter[] = [
        { type: 'sql', condition: 'ServiceName = = ' },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([
        { index: 0, language: 'sql', condition: 'ServiceName = = ' },
      ]);
    });

    it('treats empty / whitespace-only conditions as valid (no-ops)', () => {
      const filters: Filter[] = [
        { type: 'lucene', condition: '' },
        { type: 'sql', condition: '   ' },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('treats structurally-valid sql_ast filters as valid', () => {
      const filters: Filter[] = [
        { type: 'sql_ast', operator: '=', left: 'ServiceName', right: 'api' },
      ];
      expect(validateSavedFilterValues(filters)).toEqual([]);
    });

    it('reports the correct index for each invalid value in a mixed list', () => {
      const filters: Filter[] = [
        { type: 'lucene', condition: 'ServiceName:"good"' },
        { type: 'lucene', condition: 'Bad:((("' },
        { type: 'sql', condition: "Level = 'error'" },
        { type: 'sql', condition: 'broken = = =' },
      ];
      const issues = validateSavedFilterValues(filters);
      expect(issues).toEqual([
        { index: 1, language: 'lucene', condition: 'Bad:((("' },
        { index: 3, language: 'sql', condition: 'broken = = =' },
      ]);
    });
  });

  describe('validateSavedQuery', () => {
    it('returns null for an empty / nullish query', () => {
      expect(validateSavedQuery('', 'lucene')).toBeNull();
      expect(validateSavedQuery('   ', 'sql')).toBeNull();
      expect(validateSavedQuery(null, 'lucene')).toBeNull();
      expect(validateSavedQuery(undefined, 'sql')).toBeNull();
    });

    it('accepts a valid lucene query', () => {
      expect(validateSavedQuery('ServiceName:"api"', 'lucene')).toBeNull();
    });

    it('accepts a valid sql query', () => {
      expect(validateSavedQuery("ServiceName = 'api'", 'sql')).toBeNull();
    });

    it('defaults a missing language to lucene', () => {
      expect(validateSavedQuery('ServiceName:"api"', null)).toBeNull();
      expect(validateSavedQuery('ServiceName:"api"', undefined)).toBeNull();
      expect(validateSavedQuery('Bad:((("', undefined)).toEqual({
        language: 'lucene',
        query: 'Bad:((("',
      });
    });

    it('treats promql as valid (not statically validated)', () => {
      expect(validateSavedQuery('rate(foo[5m]', 'promql')).toBeNull();
    });

    it('flags a malformed lucene query', () => {
      expect(validateSavedQuery('ServiceName:((("broken', 'lucene')).toEqual({
        language: 'lucene',
        query: 'ServiceName:((("broken',
      });
    });

    it('flags a malformed sql query', () => {
      expect(validateSavedQuery('ServiceName = = ', 'sql')).toEqual({
        language: 'sql',
        query: 'ServiceName = = ',
      });
    });
  });

  describe('validateDashboardFilterQueries', () => {
    const filter = (overrides: Partial<DashboardFilter>): DashboardFilter => ({
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'ServiceName',
      expression: 'ServiceName',
      source: 'logs',
      ...overrides,
    });

    it('returns no issues for an empty array', () => {
      expect(validateDashboardFilterQueries([])).toEqual([]);
    });

    it('treats a filter with no where clause as valid', () => {
      expect(
        validateDashboardFilterQueries([filter({ whereLanguage: 'lucene' })]),
      ).toEqual([]);
    });

    it('treats a whitespace-only where clause as valid', () => {
      expect(
        validateDashboardFilterQueries([
          filter({ where: '   ', whereLanguage: 'lucene' }),
        ]),
      ).toEqual([]);
    });

    it('accepts a valid lucene where clause', () => {
      expect(
        validateDashboardFilterQueries([
          filter({ where: 'ServiceName:*', whereLanguage: 'lucene' }),
        ]),
      ).toEqual([]);
    });

    it('accepts a valid sql where clause', () => {
      expect(
        validateDashboardFilterQueries([
          filter({ where: "ServiceName != ''", whereLanguage: 'sql' }),
        ]),
      ).toEqual([]);
    });

    it('flags a malformed lucene where clause', () => {
      expect(
        validateDashboardFilterQueries([
          filter({
            id: 'svc',
            name: 'Service',
            where: 'ServiceName:((("',
            whereLanguage: 'lucene',
          }),
        ]),
      ).toEqual([
        {
          filterId: 'svc',
          filterName: 'Service',
          language: 'lucene',
          where: 'ServiceName:((("',
        },
      ]);
    });

    it('flags a malformed sql where clause', () => {
      expect(
        validateDashboardFilterQueries([
          filter({
            id: 'svc',
            name: 'Service',
            where: 'ServiceName = =',
            whereLanguage: 'sql',
          }),
        ]),
      ).toEqual([
        {
          filterId: 'svc',
          filterName: 'Service',
          language: 'sql',
          where: 'ServiceName = =',
        },
      ]);
    });

    it('only reports the invalid filters in a mixed list', () => {
      const issues = validateDashboardFilterQueries([
        filter({ id: 'a', where: 'ServiceName:*', whereLanguage: 'lucene' }),
        filter({
          id: 'b',
          name: 'Bad',
          where: 'Bad:((("',
          whereLanguage: 'lucene',
        }),
        filter({ id: 'c', where: "Level = 'error'", whereLanguage: 'sql' }),
      ]);
      expect(issues).toEqual([
        {
          filterId: 'b',
          filterName: 'Bad',
          language: 'lucene',
          where: 'Bad:((("',
        },
      ]);
    });
  });

  describe('parseQuery BETWEEN bounds', () => {
    it('parses a numeric BETWEEN into a range', () => {
      expect(
        parseQuery([
          { type: 'sql', condition: 'Duration BETWEEN 100 AND 5000' },
        ]).filters,
      ).toEqual({
        Duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 100, max: 5000 },
        },
      });
    });

    it('drops a BETWEEN with quoted / non-numeric bounds instead of emitting NaN', () => {
      expect(
        parseQuery([
          {
            type: 'sql',
            condition: "ts BETWEEN '2024-01-01' AND '2024-02-01'",
          },
        ]).filters,
      ).toEqual({});
    });

    it('drops a compound BETWEEN whose trailing clause the regex would swallow', () => {
      // The greedy regex would capture `2 AND other IN ('x')` as the upper
      // bound; `Number` rejects it as non-numeric so nothing is emitted.
      expect(
        parseQuery([
          {
            type: 'sql',
            condition: "col BETWEEN 1 AND 2 AND other IN ('x')",
          },
        ]).filters,
      ).toEqual({});
    });
  });

  describe('isRenderablePinnedFilter', () => {
    const sql = (condition: string): Filter => ({ type: 'sql', condition });

    it.each([
      ["ServiceName IN ('checkout', 'payments')", 'IN'],
      ["SeverityText NOT IN ('debug', 'trace')", 'NOT IN'],
      ['Duration BETWEEN 100 AND 5000', 'BETWEEN (numeric)'],
      ["LogAttributes['x'] IN ('y')", 'map-access column'],
      ["Body IN ('a AND b')", 'value containing AND'],
    ])('accepts a single renderable predicate: %s (%s)', condition => {
      expect(isRenderablePinnedFilter(sql(condition))).toBe(true);
    });

    it.each([
      ["ServiceName = 'checkout'", 'plain equality (never renders)'],
      [
        "ServiceName IN ('x') AND foo = 1",
        'IN + dropped conjunct (divergence)',
      ],
      ["A IN ('x') AND B IN ('y')", 'compound over two columns'],
      ["ts BETWEEN '2024-01-01' AND '2024-02-01'", 'non-numeric BETWEEN'],
      ["col BETWEEN 1 AND 2 AND other IN ('x')", 'BETWEEN swallowing a clause'],
      [
        'ServiceName NOT BETWEEN 1 AND 2',
        'NOT folded into the key (renders inverted)',
      ],
      ["NOT (ServiceName IN ('x'))", 'leading NOT folded into the key'],
      ['', 'empty condition'],
    ])('rejects %s (%s)', condition => {
      expect(isRenderablePinnedFilter(sql(condition))).toBe(false);
    });

    it('rejects non-sql filter shapes (lucene, sql_ast)', () => {
      expect(
        isRenderablePinnedFilter({ type: 'lucene', condition: 'app:*' }),
      ).toBe(false);
      expect(
        isRenderablePinnedFilter({
          type: 'sql_ast',
          operator: '=',
          left: 'ServiceName',
          right: "'x'",
        }),
      ).toBe(false);
    });

    it('accepts exactly what filtersToQuery emits (round-trip)', () => {
      // Every clause filtersToQuery produces must be individually renderable,
      // guaranteeing the API accepts anything the UI itself would persist.
      const emitted = filtersToQuery({
        ServiceName: {
          included: new Set(['checkout']),
          excluded: new Set(['debug']),
        },
        Duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 1, max: 2 },
        },
      });
      expect(emitted.length).toBeGreaterThan(0);
      for (const f of emitted) {
        expect(isRenderablePinnedFilter(f)).toBe(true);
      }
    });
  });
});
