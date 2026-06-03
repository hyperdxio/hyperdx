import {
  filtersToQuery,
  validateDashboardFilterQueries,
  validateSavedFilterValues,
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
});
