import { enableMapSet } from 'immer';
import { filtersToQuery } from '@hyperdx/common-utils/dist/filters';
import { act, renderHook } from '@testing-library/react';

import {
  areFiltersEqual,
  canonicalizeFilterQuery,
  parseQuery,
  useSearchPageFilterState,
} from '@/searchFilters';

enableMapSet();

type ConditionFilter = { type: 'sql' | 'lucene'; condition: string };

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

  describe('round-trip: DateTime columns', () => {
    const dateTimeColumns = new Map<string, string>([
      ['Timestamp', 'DateTime64(9)'],
      ['TimestampTime', 'DateTime'],
    ]);

    it('round-trips an excluded DateTime value (no areFiltersEqual reset)', () => {
      const originalFilters = {
        Timestamp: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([
            '2026-06-16T15:35:16.731000000Z',
          ]),
        },
      };

      const query = filtersToQuery(originalFilters, { dateTimeColumns });
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        Timestamp: {
          included: new Set(),
          excluded: new Set(['2026-06-16T15:35:16.731000000Z']),
        },
      });
    });

    it('round-trips an included DateTime value with multiple entries', () => {
      const originalFilters = {
        Timestamp: {
          included: new Set<string | boolean>(['2026-06-16', '2026-06-17']),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters, { dateTimeColumns });
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        Timestamp: {
          included: new Set(['2026-06-16', '2026-06-17']),
          excluded: new Set(),
        },
      });
    });

    it('parseQuery unwraps the DateTime wrapper independently of the producer', () => {
      const parsed = parseQuery([
        {
          type: 'sql',
          condition:
            "Timestamp NOT IN (parseDateTime64BestEffort('a', 9), parseDateTime64BestEffort('b', 9))",
        },
      ]);

      expect(parsed.filters).toEqual({
        Timestamp: {
          included: new Set(),
          excluded: new Set(['a', 'b']),
        },
      });
    });

    it('unwraps the DateTime part of a compound AND condition', () => {
      const parsed = parseQuery([
        {
          type: 'sql',
          condition:
            "ServiceName IN ('api') AND Timestamp NOT IN (parseDateTime64BestEffort('2026-06-16', 9))",
        },
      ]);

      expect(parsed.filters).toEqual({
        ServiceName: {
          included: new Set(['api']),
          excluded: new Set(),
        },
        Timestamp: {
          included: new Set(),
          excluded: new Set(['2026-06-16']),
        },
      });
    });

    it('round-trips a DateTime value containing the wrapper suffix', () => {
      const originalFilters = {
        Timestamp: {
          included: new Set<string | boolean>(["a', 9)b"]),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters, { dateTimeColumns });
      const parsed = parseQuery(query);

      expect(parsed.filters).toEqual({
        Timestamp: {
          included: new Set(["a', 9)b"]),
          excluded: new Set(),
        },
      });
    });

    it('round-trips a plain DateTime column (parseDateTimeBestEffort wrapper)', () => {
      const originalFilters = {
        TimestampTime: {
          included: new Set<string | boolean>(['2026-06-17T11:56:41Z']),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters, { dateTimeColumns });
      // Sanity: produces the DateTime (non-64) wrapper.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((query[0] as ConditionFilter).condition).toBe(
        "TimestampTime IN (parseDateTimeBestEffort('2026-06-17T11:56:41Z'))",
      );

      expect(parseQuery(query).filters).toEqual({
        TimestampTime: {
          included: new Set(['2026-06-17T11:56:41Z']),
          excluded: new Set(),
        },
      });
    });

    it('parseQuery unwraps parseDateTimeBestEffort and toDate wrappers', () => {
      const parsed = parseQuery([
        {
          type: 'sql',
          condition: "TimestampTime IN (parseDateTimeBestEffort('a'))",
        },
        { type: 'sql', condition: "day NOT IN (toDate('2026-06-17'))" },
      ]);

      expect(parsed.filters).toEqual({
        TimestampTime: { included: new Set(['a']), excluded: new Set() },
        day: { included: new Set(), excluded: new Set(['2026-06-17']) },
      });
    });

    // The map key can be a query-result column name that isn't a table column:
    // an alias (`TimestampTime AS time`) or a computed expression
    // (`toDate(TimestampTime)`). These only become filterable correctly when the
    // type map is sourced from the result set rather than the table schema.
    it('wraps and round-trips an aliased DateTime column', () => {
      const aliasColumns = new Map<string, string>([['time', 'DateTime64(9)']]);
      const originalFilters = {
        time: {
          included: new Set<string | boolean>(['2026-06-18T10:33:55Z']),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters, {
        dateTimeColumns: aliasColumns,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((query[0] as ConditionFilter).condition).toBe(
        "time IN (parseDateTime64BestEffort('2026-06-18T10:33:55Z', 9))",
      );

      expect(parseQuery(query).filters).toEqual({
        time: {
          included: new Set(['2026-06-18T10:33:55Z']),
          excluded: new Set(),
        },
      });
    });

    it('wraps a computed DateTime expression with the type-matched function', () => {
      const exprColumns = new Map<string, string>([
        ['toDate(TimestampTime)', 'Date'],
      ]);
      const originalFilters = {
        'toDate(TimestampTime)': {
          included: new Set<string | boolean>(['2026-06-18']),
          excluded: new Set<string | boolean>(),
        },
      };

      const query = filtersToQuery(originalFilters, {
        dateTimeColumns: exprColumns,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((query[0] as ConditionFilter).condition).toBe(
        "toDate(TimestampTime) IN (toDate('2026-06-18'))",
      );
    });
  });

  describe('useSearchPageFilterState', () => {
    const onFilterChange = jest.fn();

    it('adding filter to empty query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [],
          onFilterChange,
          knownColumns: new Set(),
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'app');
        result.current.setFilterValue('level', 'error');
      });

      expect(onFilterChange).toHaveBeenLastCalledWith([
        {
          type: 'sql',
          condition: "service IN ('app')",
        },
        {
          type: 'sql',
          condition: "level IN ('error')",
        },
      ]);
    });

    it('serializes JSON column filters as string expressions', () => {
      const onFilterChangeLocal = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [],
          onFilterChange: onFilterChangeLocal,
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: ['ResourceAttributes'],
        }),
      );

      act(() => {
        result.current.setFilterValue(
          'ResourceAttributes.k8s.namespace.name',
          'alert-service',
          'only',
        );
      });

      expect(onFilterChangeLocal).toHaveBeenLastCalledWith([
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('alert-service')",
        },
      ]);
    });

    it('serializes non-string JSON column filters as string expressions', () => {
      const onFilterChangeLocal = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [],
          onFilterChange: onFilterChangeLocal,
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: ['ResourceAttributes'],
        }),
      );

      act(() => {
        result.current.setFilterValue(
          'ResourceAttributes.cloud.account.id',
          '47452524847',
          'only',
        );
      });

      expect(onFilterChangeLocal).toHaveBeenLastCalledWith([
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`cloud`.`account`.`id`) IN ('47452524847')",
        },
      ]);
    });

    it('hydrates string JSON column filters back to clean keys', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            {
              type: 'sql',
              condition:
                "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('alert-service')",
            },
          ],
          onFilterChange: jest.fn(),
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: ['ResourceAttributes'],
        }),
      );

      expect(result.current.filters).toEqual({
        'ResourceAttributes.k8s.namespace.name': {
          included: new Set(['alert-service']),
          excluded: new Set(),
        },
      });
    });

    it('hydrates legacy typed JSON column filters back to clean keys', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            {
              type: 'sql',
              condition:
                "ResourceAttributes.`k8s`.`namespace`.`name`.:String IN ('alert-service')",
            },
          ],
          onFilterChange: jest.fn(),
          knownColumns: new Set(['ResourceAttributes']),
          jsonColumns: ['ResourceAttributes'],
        }),
      );

      expect(result.current.filters).toEqual({
        'ResourceAttributes.k8s.namespace.name': {
          included: new Set(['alert-service']),
          excluded: new Set(),
        },
      });
    });

    it('canonicalizes persisted JSON column filters as string expressions', () => {
      expect(
        canonicalizeFilterQuery(
          [
            {
              type: 'sql',
              condition:
                "ResourceAttributes['k8s.namespace.name'] IN ('traefik-private')",
            },
          ],
          new Set(['ResourceAttributes']),
          ['ResourceAttributes'],
        ),
      ).toEqual([
        {
          type: 'sql',
          condition:
            "toString(ResourceAttributes.`k8s`.`namespace`.`name`) IN ('traefik-private')",
        },
      ]);
    });

    it('does not canonicalize non-JSON sidebar filters', () => {
      const filters = [
        {
          type: 'sql' as const,
          condition: "SpanKind IN ('Server')",
        },
      ];

      expect(
        canonicalizeFilterQuery(filters, new Set(['ResourceAttributes']), [
          'ResourceAttributes',
        ]),
      ).toBe(filters);
    });

    it('does not canonicalize compound SQL predicates that contain sidebar clauses', () => {
      const filters = [
        {
          type: 'sql' as const,
          condition: "SpanName = 'foo' AND SpanKind IN ('Server')",
        },
      ];

      expect(
        canonicalizeFilterQuery(filters, new Set(['ResourceAttributes']), [
          'ResourceAttributes',
        ]),
      ).toBe(filters);
    });

    it('does not drop surrounding predicates while canonicalizing legacy JSON filters', () => {
      const filters = [
        {
          type: 'sql' as const,
          condition:
            "SpanName = 'foo' AND ResourceAttributes['k8s.namespace.name'] IN ('traefik-private')",
        },
      ];

      expect(
        canonicalizeFilterQuery(filters, new Set(['ResourceAttributes']), [
          'ResourceAttributes',
        ]),
      ).toBe(filters);
    });

    it('updating filter query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            { type: 'sql', condition: `service IN ('hdx-oss-dev-app')` },
            { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
            { type: 'sql', condition: `level IN ('info', 'ok')` },
          ],
          onFilterChange,
          knownColumns: new Set(),
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'hdx-oss-dev-app'); // deselect
        result.current.setFilterValue('another_facet', 'some_value');
      });

      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
        { type: 'sql', condition: `level IN ('info', 'ok')` },
        { type: 'sql', condition: `another_facet IN ('some_value')` },
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
          knownColumns: new Set(),
        }),
      );

      act(() => {
        result.current.clearFilter('level');
      });

      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: `service IN ('hdx-oss-dev-app')` },
        { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
      ]);
    });

    it('correctly hydrates filter state from query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: [
            { type: 'sql', condition: `service IN ('hdx-oss-dev-app')` },
            { type: 'sql', condition: `hyperdx_event_type IN ('span')` },
            { type: 'sql', condition: `level IN ('info', 'ok')` },
          ],
          onFilterChange,
          knownColumns: new Set(),
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
          knownColumns: new Set(),
        }),
      );

      act(() => {
        result.current.setFilterValue('level', 'info', 'only');
      });

      expect(onFilterChange).toHaveBeenCalledWith([
        { type: 'sql', condition: `service IN ('app')` },
        { type: 'sql', condition: `level IN ('info')` }, // Should only have the included value, no excluded values
      ]);
    });

    describe('retainFiltersByColumns', () => {
      it('returns [] and does not touch URL when filter state is empty', () => {
        const onFilterChangeLocal = jest.fn();
        const { result } = renderHook(() =>
          useSearchPageFilterState({
            searchQuery: [],
            onFilterChange: onFilterChangeLocal,
            knownColumns: new Set(),
          }),
        );

        let dropped: string[] = ['unset'];
        act(() => {
          dropped = result.current.retainFiltersByColumns(
            new Set(['ServiceName']),
          );
        });

        expect(dropped).toEqual([]);
        expect(onFilterChangeLocal).not.toHaveBeenCalled();
      });

      it('keeps filters whose root column exists on the new source', () => {
        const onFilterChangeLocal = jest.fn();
        const { result } = renderHook(() =>
          useSearchPageFilterState({
            searchQuery: [
              { type: 'lucene', condition: 'ServiceName:"app"' },
              { type: 'lucene', condition: 'SeverityText:"error"' },
            ],
            onFilterChange: onFilterChangeLocal,
            knownColumns: new Set(),
          }),
        );

        let dropped: string[] = ['unset'];
        act(() => {
          dropped = result.current.retainFiltersByColumns(
            new Set(['ServiceName', 'SeverityText', 'Timestamp']),
          );
        });

        expect(dropped).toEqual([]);
        // Nothing dropped → no URL update fires.
        expect(onFilterChangeLocal).not.toHaveBeenCalled();
      });

      it('keeps nested JSON/Map keys when the root column exists', () => {
        const onFilterChangeLocal = jest.fn();
        const { result } = renderHook(() =>
          useSearchPageFilterState({
            searchQuery: [
              {
                type: 'lucene',
                condition: 'LogAttributes.user:"123"',
              },
            ],
            onFilterChange: onFilterChangeLocal,
            knownColumns: new Set(),
          }),
        );

        let dropped: string[] = ['unset'];
        act(() => {
          dropped = result.current.retainFiltersByColumns(
            new Set(['LogAttributes']),
          );
        });

        expect(dropped).toEqual([]);
        expect(onFilterChangeLocal).not.toHaveBeenCalled();
      });

      it('drops filters whose root column is missing and returns their keys', () => {
        const onFilterChangeLocal = jest.fn();
        const { result } = renderHook(() =>
          useSearchPageFilterState({
            searchQuery: [
              { type: 'sql', condition: `OldColumn IN ('x')` },
              { type: 'sql', condition: `AnotherGone IN ('y')` },
            ],
            onFilterChange: onFilterChangeLocal,
            knownColumns: new Set(),
          }),
        );

        let dropped: string[] = [];
        act(() => {
          dropped = result.current.retainFiltersByColumns(
            new Set(['ServiceName']),
          );
        });

        expect(dropped.sort()).toEqual(['AnotherGone', 'OldColumn']);
        expect(onFilterChangeLocal).toHaveBeenLastCalledWith([]);
      });

      it('keeps matching filters and drops the rest in mixed input', () => {
        const onFilterChangeLocal = jest.fn();
        const { result } = renderHook(() =>
          useSearchPageFilterState({
            searchQuery: [
              { type: 'sql', condition: `ServiceName IN ('app')` },
              { type: 'sql', condition: `Body IN ('oops')` },
            ],
            onFilterChange: onFilterChangeLocal,
            knownColumns: new Set(),
          }),
        );

        let dropped: string[] = [];
        act(() => {
          dropped = result.current.retainFiltersByColumns(
            new Set(['ServiceName', 'Timestamp']),
          );
        });

        expect(dropped).toEqual(['Body']);
        expect(onFilterChangeLocal).toHaveBeenLastCalledWith([
          { type: 'sql', condition: `ServiceName IN ('app')` },
        ]);
      });
    });
  });
});
