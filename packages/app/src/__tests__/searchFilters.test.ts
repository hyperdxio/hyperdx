import { enableMapSet } from 'immer';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { filtersToQuery } from '@hyperdx/common-utils/dist/filters';
import {
  CustomSchemaSQLSerializerV2,
  SearchQueryBuilder,
} from '@hyperdx/common-utils/dist/queryParser';
import { act, renderHook } from '@testing-library/react';

import {
  areFiltersEqual,
  parseQuery,
  useSearchPageFilterState,
} from '../searchFilters';

enableMapSet();

describe('searchFilters', () => {
  describe('parseQuery', () => {
    it('empty query', () => {
      const result = parseQuery([]);
      expect(result.filters).toEqual({});
    });

    it('parses one filter', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('z')` },
      ]);
      expect(result.filters).toEqual({
        service: { included: new Set(['z']), excluded: new Set() },
      });
    });

    it('parses 1 group, multiple values', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('z', 'y', 'x')` },
      ]);
      expect(result.filters).toEqual({
        service: { included: new Set(['z', 'y', 'x']), excluded: new Set() },
      });
    });

    it('parses 3 groups, multiple values', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('z', 'y', 'x')` },
        { type: 'sql', condition: `level IN ('info', 'error')` },
        { type: 'sql', condition: `type IN ('event')` },
      ]);
      expect(result.filters).toEqual({
        service: { included: new Set(['z', 'y', 'x']), excluded: new Set() },
        level: { included: new Set(['info', 'error']), excluded: new Set() },
        type: { included: new Set(['event']), excluded: new Set() },
      });
    });

    it('parses excluded values', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('z')` },
        { type: 'sql', condition: `service NOT IN ('y')` },
      ]);
      expect(result.filters).toEqual({
        service: { included: new Set(['z']), excluded: new Set(['y']) },
      });
    });

    it('skips non-supported filters', () => {
      const result = parseQuery([{ type: 'lucene', condition: `app:*` }]);
      expect(result.filters).toEqual({});
    });

    it('extracts IN clauses from complex conditions with AND operator', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `SpanName = 'flagd.evaluation.v1.Service/EventStream' AND SpanKind IN ('Server', 'SPAN_KIND_SERVER')`,
        },
      ]);
      expect(result.filters).toEqual({
        SpanKind: {
          included: new Set(['Server', 'SPAN_KIND_SERVER']),
          excluded: new Set(),
        },
      });
    });

    it('skips conditions with OR operator (not supported)', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `level IN ('error') OR severity IN ('high')`,
        },
      ]);
      // OR is not supported, so it just tries to parse as-is and should fail cleanly
      expect(result.filters).toEqual({});
    });

    it('skips conditions with only equality operators', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `status_code = 200`,
        },
      ]);
      expect(result.filters).toEqual({});
    });

    it('skips conditions with only comparison operators', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `duration > 1000`,
        },
      ]);
      expect(result.filters).toEqual({});
    });

    it('parses simple IN conditions alongside extracting from complex conditions', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('app', 'api')` },
        {
          type: 'sql',
          condition: `SpanName = 'test' AND SpanKind IN ('Server')`,
        },
        { type: 'sql', condition: `level IN ('error')` },
      ]);
      expect(result.filters).toEqual({
        service: { included: new Set(['app', 'api']), excluded: new Set() },
        SpanKind: { included: new Set(['Server']), excluded: new Set() },
        level: { included: new Set(['error']), excluded: new Set() },
      });
    });

    it('handles multiple IN clauses with AND', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `service IN ('app') AND level IN ('error', 'warn')`,
        },
      ]);
      expect(result.filters).toEqual({
        service: { included: new Set(['app']), excluded: new Set() },
        level: { included: new Set(['error', 'warn']), excluded: new Set() },
      });
    });

    it('extracts NOT IN clauses from complex conditions', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `status = 'active' AND level NOT IN ('debug')`,
        },
      ]);
      expect(result.filters).toEqual({
        level: { included: new Set(), excluded: new Set(['debug']) },
      });
    });

    it('handles string values with special characters in AND conditions', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `SpanName = 'flagd.evaluation.v1.Service/EventStream' AND SpanKind IN ('Server', 'SPAN_KIND_SERVER')`,
        },
      ]);
      expect(result.filters).toEqual({
        SpanKind: {
          included: new Set(['Server', 'SPAN_KIND_SERVER']),
          excluded: new Set(),
        },
      });
    });

    it('handles JSON values with commas and special characters', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('{"orderId": "123", "total": 100}')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['{"orderId": "123", "total": 100}']),
          excluded: new Set(),
        },
      });
    });

    it('handles complex multi-line JSON values', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('Order details: { "orderId": "7b54ad99", "items": [{"id": 1}, {"id": 2}] }')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set([
            'Order details: { "orderId": "7b54ad99", "items": [{"id": 1}, {"id": 2}] }',
          ]),
          excluded: new Set(),
        },
      });
    });

    it('handles multiple simple values alongside single complex JSON value', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `status IN ('active', 'pending')`,
        },
        {
          type: 'sql',
          condition: `data IN ('{"key": "value", "nested": {"a": 1}}')`,
        },
      ]);
      expect(result.filters).toEqual({
        status: {
          included: new Set(['active', 'pending']),
          excluded: new Set(),
        },
        data: {
          included: new Set(['{"key": "value", "nested": {"a": 1}}']),
          excluded: new Set(),
        },
      });
    });

    it('handles boolean filter values', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `isRootSpan IN (true)`,
        },
        {
          type: 'sql',
          condition: `another_boolean NOT IN (TRUE, FALSE)`,
        },
      ]);
      expect(result.filters).toEqual({
        isRootSpan: {
          included: new Set([true]),
          excluded: new Set(),
        },
        another_boolean: {
          included: new Set(),
          excluded: new Set([true, false]),
        },
      });
    });

    it('parses IN clauses when values contain = character', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('key=value')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['key=value']),
          excluded: new Set(),
        },
      });
    });

    it('parses IN clauses when values contain > character', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('x > y')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['x > y']),
          excluded: new Set(),
        },
      });
    });

    it('parses IN clauses when values contain < character', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('<html>')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['<html>']),
          excluded: new Set(),
        },
      });
    });

    it('parses IN clauses when values contain OR text', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('true OR false')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['true OR false']),
          excluded: new Set(),
        },
      });
    });

    it('still skips real comparison operators outside quotes', () => {
      const result = parseQuery([
        { type: 'sql', condition: `status_code = 200` },
        { type: 'sql', condition: `duration > 1000` },
        { type: 'sql', condition: `count < 5` },
        {
          type: 'sql',
          condition: `level IN ('error') OR severity IN ('high')`,
        },
      ]);
      expect(result.filters).toEqual({});
    });

    it('extracts IN clause from AND condition with quoted = in non-IN part', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `SpanName = 'test=value' AND SpanKind IN ('Server')`,
        },
      ]);
      expect(result.filters).toEqual({
        SpanKind: {
          included: new Set(['Server']),
          excluded: new Set(),
        },
      });
    });

    it('parses IN clauses when values contain BETWEEN text', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('I AM BETWEEN THE HEDGES AND I LOVE IT HERE')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['I AM BETWEEN THE HEDGES AND I LOVE IT HERE']),
          excluded: new Set(),
        },
      });
    });

    it('still parses real BETWEEN conditions correctly', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `duration BETWEEN 100 AND 500`,
        },
      ]);
      expect(result.filters).toEqual({
        duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 100, max: 500 },
        },
      });
    });

    it('parses IN clauses when values contain NOT IN text', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('this is NOT IN scope')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['this is NOT IN scope']),
          excluded: new Set(),
        },
      });
    });

    it('handles values with single quotes (SQL-escaped)', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `message IN ('my ''filter'' key')`,
        },
      ]);
      expect(result.filters).toEqual({
        message: {
          included: new Set(["my 'filter' key"]),
          excluded: new Set(),
        },
      });
    });

    it('handles excluded values with single quotes', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `message NOT IN ('it''s a test')`,
        },
      ]);
      expect(result.filters).toEqual({
        message: {
          included: new Set(),
          excluded: new Set(["it's a test"]),
        },
      });
    });

    it('handles multiple values where some contain single quotes', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `message IN ('normal value', 'it''s quoted', 'another ''one''')`,
        },
      ]);
      expect(result.filters).toEqual({
        message: {
          included: new Set(['normal value', "it's quoted", "another 'one'"]),
          excluded: new Set(),
        },
      });
    });

    it('handles SQL-escaped quotes with operators inside', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('value with '' = special')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(["value with ' = special"]),
          excluded: new Set(),
        },
      });
    });

    it('handles values with single quotes in AND conditions', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `status = 'active' AND message IN ('it''s here')`,
        },
      ]);
      expect(result.filters).toEqual({
        message: {
          included: new Set(["it's here"]),
          excluded: new Set(),
        },
      });
    });

    it('does not split AND-joined condition on AND inside quoted string', () => {
      const result = parseQuery([
        {
          type: 'sql',
          condition: `Body IN ('foo AND bar') AND level IN ('info')`,
        },
      ]);
      expect(result.filters).toEqual({
        Body: {
          included: new Set(['foo AND bar']),
          excluded: new Set(),
        },
        level: {
          included: new Set(['info']),
          excluded: new Set(),
        },
      });
    });
  });

  describe('areFiltersEqual', () => {
    it('should return true for equal filters', () => {
      const a = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      const b = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      expect(areFiltersEqual(a, b)).toBe(true);
    });

    it('should return false for different filters', () => {
      const a = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      const b = {
        a: { included: new Set<string>(['c']), excluded: new Set<string>() },
      };
      expect(areFiltersEqual(a, b)).toBe(false);
    });

    it('should return true for equal filters in different order', () => {
      const a = {
        service: {
          included: new Set<string>(['a', 'b']),
          excluded: new Set<string>(),
        },
        level: {
          included: new Set<string>(['info', 'error']),
          excluded: new Set<string>(),
        },
        type: { included: new Set<string>(), excluded: new Set<string>() },
      };
      const b = {
        level: {
          included: new Set<string>(['error', 'info']),
          excluded: new Set<string>(),
        },
        service: {
          included: new Set<string>(['b', 'a']),
          excluded: new Set<string>(),
        },
        type: { included: new Set<string>(), excluded: new Set<string>() },
      };
      expect(areFiltersEqual(a, b)).toBe(true);
    });

    it('should handle boolean filters', () => {
      const a = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>(),
        },
        another_column: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([true, false]),
        },
      };
      const b = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>(),
        },
        another_column: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([false, true]),
        },
      };
      expect(areFiltersEqual(a, b)).toBe(true);
    });
  });

  describe('round-trip: filtersToQuery -> parseQuery with quotes', () => {
    it('round-trips values containing single quotes', () => {
      const originalFilters = {
        message: {
          included: new Set<string | boolean>(["my 'filter' key"]),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters);
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        message: {
          included: new Set(["my 'filter' key"]),
          excluded: new Set(),
        },
      });
    });

    it('round-trips mixed values with and without quotes', () => {
      const originalFilters = {
        message: {
          included: new Set<string | boolean>([
            'normal',
            "it's a test",
            "value with 'multiple' quotes",
          ]),
          excluded: new Set<string | boolean>(["don't exclude"]),
        },
      };

      const query = filtersToQuery(originalFilters);
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        message: {
          included: new Set([
            'normal',
            "it's a test",
            "value with 'multiple' quotes",
          ]),
          excluded: new Set(["don't exclude"]),
        },
      });
    });

    it('round-trips values containing backslashes (Windows paths)', () => {
      const originalFilters = {
        FilePath: {
          included: new Set<string | boolean>(['C:\\path\\file']),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters);
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        FilePath: {
          included: new Set(['C:\\path\\file']),
          excluded: new Set(),
        },
      });
    });

    it('round-trips values containing both backslashes and single quotes', () => {
      const originalFilters = {
        message: {
          included: new Set<string | boolean>(["O\\'Malley"]),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters);
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        message: {
          included: new Set(["O\\'Malley"]),
          excluded: new Set(),
        },
      });
    });
  });

  describe('round-trip: Lucene filters', () => {
    it('round-trips Map filter with single included value', () => {
      const filters = {
        "LogAttributes['service.name']": {
          included: new Set<string | boolean>(['my-app']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      expect(query).toEqual([
        {
          type: 'lucene',
          condition: 'LogAttributes.service.name:"my-app"',
        },
      ]);
      // After round-trip, bracket-notation key becomes dot notation
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        'LogAttributes.service.name': {
          included: new Set(['my-app']),
          excluded: new Set(),
        },
      });
    });

    it('round-trips Map filter with multiple included values', () => {
      const filters = {
        "ResourceAttributes['env']": {
          included: new Set<string | boolean>(['prod', 'staging']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        'ResourceAttributes.env': {
          included: new Set(['prod', 'staging']),
          excluded: new Set(),
        },
      });
    });

    it('round-trips Map filter with excluded values', () => {
      const filters = {
        "LogAttributes['level']": {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['debug', 'trace']),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        'LogAttributes.level': {
          included: new Set(),
          excluded: new Set(['debug', 'trace']),
        },
      });
    });

    it('round-trips values containing double quotes', () => {
      const filters = {
        "LogAttributes['msg']": {
          included: new Set<string | boolean>(['say "hello"']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        'LogAttributes.msg': {
          included: new Set(['say "hello"']),
          excluded: new Set(),
        },
      });
    });

    it('round-trips values containing backslashes', () => {
      const filters = {
        "LogAttributes['path']": {
          included: new Set<string | boolean>(['C:\\path\\to\\file']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        'LogAttributes.path': {
          included: new Set(['C:\\path\\to\\file']),
          excluded: new Set(),
        },
      });
    });

    it('round-trips plain key filters', () => {
      const filters = {
        service: {
          included: new Set<string | boolean>(['app']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        service: {
          included: new Set(['app']),
          excluded: new Set(),
        },
      });
    });

    it('round-trips boolean filter values', () => {
      const filters = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters).toEqual({
        isRootSpan: {
          included: new Set([true]),
          excluded: new Set(),
        },
      });
      // Verify .has(true) works (boolean, not string)
      expect(parsed.filters.isRootSpan.included.has(true)).toBe(true);
      expect(parsed.filters.isRootSpan.included.has('true')).toBe(false);
    });

    it('round-trips empty string values', () => {
      const filters = {
        tag: {
          included: new Set<string | boolean>(['']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters.tag.included).toEqual(new Set(['']));
    });

    it('round-trips values with Lucene reserved characters', () => {
      const filters = {
        query: {
          included: new Set<string | boolean>(['(foo) AND [bar]']),
          excluded: new Set<string | boolean>(),
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters.query.included).toEqual(
        new Set(['(foo) AND [bar]']),
      );
    });

    it('round-trips range filters through Lucene', () => {
      const filters = {
        duration: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 10, max: 500 },
        },
      };
      const query = filtersToQuery(filters);
      const parsed = parseQuery(query);
      expect(parsed.filters.duration.range).toEqual({ min: 10, max: 500 });
    });

    it('merges mixed sql and lucene filters for the same key', () => {
      const parsed = parseQuery([
        { type: 'sql', condition: `service IN ('app')` },
        { type: 'lucene', condition: 'service:"web"' },
      ]);
      expect(parsed.filters.service.included).toEqual(new Set(['app', 'web']));
    });

    it('parses existing lucene filter from URL/API', () => {
      const parsed = parseQuery([
        {
          type: 'lucene',
          condition:
            'LogAttributes.service:"app-1" OR LogAttributes.service:"app-2"',
        },
      ]);
      expect(parsed.filters).toEqual({
        'LogAttributes.service': {
          included: new Set(['app-1', 'app-2']),
          excluded: new Set(),
        },
      });
    });
  });

  describe('useSearchPageFilterState', () => {
    const onFilterChange = jest.fn();

    it('adding filter to empty query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [],
          onFilterChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'app');
        result.current.setFilterValue('level', 'error');
      });

      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'lucene', condition: 'service:"app"' },
        { type: 'lucene', condition: 'level:"error"' },
      ]);
    });

    it('updating filter query from legacy sql input', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          // Legacy sql filters are still parsed correctly
          searchQuery: [
            { type: 'sql', condition: `service IN ('hdx-oss-dev-app')` },
            { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
            { type: 'sql', condition: `level IN ('info', 'ok')` },
          ],
          onFilterChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'hdx-oss-dev-app'); // deselect
        result.current.setFilterValue('another_facet', 'some_value');
      });

      // Output is now lucene after round-trip
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'lucene', condition: 'hyperdx_event_type:"span"' },
        {
          type: 'lucene',
          condition: '(level:"info" OR level:"ok")',
        },
        { type: 'lucene', condition: 'another_facet:"some_value"' },
      ]);
    });

    it('clearing filter', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            { type: 'sql', condition: `service IN ('hdx-oss-dev-app')` },
            { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
            { type: 'sql', condition: `level IN ('info', 'ok')` },
          ],
          onFilterChange,
        }),
      );

      act(() => {
        result.current.clearFilter('level');
      });

      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'lucene', condition: 'service:"hdx-oss-dev-app"' },
        { type: 'lucene', condition: 'hyperdx_event_type:"span"' },
      ]);
    });

    it('correctly hydrates filter state from sql query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            { type: 'sql', condition: `service IN ('hdx-oss-dev-app')` },
            { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
            { type: 'sql', condition: `level IN ('info', 'ok')` },
          ],
          onFilterChange,
        }),
      );

      expect(result.current.filters).toEqual({
        service: {
          included: new Set(['hdx-oss-dev-app']),
          excluded: new Set(),
        },
        hyperdx_event_type: {
          included: new Set(['span']),
          excluded: new Set(),
        },
        level: { included: new Set(['info', 'ok']), excluded: new Set() },
      });
    });

    it('should clear excluded values when using only action', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            { type: 'sql', condition: `service IN ('app')` },
            { type: 'sql', condition: `level NOT IN ('error')` },
          ],
          onFilterChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('level', 'info', 'only');
      });

      expect(onFilterChange).toHaveBeenCalledWith([
        { type: 'lucene', condition: 'service:"app"' },
        { type: 'lucene', condition: 'level:"info"' },
      ]);
    });
  });

  describe('filters use direct_read optimization', () => {
    const metadata = getMetadata(
      new ClickhouseClient({ host: 'http://localhost:8123' }),
    );

    metadata.getColumn = jest.fn().mockImplementation(async ({ column }) => {
      if (column === 'LogAttributes') {
        return { name: 'LogAttributes', type: 'Map(String, String)' };
      }
      return undefined;
    });
    metadata.getMaterializedColumnsLookupTable = jest
      .fn()
      .mockResolvedValue(new Map());
    metadata.getColumns = jest.fn().mockResolvedValue([
      {
        name: 'LogAttributes',
        type: 'Map(String, String)',
        default_type: '',
        default_expression: '',
      },
      {
        name: 'LogAttributeItems',
        type: 'Array(String)',
        default_type: 'ALIAS',
        default_expression:
          "arrayMap((arr) -> concat(arr.1, '=', arr.2), LogAttributes::Array(Tuple(String, String)))",
      },
    ]);
    metadata.getSkipIndices = jest.fn().mockResolvedValue([
      {
        name: 'idx_log_attr_items',
        type: 'text',
        typeFull: 'text(tokenizer=array)',
        expression: 'LogAttributeItems',
        granularity: 1,
      },
    ]);
    metadata.getSetting = jest.fn().mockResolvedValue('0');

    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName: 'default',
      tableName: 'otel_logs',
      connectionId: 'test',
    });

    it('single included filter value uses has() direct_read', async () => {
      const filters = filtersToQuery({
        "LogAttributes['service.name']": {
          included: new Set<string | boolean>(['my-app']),
          excluded: new Set<string | boolean>(),
        },
      });

      const condition = filters[0];
      expect(condition.type).toBe('lucene');
      const builder = new SearchQueryBuilder(
        (condition as { condition: string }).condition,
        serializer,
      );
      const sql = await builder.build();
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'my-app'))",
      );
    });

    it('multiple included filter values each use has() direct_read', async () => {
      const filters = filtersToQuery({
        "LogAttributes['env']": {
          included: new Set<string | boolean>(['prod', 'staging']),
          excluded: new Set<string | boolean>(),
        },
      });

      const condition = filters[0];
      expect(condition.type).toBe('lucene');
      const builder = new SearchQueryBuilder(
        (condition as { condition: string }).condition,
        serializer,
      );
      const sql = await builder.build();
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('env', '=', 'prod'))",
      );
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('env', '=', 'staging'))",
      );
    });

    it('excluded filter value uses NOT has() direct_read', async () => {
      const filters = filtersToQuery({
        "LogAttributes['level']": {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['debug']),
        },
      });

      const condition = filters[0];
      expect(condition.type).toBe('lucene');
      const builder = new SearchQueryBuilder(
        (condition as { condition: string }).condition,
        serializer,
      );
      const sql = await builder.build();
      expect(sql).toContain(
        "NOT has(`LogAttributeItems`, concat('level', '=', 'debug'))",
      );
    });
  });
});
