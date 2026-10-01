import {
  deriveVariableName,
  doesFilterApplyToSource,
  FilterState,
  filterStateToPredicate,
  filtersToQuery,
  getDashboardVariableDeclarations,
  getDashboardVariableFilters,
  getFilterBroadcastTarget,
  getFilterExpression,
  getFilterVariableName,
  getPendingFilterValuesVariables,
  hasFilterEffect,
  isFilterBroadcastEnabled,
  isFilterGlobalRequirement,
  isFilterRequired,
  isFilterVariableEnabled,
  isQueryExpressionFilter,
  isRenderablePinnedFilter,
  parseQuery,
  resolveFilterValuesWhere,
  resolvePromqlLabelFilterMatch,
  serializeFilterState,
  validateDashboardFilterQueries,
  validateSavedFilterValues,
  validateSavedQuery,
  validateVariableName,
} from '@/filters';
import type {
  ChartVariable,
  DashboardFilter,
  Filter,
  QueryExpressionDashboardFilter,
  StaticListDashboardFilter,
} from '@/types';
import {
  DASHBOARD_VARIABLE_NAME_MAX_LENGTH,
  DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED,
} from '@/types';

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

  describe('filterStateToPredicate', () => {
    const identity = (k: string) => k;

    it('returns undefined when nothing is selected', () => {
      expect(filterStateToPredicate({}, identity)).toBeUndefined();
      expect(
        filterStateToPredicate(
          { colA: { included: new Set(), excluded: new Set() } },
          identity,
        ),
      ).toBeUndefined();
    });

    it('wraps a single condition in parentheses', () => {
      expect(
        filterStateToPredicate(
          { colA: { included: new Set(['x']), excluded: new Set() } },
          identity,
        ),
      ).toBe("(colA IN ('x'))");
    });

    it('AND-joins conditions across keys and across include/exclude', () => {
      const predicate = filterStateToPredicate(
        {
          colA: { included: new Set(['x']), excluded: new Set(['y']) },
          colB: { included: new Set(['z']), excluded: new Set() },
        },
        identity,
      );
      expect(predicate).toBe(
        "(colA IN ('x')) AND (colA NOT IN ('y')) AND (colB IN ('z'))",
      );
    });

    it('addresses each key through renderKey', () => {
      // The whole point of the callback: a JSON column is aggregated as a
      // typed subcolumn, so the predicate has to name it the same way.
      expect(
        filterStateToPredicate(
          {
            "Attributes['cluster']": {
              included: new Set(['prod']),
              excluded: new Set(),
            },
          },
          () => '`Attributes`.`cluster`.:String',
        ),
      ).toBe("(`Attributes`.`cluster`.:String IN ('prod'))");
    });
  });

  describe('serializeFilterState', () => {
    it('distinguishes different selections', () => {
      const a: FilterState = {
        colA: { included: new Set(['x']), excluded: new Set() },
      };
      const b: FilterState = {
        colA: { included: new Set(['y']), excluded: new Set() },
      };
      expect(serializeFilterState(a)).not.toBe(serializeFilterState(b));
      // JSON.stringify alone would flatten both Sets to {} and collide, which
      // is exactly what this helper exists to prevent in react-query keys.
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('distinguishes an included value from an excluded one', () => {
      expect(
        serializeFilterState({
          colA: { included: new Set(['x']), excluded: new Set() },
        }),
      ).not.toBe(
        serializeFilterState({
          colA: { included: new Set(), excluded: new Set(['x']) },
        }),
      );
    });

    it('is stable across key and member insertion order', () => {
      expect(
        serializeFilterState({
          colA: { included: new Set(['x', 'y']), excluded: new Set() },
          colB: { included: new Set(['z']), excluded: new Set() },
        }),
      ).toBe(
        serializeFilterState({
          colB: { included: new Set(['z']), excluded: new Set() },
          colA: { included: new Set(['y', 'x']), excluded: new Set() },
        }),
      );
    });

    it('includes the range bound', () => {
      expect(
        serializeFilterState({
          colA: {
            included: new Set(),
            excluded: new Set(),
            range: { min: 1, max: 2 },
          },
        }),
      ).not.toBe(
        serializeFilterState({
          colA: {
            included: new Set(),
            excluded: new Set(),
            range: { min: 1, max: 3 },
          },
        }),
      );
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

    it('ignores variable-keyed values, which carry no condition to validate', () => {
      expect(
        validateSavedFilterValues([
          { type: 'variable', name: 'svc', values: ['a', 'b'] },
        ]),
      ).toEqual([]);
    });

    it('still reports the index of an invalid value after a variable one', () => {
      expect(
        validateSavedFilterValues([
          { type: 'variable', name: 'svc', values: ['a'] },
          { type: 'sql', condition: 'broken = = =' },
        ]),
      ).toEqual([{ index: 1, language: 'sql', condition: 'broken = = =' }]);
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
    const filter = (
      overrides: Partial<QueryExpressionDashboardFilter>,
    ): QueryExpressionDashboardFilter => ({
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

    it('skips a static-list filter, which has no values query', () => {
      expect(
        validateDashboardFilterQueries([
          {
            id: 'f1',
            type: 'STATIC_LIST',
            name: 'Environment',
            options: ['prod', 'staging', 'dev'],
            isBroadcastEnabled: false,
            isVariableEnabled: true,
            variableName: 'env',
          },
        ]),
      ).toEqual([]);
    });

    it('skips a promql-label filter, which has no ClickHouse values query', () => {
      expect(
        validateDashboardFilterQueries([
          {
            id: 'f1',
            type: 'PROMETHEUS_LABEL',
            name: 'Pod',
            source: 'promql',
            label: 'pod',
            isBroadcastEnabled: false,
            isVariableEnabled: true,
            variableName: 'pod',
          },
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

    describe('variable references', () => {
      /** A variable-enabled `Service` filter, exposed as `$svc`. */
      const svcVariableFilter = filter({
        id: 'svc',
        name: 'Service',
        isVariableEnabled: true,
        variableName: 'svc',
      });

      it.each([
        ['a macro on an explicit expression', '$__filter(ServiceName, $svc)'],
        ['a macro on the variable expression', '$__filter($svc)'],
        [
          'a conditionalAll macro',
          "$__conditionalAll(ServiceName = 'x', $svc)",
        ],
        ['a braced reference', 'ServiceName IN (${svc})'],
        ['a bare reference', 'ServiceName IN ($svc)'],
      ])('accepts a sql where clause using %s', (_label, where) => {
        expect(
          validateDashboardFilterQueries([
            svcVariableFilter,
            filter({
              id: 'sev',
              name: 'Severity',
              where,
              whereLanguage: 'sql',
            }),
          ]),
        ).toEqual([]);
      });

      it('accepts a lucene where clause referencing a variable', () => {
        expect(
          validateDashboardFilterQueries([
            svcVariableFilter,
            filter({
              id: 'sev',
              name: 'Severity',
              where: 'ServiceName:$svc',
              whereLanguage: 'lucene',
            }),
          ]),
        ).toEqual([]);
      });

      it('flags a macro naming a variable the dashboard does not declare', () => {
        const issues = validateDashboardFilterQueries([
          svcVariableFilter,
          filter({
            id: 'sev',
            name: 'Severity',
            where: '$__filter(ServiceName, $nope)',
            whereLanguage: 'sql',
          }),
        ]);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
          filterId: 'sev',
          filterName: 'Severity',
          language: 'sql',
          // The raw template is reported, not its expansion.
          where: '$__filter(ServiceName, $nope)',
        });
        expect(issues[0].detail).toMatch(/unknown variable 'nope'/);
      });

      it('flags a macro when no filter is variable-enabled', () => {
        const issues = validateDashboardFilterQueries([
          filter({
            id: 'sev',
            name: 'Severity',
            where: '$__filter(ServiceName, $svc)',
            whereLanguage: 'sql',
          }),
        ]);
        expect(issues).toHaveLength(1);
        expect(issues[0].detail).toMatch(/unknown variable 'svc'/);
      });

      it('still flags a clause that is malformed after expansion', () => {
        const issues = validateDashboardFilterQueries([
          svcVariableFilter,
          filter({
            id: 'sev',
            name: 'Severity',
            where: 'ServiceName IN (${svc}',
            whereLanguage: 'sql',
          }),
        ]);
        expect(issues).toEqual([
          {
            filterId: 'sev',
            filterName: 'Severity',
            language: 'sql',
            where: 'ServiceName IN (${svc}',
          },
        ]);
      });
    });
  });

  describe('resolveFilterValuesWhere', () => {
    const svc = (values: string[]): ChartVariable => ({
      name: 'svc',
      expression: 'ServiceName',
      values,
    });

    it('returns the template as written when there is no variable context', () => {
      expect(
        resolveFilterValuesWhere(
          { where: 'ServiceName IN ($svc)', whereLanguage: 'sql' },
          undefined,
        ),
      ).toEqual({ where: 'ServiceName IN ($svc)', whereLanguage: 'sql' });
    });

    it('defaults the language to sql', () => {
      expect(resolveFilterValuesWhere({ where: '' }, [svc([])])).toEqual({
        where: '',
        whereLanguage: 'sql',
      });
    });

    it('expands a macro against the selected values', () => {
      expect(
        resolveFilterValuesWhere(
          { where: '$__filter(ServiceName, $svc)', whereLanguage: 'sql' },
          [svc(['accounting'])],
        ),
      ).toEqual({
        where: "(ServiceName IN ('accounting'))",
        whereLanguage: 'sql',
      });
    });

    it('expands a macro to a no-op when nothing is selected', () => {
      const { where } = resolveFilterValuesWhere(
        { where: '$__filter(ServiceName, $svc)', whereLanguage: 'sql' },
        [svc([])],
      );
      expect(where).toContain('1=1');
    });

    it('expands the one-argument macro form using the declared expression', () => {
      expect(
        resolveFilterValuesWhere({ where: '$__filter($svc)' }, [
          svc(['accounting']),
        ]).where,
      ).toBe("(toString(ServiceName) IN ('accounting'))");
    });

    it('expands a bare sql reference, including its empty state', () => {
      expect(
        resolveFilterValuesWhere({ where: 'ServiceName IN ($svc)' }, [
          svc(['accounting', 'ad']),
        ]).where,
      ).toBe("ServiceName IN ('accounting', 'ad')");
      expect(
        resolveFilterValuesWhere({ where: 'ServiceName IN ($svc)' }, [svc([])])
          .where,
      ).toBe('ServiceName IN (NULL)');
    });

    it('expands a lucene reference in the lucene format', () => {
      expect(
        resolveFilterValuesWhere(
          { where: 'ServiceName:$svc', whereLanguage: 'lucene' },
          [svc(['accounting'])],
        ).where,
      ).toBe('ServiceName:("accounting")');
      expect(
        resolveFilterValuesWhere(
          { where: 'ServiceName:$svc', whereLanguage: 'lucene' },
          [svc([])],
        ).where,
      ).toBe('ServiceName:("")');
    });

    it('leaves a macro as written in a lucene clause', () => {
      expect(
        resolveFilterValuesWhere(
          { where: '$__filter(ServiceName, $svc)', whereLanguage: 'lucene' },
          [svc(['accounting'])],
        ).where,
      ).toBe('$__filter(ServiceName, $svc)');
    });

    it("narrows by a filter's own variable when it references itself", () => {
      // Honored literally: a self-referencing dropdown query collapses to the
      // filter's own selection, which is what the author asked for.
      expect(
        resolveFilterValuesWhere(
          { where: '$__filter(ServiceName, $svc)', whereLanguage: 'sql' },
          [svc(['accounting'])],
        ).where,
      ).toBe("(ServiceName IN ('accounting'))");
    });

    it('reports a macro naming an unknown variable without throwing', () => {
      const resolved = resolveFilterValuesWhere(
        { where: '$__filter(ServiceName, $nope)', whereLanguage: 'sql' },
        [svc(['accounting'])],
      );
      expect(resolved.where).toBe('$__filter(ServiceName, $nope)');
      expect(resolved.error).toMatch(/unknown variable 'nope'/);
    });

    it('reports an unrecognized format without throwing', () => {
      const resolved = resolveFilterValuesWhere(
        { where: 'ServiceName IN (${svc:bogus})', whereLanguage: 'sql' },
        [svc(['accounting'])],
      );
      expect(resolved.where).toBe('ServiceName IN (${svc:bogus})');
      expect(resolved.error).toMatch(/Unknown variable format 'bogus'/);
    });

    it('leaves an undeclared bare reference alone', () => {
      const resolved = resolveFilterValuesWhere(
        { where: "Body = '$notAVariable'", whereLanguage: 'sql' },
        [svc(['accounting'])],
      );
      expect(resolved.where).toBe("Body = '$notAVariable'");
      expect(resolved.error).toBeUndefined();
    });
  });

  describe('resolvePromqlLabelFilterMatch', () => {
    const svc = (values: string[]): ChartVariable => ({
      name: 'svc',
      expression: 'ServiceName',
      values,
    });

    it('reports no selector when there is none to send', () => {
      expect(resolvePromqlLabelFilterMatch({}, [svc(['api'])])).toEqual({});
      expect(
        resolvePromqlLabelFilterMatch({ match: '   ' }, [svc(['api'])]),
      ).toEqual({});
    });

    it('trims the selector', () => {
      expect(
        resolvePromqlLabelFilterMatch({ match: '  up{job="api"} ' }, undefined)
          .match,
      ).toBe('up{job="api"}');
    });

    it('returns the template as written when there is no variable context', () => {
      expect(
        resolvePromqlLabelFilterMatch({ match: 'up{job=~"$svc"}' }, undefined),
      ).toEqual({ match: 'up{job=~"$svc"}' });
    });

    it('expands a reference as a regex alternation', () => {
      expect(
        resolvePromqlLabelFilterMatch({ match: 'up{job=~"$svc"}' }, [
          svc(['api', 'ad']),
        ]).match,
      ).toBe('up{job=~"(api|ad)"}');
    });

    it('expands an empty selection to match everything', () => {
      expect(
        resolvePromqlLabelFilterMatch({ match: 'up{job=~"$svc"}' }, [svc([])])
          .match,
      ).toBe('up{job=~".*"}');
    });

    it('expands the csv format for a name rather than a matcher value', () => {
      expect(
        resolvePromqlLabelFilterMatch({ match: '${svc:csv}{code="200"}' }, [
          svc(['up']),
        ]).match,
      ).toBe('up{code="200"}');
    });

    it('reports an unrecognized format without throwing', () => {
      const resolved = resolvePromqlLabelFilterMatch(
        { match: 'up{job=~"${svc:bogus}"}' },
        [svc(['api'])],
      );
      expect(resolved.match).toBe('up{job=~"${svc:bogus}"}');
      expect(resolved.error).toMatch(/Unknown variable format 'bogus'/);
    });

    it('leaves an undeclared bare reference alone', () => {
      const resolved = resolvePromqlLabelFilterMatch(
        { match: 'up{job=~"$nope"}' },
        [svc(['api'])],
      );
      expect(resolved.match).toBe('up{job=~"$nope"}');
      expect(resolved.error).toBeUndefined();
    });
  });

  describe('getPendingFilterValuesVariables', () => {
    const svc = (values: string[]): ChartVariable => ({
      name: 'svc',
      expression: 'ServiceName',
      values,
    });

    it('reports a bare sql reference to an unselected variable', () => {
      expect(
        getPendingFilterValuesVariables({ where: 'ServiceName IN ($svc)' }, [
          svc([]),
        ]),
      ).toEqual(['svc']);
    });

    it('reports a braced reference once, however often it appears', () => {
      expect(
        getPendingFilterValuesVariables(
          { where: 'ServiceName IN (${svc}) OR Other IN ($svc)' },
          [svc([])],
        ),
      ).toEqual(['svc']);
    });

    it('reports a csv reference, which renders as nothing when empty', () => {
      expect(
        getPendingFilterValuesVariables(
          { where: 'ServiceName IN (${svc:csv})' },
          [svc([])],
        ),
      ).toEqual(['svc']);
    });

    it('reports nothing once the variable has a selection', () => {
      expect(
        getPendingFilterValuesVariables({ where: 'ServiceName IN ($svc)' }, [
          svc(['accounting']),
        ]),
      ).toEqual([]);
    });

    it.each([
      ['a macro', '$__filter(ServiceName, $svc)', 'sql'],
      [
        'a conditionalAll macro',
        "$__conditionalAll(ServiceName = 'x', $svc)",
        'sql',
      ],
      [
        'a reference guarded by its own macro',
        '$__filter(ServiceName IN ($svc), $svc)',
        'sql',
      ],
      [
        'a regex-formatted reference',
        'match(ServiceName, ${svc:regex})',
        'sql',
      ],
    ] as const)('reports nothing for %s', (_label, where, whereLanguage) => {
      expect(
        getPendingFilterValuesVariables({ where, whereLanguage }, [svc([])]),
      ).toEqual([]);
    });

    it('reports nothing for a lucene clause, whose empty term is a no-op', () => {
      expect(
        getPendingFilterValuesVariables(
          { where: 'ServiceName:$svc', whereLanguage: 'lucene' },
          [svc([])],
        ),
      ).toEqual([]);
    });

    it('ignores references that name no declared variable', () => {
      expect(
        getPendingFilterValuesVariables({ where: 'ServiceName IN ($nope)' }, [
          svc([]),
        ]),
      ).toEqual([]);
    });

    it('reports nothing without a variable context or a where clause', () => {
      expect(
        getPendingFilterValuesVariables(
          { where: 'ServiceName IN ($svc)' },
          undefined,
        ),
      ).toEqual([]);
      expect(
        getPendingFilterValuesVariables({ where: '  ' }, [svc([])]),
      ).toEqual([]);
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

  // Dashboard filters can be defined by an arbitrary expression, not just a
  // bare column. The parser must treat the whole expression as the key and
  // ignore operators/keywords nested inside its parentheses, rather than
  // dropping the clause or splitting on a nested operator. These cases exercise
  // the parenthesis-depth awareness of parseQuery (and, transitively,
  // countTopLevelAnd via isRenderablePinnedFilter).
  describe('complex expression keys (nested parentheses)', () => {
    const ifOrExpr = `if(SeverityText = 'error' or SeverityText = 'fatal', 'Errors', 'Non-errors')`;
    const ifInExpr = `if(SeverityText IN ('error', 'fatal'), 'Errors', 'Non-errors')`;
    const ifBetweenExpr = `if(Duration BETWEEN 1 AND 2, 'fast', 'slow')`;

    describe('parseQuery', () => {
      it('keeps the whole expression as the key when it nests OR and = inside parens', () => {
        expect(
          parseQuery([{ type: 'sql', condition: `${ifOrExpr} IN ('Errors')` }])
            .filters,
        ).toEqual({
          [ifOrExpr]: { included: new Set(['Errors']), excluded: new Set() },
        });
      });

      it('splits on the outer IN, not the IN nested inside the expression', () => {
        expect(
          parseQuery([{ type: 'sql', condition: `${ifInExpr} IN ('Errors')` }])
            .filters,
        ).toEqual({
          [ifInExpr]: { included: new Set(['Errors']), excluded: new Set() },
        });
      });

      it('parses multiple selected values on an expression key', () => {
        expect(
          parseQuery([
            {
              type: 'sql',
              condition: `${ifOrExpr} IN ('Errors', 'Non-errors')`,
            },
          ]).filters,
        ).toEqual({
          [ifOrExpr]: {
            included: new Set(['Errors', 'Non-errors']),
            excluded: new Set(),
          },
        });
      });

      it('parses NOT IN on an expression key without splitting on nested IN', () => {
        expect(
          parseQuery([
            { type: 'sql', condition: `${ifInExpr} NOT IN ('Errors')` },
          ]).filters,
        ).toEqual({
          [ifInExpr]: { included: new Set(), excluded: new Set(['Errors']) },
        });
      });

      it('merges included and excluded selections on the same expression key', () => {
        expect(
          parseQuery([
            { type: 'sql', condition: `${ifOrExpr} IN ('Errors')` },
            { type: 'sql', condition: `${ifOrExpr} NOT IN ('Non-errors')` },
          ]).filters,
        ).toEqual({
          [ifOrExpr]: {
            included: new Set(['Errors']),
            excluded: new Set(['Non-errors']),
          },
        });
      });

      it('extracts an expression clause from an AND-joined compound condition', () => {
        expect(
          parseQuery([
            {
              type: 'sql',
              condition: `ServiceName IN ('api') AND ${ifOrExpr} IN ('Errors')`,
            },
          ]).filters,
        ).toEqual({
          ServiceName: { included: new Set(['api']), excluded: new Set() },
          [ifOrExpr]: { included: new Set(['Errors']), excluded: new Set() },
        });
      });

      it('does not split on AND nested inside an expression key', () => {
        expect(
          parseQuery([
            { type: 'sql', condition: `${ifBetweenExpr} IN ('fast')` },
          ]).filters,
        ).toEqual({
          [ifBetweenExpr]: { included: new Set(['fast']), excluded: new Set() },
        });
      });

      it('does not treat a BETWEEN nested inside an expression key as a range', () => {
        // toEqual asserts the exact shape: an unexpected `range` key would fail
        // this, so it doubles as the "no range was extracted" check.
        expect(
          parseQuery([
            { type: 'sql', condition: `${ifBetweenExpr} NOT IN ('slow')` },
          ]).filters,
        ).toEqual({
          [ifBetweenExpr]: { included: new Set(), excluded: new Set(['slow']) },
        });
      });

      it('handles a nested function expression key', () => {
        const key = `toString(multiIf(Status >= 500, 'error', Status >= 400, 'warn', 'ok'))`;
        expect(
          parseQuery([
            { type: 'sql', condition: `${key} IN ('error', 'warn')` },
          ]).filters,
        ).toEqual({
          [key]: { included: new Set(['error', 'warn']), excluded: new Set() },
        });
      });

      it('round-trips an expression key through filtersToQuery', () => {
        const originalFilters: FilterState = {
          [ifOrExpr]: {
            included: new Set(['Errors']),
            excluded: new Set(['Non-errors']),
          },
        };
        expect(parseQuery(filtersToQuery(originalFilters)).filters).toEqual(
          originalFilters,
        );
      });
    });

    describe('isRenderablePinnedFilter', () => {
      const sql = (condition: string): Filter => ({ type: 'sql', condition });

      // A nested IN carries no bare AND/OR/NOT keyword, so an expression key
      // built only from it round-trips to a single renderable facet. Before the
      // parser tracked parenthesis depth this same input parsed to the garbage
      // key `if(SeverityText` — accepted for the wrong reason; now it is
      // accepted with the correct, whole-expression key.
      it('accepts an expression key whose only nested keyword is IN', () => {
        expect(isRenderablePinnedFilter(sql(`${ifInExpr} IN ('Errors')`))).toBe(
          true,
        );
      });

      it('accepts a nested-function expression key', () => {
        const key = `toString(multiIf(Status >= 500, 'error', 'ok'))`;
        expect(isRenderablePinnedFilter(sql(`${key} IN ('error')`))).toBe(true);
      });

      // A key that nests OR/AND (including the AND of a nested BETWEEN) still
      // carries that keyword as bare text, so it is rejected: the sidebar can't
      // render it as a plain column facet even though the value list parses.
      it('rejects an expression key that nests OR', () => {
        expect(isRenderablePinnedFilter(sql(`${ifOrExpr} IN ('Errors')`))).toBe(
          false,
        );
      });

      it('rejects an expression key that nests a BETWEEN ... AND', () => {
        expect(
          isRenderablePinnedFilter(sql(`${ifBetweenExpr} IN ('fast')`)),
        ).toBe(false);
      });

      // countTopLevelAnd counts a BETWEEN's own bounds AND (exactly one
      // top-level conjunct) while the parentheses of the function key are
      // tracked without disturbing that count, so the filter stays renderable.
      it('accepts a numeric BETWEEN on a parenthesized (function) key', () => {
        expect(
          isRenderablePinnedFilter(sql('length(Body) BETWEEN 1 AND 5')),
        ).toBe(true);
      });
    });
  });

  describe('deriveVariableName', () => {
    it.each([
      ['Total Requests', 'Total_Requests'],
      ['HTTP Status (5xx)', 'HTTP_Status_5xx'],
      ['  env  ', 'env'],
      ['a   b', 'a_b'],
      ['ServiceName', 'ServiceName'],
      ['already-valid_1', 'alreadyvalid_1'],
      ['(leading)', 'leading'],
      // A leading digit or underscore is not a legal start, so the name is
      // prefixed rather than rejected.
      ['1st metric', 'v1st_metric'],
      ['_private', 'v_private'],
      // The prefix is decided after stripping, since stripping can expose a
      // leading character that was not leading in the display name.
      ['(5xx) errors', 'v5xx_errors'],
      ['#1 metric', 'v1_metric'],
      ['-1abc', 'v1abc'],
      ['环境', ''],
      ['', ''],
      ['   ', ''],
    ])('derives %p as %p', (input, expected) => {
      expect(deriveVariableName(input)).toBe(expected);
    });

    it('derives a name that satisfies the token grammar', () => {
      const names = [
        'Total Requests',
        "SpanAttributes['http.method']",
        'p99 latency — checkout',
        'a/b\\c',
        '  spaced  out  ',
        '1st metric',
        '_private',
        '(5xx) errors',
        '#1 metric',
        '-1abc',
        '(_leading)',
      ];
      for (const name of names) {
        const derived = deriveVariableName(name);
        expect(derived).not.toBe('');
        expect(DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED.test(derived)).toBe(
          true,
        );
      }
    });
  });

  describe('isFilterBroadcastEnabled', () => {
    it('treats a missing flag as enabled so pre-existing filters keep broadcasting', () => {
      expect(isFilterBroadcastEnabled({})).toBe(true);
      expect(isFilterBroadcastEnabled({ isBroadcastEnabled: undefined })).toBe(
        true,
      );
    });

    it('treats a null flag as enabled', () => {
      expect(
        isFilterBroadcastEnabled({
          isBroadcastEnabled: null,
        } as unknown as DashboardFilter),
      ).toBe(true);
    });

    it('respects an explicit flag', () => {
      expect(isFilterBroadcastEnabled({ isBroadcastEnabled: true })).toBe(true);
      expect(isFilterBroadcastEnabled({ isBroadcastEnabled: false })).toBe(
        false,
      );
    });
  });

  describe('isQueryExpressionFilter / getFilterExpression', () => {
    const queried: QueryExpressionDashboardFilter = {
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
    };
    const staticList: DashboardFilter = {
      id: 'f2',
      type: 'STATIC_LIST',
      name: 'Environment',
      options: ['prod'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
    };

    it('identifies a queried filter and reports its expression', () => {
      expect(isQueryExpressionFilter(queried)).toBe(true);
      expect(getFilterExpression(queried)).toBe('ServiceName');
    });

    const promqlLabel: DashboardFilter = {
      id: 'f3',
      type: 'PROMETHEUS_LABEL',
      name: 'Pod',
      source: 'promql',
      label: 'pod',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
    };

    it('rejects a static-list filter, which names no column', () => {
      expect(isQueryExpressionFilter(staticList)).toBe(false);
      expect(getFilterExpression(staticList)).toBeUndefined();
    });

    it('rejects a promql-label filter, which names a label rather than a column', () => {
      expect(isQueryExpressionFilter(promqlLabel)).toBe(false);
      expect(getFilterExpression(promqlLabel)).toBeUndefined();
    });
  });

  describe('getFilterBroadcastTarget', () => {
    const filter = (
      overrides: Partial<QueryExpressionDashboardFilter>,
    ): QueryExpressionDashboardFilter => ({
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
      ...overrides,
    });

    it('reports the expression and scope for a broadcasting filter', () => {
      expect(getFilterBroadcastTarget(filter({}))).toEqual({
        expression: 'ServiceName',
        appliesToSourceIds: undefined,
      });
      expect(
        getFilterBroadcastTarget(filter({ appliesToSourceIds: ['logs'] })),
      ).toEqual({ expression: 'ServiceName', appliesToSourceIds: ['logs'] });
    });

    it('returns undefined when broadcasting is off', () => {
      expect(
        getFilterBroadcastTarget(
          filter({ isBroadcastEnabled: false, appliesToSourceIds: ['logs'] }),
        ),
      ).toBeUndefined();
    });

    it('returns undefined for a static-list filter, which has no column', () => {
      expect(
        getFilterBroadcastTarget({
          id: 'f2',
          type: 'STATIC_LIST',
          name: 'Environment',
          options: ['prod'],
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        }),
      ).toBeUndefined();
    });

    it('returns undefined for a promql-label filter, which has no column', () => {
      expect(
        getFilterBroadcastTarget({
          id: 'f3',
          type: 'PROMETHEUS_LABEL',
          name: 'Pod',
          source: 'promql',
          label: 'pod',
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        }),
      ).toBeUndefined();
    });
  });

  describe('isFilterVariableEnabled', () => {
    it('treats a missing flag as disabled', () => {
      expect(isFilterVariableEnabled({})).toBe(false);
      expect(isFilterVariableEnabled({ isVariableEnabled: undefined })).toBe(
        false,
      );
    });

    it('respects an explicit flag', () => {
      expect(isFilterVariableEnabled({ isVariableEnabled: true })).toBe(true);
      expect(isFilterVariableEnabled({ isVariableEnabled: false })).toBe(false);
    });
  });

  describe('isFilterRequired', () => {
    it('treats a missing or zero minimum as not required', () => {
      expect(isFilterRequired({})).toBe(false);
      expect(isFilterRequired({ minSelections: undefined })).toBe(false);
      expect(isFilterRequired({ minSelections: 0 })).toBe(false);
    });

    it('treats a null minimum as not required', () => {
      expect(
        isFilterRequired({
          minSelections: null,
        } as unknown as DashboardFilter),
      ).toBe(false);
    });

    it('holds for a minimum of one', () => {
      expect(isFilterRequired({ minSelections: 1 })).toBe(true);
    });
  });

  describe('isFilterGlobalRequirement', () => {
    it('treats a missing flag as covering only the tiles that read the filter', () => {
      expect(isFilterGlobalRequirement({})).toBe(false);
      expect(
        isFilterGlobalRequirement({ isGlobalRequirement: undefined }),
      ).toBe(false);
    });

    it('respects an explicit flag', () => {
      expect(isFilterGlobalRequirement({ isGlobalRequirement: true })).toBe(
        true,
      );
      expect(isFilterGlobalRequirement({ isGlobalRequirement: false })).toBe(
        false,
      );
    });
  });

  describe('doesFilterApplyToSource', () => {
    const filter = (
      overrides: Partial<QueryExpressionDashboardFilter> = {},
    ): QueryExpressionDashboardFilter => ({
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
      ...overrides,
    });

    it('reaches every tile when the scope is empty', () => {
      for (const scoped of [
        filter(),
        filter({ appliesToSourceIds: [] }),
        filter({ appliesToSourceIds: undefined }),
      ]) {
        expect(doesFilterApplyToSource(scoped, 'traces')).toBe(true);
        expect(doesFilterApplyToSource(scoped, undefined)).toBe(true);
      }
    });

    it('reaches only the scoped sources', () => {
      const scoped = filter({ appliesToSourceIds: ['logs'] });

      expect(doesFilterApplyToSource(scoped, 'logs')).toBe(true);
      expect(doesFilterApplyToSource(scoped, 'traces')).toBe(false);
      expect(doesFilterApplyToSource(scoped, undefined)).toBe(false);
    });

    it('reaches nothing when broadcasting is off', () => {
      expect(
        doesFilterApplyToSource(filter({ isBroadcastEnabled: false }), 'logs'),
      ).toBe(false);
      expect(
        doesFilterApplyToSource(
          {
            id: 'f2',
            type: 'STATIC_LIST',
            name: 'Environment',
            options: ['prod'],
            isBroadcastEnabled: false,
            isVariableEnabled: true,
          },
          'logs',
        ),
      ).toBe(false);
    });
  });

  describe('hasFilterEffect', () => {
    it('holds for a filter that predates both flags', () => {
      expect(hasFilterEffect({})).toBe(true);
    });

    it('holds when either mode is on', () => {
      expect(
        hasFilterEffect({ isBroadcastEnabled: true, isVariableEnabled: false }),
      ).toBe(true);
      expect(
        hasFilterEffect({ isBroadcastEnabled: false, isVariableEnabled: true }),
      ).toBe(true);
      expect(
        hasFilterEffect({ isBroadcastEnabled: true, isVariableEnabled: true }),
      ).toBe(true);
    });

    it('fails only when broadcasting is explicitly off and no variable is set', () => {
      expect(hasFilterEffect({ isBroadcastEnabled: false })).toBe(false);
      expect(
        hasFilterEffect({
          isBroadcastEnabled: false,
          isVariableEnabled: false,
        }),
      ).toBe(false);
      expect(
        hasFilterEffect({
          isBroadcastEnabled: false,
          isVariableEnabled: undefined,
        }),
      ).toBe(false);
    });
  });

  describe('getFilterVariableName', () => {
    it('prefers an explicit variable name', () => {
      expect(
        getFilterVariableName({ name: 'Total Requests', variableName: 'reqs' }),
      ).toBe('reqs');
    });

    it('trims an explicit variable name', () => {
      expect(
        getFilterVariableName({
          name: 'Total Requests',
          variableName: ' reqs ',
        }),
      ).toBe('reqs');
    });

    it('falls back to the derived name when unset or whitespace-only', () => {
      expect(getFilterVariableName({ name: 'Total Requests' })).toBe(
        'Total_Requests',
      );
      expect(
        getFilterVariableName({ name: 'Total Requests', variableName: '   ' }),
      ).toBe('Total_Requests');
    });

    it('returns undefined when nothing usable can be derived', () => {
      expect(getFilterVariableName({ name: '环境' })).toBeUndefined();
    });
  });

  describe('getDashboardVariableFilters', () => {
    const filter = (
      overrides: Partial<QueryExpressionDashboardFilter>,
    ): QueryExpressionDashboardFilter => ({
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
      ...overrides,
    });

    it('returns nothing for a dashboard with no filters', () => {
      expect(getDashboardVariableFilters(undefined)).toEqual([]);
      expect(getDashboardVariableFilters([])).toEqual([]);
    });

    it('skips filters that do not expose a variable', () => {
      expect(
        getDashboardVariableFilters([
          filter({ id: 'broadcast-only', isVariableEnabled: false }),
          filter({ id: 'unset', name: 'Env', expression: 'Env' }),
        ]),
      ).toEqual([]);
    });

    it('skips a filter whose display name derives nothing usable', () => {
      expect(
        getDashboardVariableFilters([
          filter({ name: '环境', isVariableEnabled: true }),
        ]),
      ).toEqual([]);
    });

    it('pairs each variable-enabled filter with the name it answers to', () => {
      const explicit = filter({ isVariableEnabled: true, variableName: 'svc' });
      const derived = filter({
        id: 'f2',
        name: 'Total Requests',
        expression: 'Env',
        isVariableEnabled: true,
      });

      expect(getDashboardVariableFilters([explicit, derived])).toEqual([
        { filter: explicit, name: 'svc' },
        { filter: derived, name: 'Total_Requests' },
      ]);
    });

    it('keeps the first of two filters claiming the same name', () => {
      const first = filter({
        id: 'a',
        isVariableEnabled: true,
        variableName: 'svc',
      });

      expect(
        getDashboardVariableFilters([
          first,
          filter({
            id: 'b',
            expression: 'Other',
            isVariableEnabled: true,
            variableName: 'svc',
          }),
        ]),
      ).toEqual([{ filter: first, name: 'svc' }]);
    });
  });

  describe('getDashboardVariableDeclarations', () => {
    const filter = (
      overrides: Partial<QueryExpressionDashboardFilter>,
    ): QueryExpressionDashboardFilter => ({
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
      ...overrides,
    });

    it('returns nothing for a dashboard with no filters', () => {
      expect(getDashboardVariableDeclarations(undefined)).toEqual([]);
      expect(getDashboardVariableDeclarations([])).toEqual([]);
    });

    it('accepts the external filter shape, which has sourceId not source', () => {
      // The external API and MCP hold filters with `sourceId`; only the name,
      // expression and the two variable fields decide what a filter declares,
      // so the signature is structural rather than tied to DashboardFilter.
      expect(
        getDashboardVariableDeclarations([
          {
            name: 'Service',
            expression: 'ServiceName',
            isVariableEnabled: true,
            variableName: 'service',
          },
        ]),
      ).toEqual([{ name: 'service', expression: 'ServiceName' }]);
    });

    it('skips filters that do not expose a variable', () => {
      expect(
        getDashboardVariableDeclarations([
          filter({ id: 'broadcast-only', isVariableEnabled: false }),
          filter({ id: 'unset', name: 'Env', expression: 'Env' }),
        ]),
      ).toEqual([]);
    });

    it('declares the name and the expression it filters on', () => {
      expect(
        getDashboardVariableDeclarations([
          filter({ isVariableEnabled: true, variableName: 'svc' }),
        ]),
      ).toEqual([{ name: 'svc', expression: 'ServiceName' }]);
    });

    it('falls back to the name derived from the display name', () => {
      expect(
        getDashboardVariableDeclarations([
          filter({ name: 'Total Requests', isVariableEnabled: true }),
        ]),
      ).toEqual([{ name: 'Total_Requests', expression: 'ServiceName' }]);
    });

    it('skips a filter whose display name derives nothing usable', () => {
      expect(
        getDashboardVariableDeclarations([
          filter({ name: '环境', isVariableEnabled: true }),
        ]),
      ).toEqual([]);
    });

    it('keeps the first of two filters claiming the same name', () => {
      expect(
        getDashboardVariableDeclarations([
          filter({ id: 'a', isVariableEnabled: true, variableName: 'svc' }),
          filter({
            id: 'b',
            expression: 'Other',
            isVariableEnabled: true,
            variableName: 'svc',
          }),
        ]),
      ).toEqual([{ name: 'svc', expression: 'ServiceName' }]);
    });

    // The falsiness of `expression` is what makes `$__filter($name)` report
    // that the expression has to be passed explicitly, so it must stay
    // undefined rather than becoming an empty string.
    it('declares a static-list filter with no expression', () => {
      const staticFilter: StaticListDashboardFilter = {
        id: 'f1',
        type: 'STATIC_LIST',
        name: 'Environment',
        options: ['prod', 'staging', 'dev'],
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        variableName: 'env',
      };
      expect(getDashboardVariableDeclarations([staticFilter])).toEqual([
        { name: 'env', expression: undefined },
      ]);
    });

    it('keeps the declarations in filter order', () => {
      expect(
        getDashboardVariableDeclarations([
          filter({ isVariableEnabled: true, variableName: 'svc' }),
          filter({
            id: 'f2',
            name: 'Env',
            expression: 'Env',
            isVariableEnabled: true,
            variableName: 'env',
          }),
        ]),
      ).toEqual([
        { name: 'svc', expression: 'ServiceName' },
        { name: 'env', expression: 'Env' },
      ]);
    });
  });

  describe('validateVariableName', () => {
    const variableFilter = (
      overrides: Partial<QueryExpressionDashboardFilter>,
    ): QueryExpressionDashboardFilter => ({
      id: 'f1',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
      isVariableEnabled: true,
      ...overrides,
    });

    it('accepts a valid unique name', () => {
      expect(
        validateVariableName({ value: 'env_prod_1', otherFilters: [] }),
      ).toBeUndefined();
    });

    it('requires a name', () => {
      expect(validateVariableName({ value: '', otherFilters: [] })).toBe(
        'Variable name is required',
      );
      expect(validateVariableName({ value: '  ', otherFilters: [] })).toBe(
        'Variable name is required',
      );
      expect(validateVariableName({ value: undefined, otherFilters: [] })).toBe(
        'Variable name is required',
      );
    });

    it('rejects names longer than the maximum', () => {
      expect(
        validateVariableName({
          value: 'a'.repeat(DASHBOARD_VARIABLE_NAME_MAX_LENGTH + 1),
          otherFilters: [],
        }),
      ).toBe(
        `Variable name must be ${DASHBOARD_VARIABLE_NAME_MAX_LENGTH} characters or fewer`,
      );
    });

    it.each([
      'has space',
      'dollar$',
      'dot.notation',
      "quote'",
      'br[ackets]',
      'with-dash',
      '1leading',
      '_leading',
    ])('rejects %p', value => {
      expect(validateVariableName({ value, otherFilters: [] })).toBe(
        'Variable names must start with a letter and may contain only letters, numbers, and underscores',
      );
    });

    it('rejects a name already used by another variable-enabled filter', () => {
      expect(
        validateVariableName({
          value: 'env',
          otherFilters: [variableFilter({ name: 'Env', variableName: 'env' })],
        }),
      ).toBe(
        'This variable name is used by another filter on this dashboard (Env)',
      );
    });

    it('compares names case-sensitively', () => {
      expect(
        validateVariableName({
          value: 'ENV',
          otherFilters: [variableFilter({ name: 'Env', variableName: 'env' })],
        }),
      ).toBeUndefined();
    });

    it('clashes against a sibling that only has a derived name', () => {
      expect(
        validateVariableName({
          value: 'Total_Requests',
          otherFilters: [variableFilter({ name: 'Total Requests' })],
        }),
      ).toBe(
        'This variable name is used by another filter on this dashboard (Total Requests)',
      );
    });

    it('ignores siblings whose variables are disabled', () => {
      expect(
        validateVariableName({
          value: 'env',
          otherFilters: [
            variableFilter({
              name: 'Env',
              variableName: 'env',
              isVariableEnabled: false,
            }),
            variableFilter({ name: 'Other Env', isVariableEnabled: undefined }),
          ],
        }),
      ).toBeUndefined();
    });
  });
});
