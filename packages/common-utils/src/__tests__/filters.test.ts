import {
  type FilterState,
  filtersToQuery,
  parseLuceneFilter,
  validateDashboardFilterQueries,
  validateSavedFilterValues,
} from '@/filters';
import type { DashboardFilter, Filter } from '@/types';

/** Extract condition string from a Filter (filtersToQuery never emits sql_ast) */
const getCondition = (f: Filter): string =>
  'condition' in f ? f.condition : '';

describe('filters', () => {
  describe('filtersToQuery', () => {
    it('should return empty array when no filters', () => {
      expect(filtersToQuery({})).toEqual([]);
    });

    it('should emit lucene for a single included value', () => {
      const filters = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'a:"b"' },
      ]);
    });

    it('should emit lucene with parens for multiple included values', () => {
      const filters = {
        c: {
          included: new Set<string>(['d', 'x']),
          excluded: new Set<string>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: '(c:"d" OR c:"x")' },
      ]);
    });

    it('should handle excluded values without parens', () => {
      const filters = {
        a: {
          included: new Set<string>(['b']),
          excluded: new Set<string>(['c']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'a:"b"' },
        { type: 'lucene', condition: '-a:"c"' },
      ]);
    });

    it('should handle multiple excluded values without parens', () => {
      const filters = {
        a: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([true, false]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition: '-a:"true" AND -a:"false"',
        },
      ]);
    });

    it('should handle boolean filter values', () => {
      const filters = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>([]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'isRootSpan:"true"' },
      ]);
    });

    it('should escape double quotes in values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(['say "hello"']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'message:"say \\"hello\\""' },
      ]);
    });

    it('should pass through single quotes in values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(["it's a test"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'message:"it\'s a test"' },
      ]);
    });

    it('should escape backslashes in values', () => {
      const filters = {
        FilePath: {
          included: new Set<string | boolean>(['C:\\path\\to\\file']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition: 'FilePath:"C:\\\\path\\\\to\\\\file"',
        },
      ]);
    });

    it('should convert Map bracket-notation keys to dot notation', () => {
      const filters = {
        "LogAttributes['service.name']": {
          included: new Set<string | boolean>(['my-app']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition: 'LogAttributes.service.name:"my-app"',
        },
      ]);
    });

    it('should handle Map bracket-notation with multiple values', () => {
      const filters = {
        "LogAttributes['env']": {
          included: new Set<string | boolean>(['prod', 'staging']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition:
            '(LogAttributes.env:"prod" OR LogAttributes.env:"staging")',
        },
      ]);
    });

    it('should handle Map bracket-notation excluded values', () => {
      const filters = {
        "LogAttributes['level']": {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['debug']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: '-LogAttributes.level:"debug"' },
      ]);
    });

    it('should handle Map bracket-notation with both included and excluded', () => {
      const filters = {
        "ResourceAttributes['host']": {
          included: new Set<string | boolean>(['web-1']),
          excluded: new Set<string | boolean>(['web-2']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'ResourceAttributes.host:"web-1"' },
        { type: 'lucene', condition: '-ResourceAttributes.host:"web-2"' },
      ]);
    });

    it('should emit lucene range syntax', () => {
      const filters = {
        duration: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 10, max: 500 },
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'duration:[10 TO 500]' },
      ]);
    });

    it('should emit lucene range with dot notation for Map bracket-notation keys', () => {
      const filters = {
        "LogAttributes['latency']": {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 0, max: 100 },
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'LogAttributes.latency:[0 TO 100]' },
      ]);
    });
  });

  describe('parseLuceneFilter', () => {
    it('should return empty array for empty string', () => {
      expect(parseLuceneFilter('')).toEqual([]);
    });

    it('should return empty array for unquoted terms', () => {
      expect(parseLuceneFilter('service:foo')).toEqual([]);
    });

    it('should parse a single included term', () => {
      expect(parseLuceneFilter('service:"app"')).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
      ]);
    });

    it('should parse a single excluded term', () => {
      expect(parseLuceneFilter('-service:"app"')).toEqual([
        { key: 'service', included: [], excluded: ['app'] },
      ]);
    });

    it('should parse multiple included values with OR', () => {
      expect(parseLuceneFilter('(service:"app" OR service:"web")')).toEqual([
        { key: 'service', included: ['app', 'web'], excluded: [] },
      ]);
    });

    it('should parse multiple excluded values with AND', () => {
      expect(
        parseLuceneFilter('-service:"debug" AND -service:"trace"'),
      ).toEqual([
        { key: 'service', included: [], excluded: ['debug', 'trace'] },
      ]);
    });

    it('should parse mixed included and excluded for the same field', () => {
      expect(
        parseLuceneFilter('-service:"bingo" (service:"foo" OR service:"bar")'),
      ).toEqual([
        { key: 'service', included: ['foo', 'bar'], excluded: ['bingo'] },
      ]);
    });

    it('should parse multiple distinct fields', () => {
      expect(parseLuceneFilter('service:"app" level:"info"')).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
        { key: 'level', included: ['info'], excluded: [] },
      ]);
    });

    it('should parse multiple fields with mixed negation', () => {
      expect(
        parseLuceneFilter('service:"app" -level:"debug" level:"info"'),
      ).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
        { key: 'level', included: ['info'], excluded: ['debug'] },
      ]);
    });

    it('should parse dot-notation fields (Map columns)', () => {
      expect(parseLuceneFilter('LogAttributes.env:"prod"')).toEqual([
        { key: 'LogAttributes.env', included: ['prod'], excluded: [] },
      ]);
    });

    it('should handle values with escaped double quotes', () => {
      expect(parseLuceneFilter('message:"say \\"hello\\""')).toEqual([
        { key: 'message', included: ['say "hello"'], excluded: [] },
      ]);
    });

    it('should handle values with backslashes', () => {
      expect(parseLuceneFilter('path:"C:\\\\dir\\\\file"')).toEqual([
        { key: 'path', included: ['C:\\dir\\file'], excluded: [] },
      ]);
    });

    it('should coerce "true"/"false" back to booleans', () => {
      expect(parseLuceneFilter('isRootSpan:"true"')).toEqual([
        { key: 'isRootSpan', included: [true], excluded: [] },
      ]);
      expect(parseLuceneFilter('-col:"true" AND -col:"false"')).toEqual([
        { key: 'col', included: [], excluded: [true, false] },
      ]);
    });

    it('should parse range terms', () => {
      expect(parseLuceneFilter('duration:[10 TO 500]')).toEqual([
        {
          key: 'duration',
          included: [],
          excluded: [],
          range: { min: 10, max: 500 },
        },
      ]);
    });

    it('should parse range with dot-notation field', () => {
      expect(parseLuceneFilter('LogAttributes.latency:[0 TO 100]')).toEqual([
        {
          key: 'LogAttributes.latency',
          included: [],
          excluded: [],
          range: { min: 0, max: 100 },
        },
      ]);
    });

    it('should return undefined for invalid lucene syntax', () => {
      expect(parseLuceneFilter('((((')).toBeUndefined();
    });
  });

  describe('filtersToQuery -> parseLuceneFilter round-trip', () => {
    it('round-trips a single included value', () => {
      const state: FilterState = {
        service: {
          included: new Set<string | boolean>(['app']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
      ]);
    });

    it('round-trips multiple included values', () => {
      const state: FilterState = {
        env: {
          included: new Set<string | boolean>(['prod', 'staging']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].key).toBe('env');
      expect(parsed?.[0].included).toEqual(
        expect.arrayContaining(['prod', 'staging']),
      );
    });

    it('round-trips excluded values', () => {
      const state: FilterState = {
        level: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['debug', 'trace']),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].key).toBe('level');
      expect(parsed?.[0].excluded).toEqual(
        expect.arrayContaining(['debug', 'trace']),
      );
    });

    it('round-trips boolean values preserving type', () => {
      const state: FilterState = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>([false]),
        },
      };
      const filters = filtersToQuery(state);
      const includedParsed = parseLuceneFilter(getCondition(filters[0]));
      const excludedParsed = parseLuceneFilter(getCondition(filters[1]));
      expect(includedParsed?.[0].included).toEqual([true]);
      expect(excludedParsed?.[0].excluded).toEqual([false]);
    });

    it('round-trips the literal string "true" without boolean coercion', () => {
      // The string "true" is indistinguishable from boolean true after
      // Lucene round-trip due to coerceBooleanValue. This test documents
      // that known limitation.
      const state: FilterState = {
        status: {
          included: new Set<string | boolean>(['true']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      // Coerced to boolean — this is the expected (lossy) behavior
      expect(parsed?.[0].included).toEqual([true]);
    });

    it('round-trips values with double quotes', () => {
      const state: FilterState = {
        msg: {
          included: new Set<string | boolean>(['say "hello"']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].included).toEqual(['say "hello"']);
    });

    it('round-trips values with backslashes', () => {
      const state: FilterState = {
        path: {
          included: new Set<string | boolean>(['C:\\dir\\file']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].included).toEqual(['C:\\dir\\file']);
    });

    it('round-trips empty string values', () => {
      const state: FilterState = {
        tag: {
          included: new Set<string | boolean>(['']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].included).toEqual(['']);
    });

    it('round-trips values containing Lucene reserved characters', () => {
      const state: FilterState = {
        query: {
          included: new Set<string | boolean>(['(foo) AND [bar]']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].included).toEqual(['(foo) AND [bar]']);
    });

    it('round-trips range filters', () => {
      const state: FilterState = {
        duration: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 10, max: 500 },
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      expect(parsed?.[0].range).toEqual({ min: 10, max: 500 });
    });

    it('round-trips Map bracket-notation key', () => {
      const state: FilterState = {
        "LogAttributes['service.name']": {
          included: new Set<string | boolean>(['my-app']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const parsed = parseLuceneFilter(getCondition(filters[0]));
      // Bracket notation normalizes to dot notation
      expect(parsed?.[0].key).toBe('LogAttributes.service.name');
      expect(parsed?.[0].included).toEqual(['my-app']);
    });

    it('round-trips a JSON column dot-path with colons and slashes in value', () => {
      const state: FilterState = {
        'Metadata.endpoint': {
          included: new Set<string | boolean>(['grpc://thingy:8888/Verify']),
          excluded: new Set<string | boolean>(),
        },
      };
      const filters = filtersToQuery(state);
      const condition = getCondition(filters[0]);
      expect(condition).not.toMatch(/^toString\(/);
      expect(condition).not.toMatch(/`/);
      const parsed = parseLuceneFilter(condition);
      expect(parsed?.[0].key).toBe('Metadata.endpoint');
      expect(parsed?.[0].included).toEqual(['grpc://thingy:8888/Verify']);
    });

    it('round-trips mixed included and excluded for same field', () => {
      const state: FilterState = {
        env: {
          included: new Set<string | boolean>(['prod', 'staging']),
          excluded: new Set<string | boolean>(['dev']),
        },
      };
      const filters = filtersToQuery(state);
      // filtersToQuery emits separate Filter entries for included/excluded
      expect(filters).toHaveLength(2);
      // Parse both and merge
      const allParsed = filters.flatMap(
        f => parseLuceneFilter(getCondition(f)) ?? [],
      );
      const envEntries = allParsed.filter(p => p.key === 'env');
      const included = envEntries.flatMap(e => e.included);
      const excluded = envEntries.flatMap(e => e.excluded);
      expect(included).toEqual(expect.arrayContaining(['prod', 'staging']));
      expect(excluded).toEqual(['dev']);
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
