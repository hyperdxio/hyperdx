import { enableMapSet } from 'immer';
import { act, renderHook } from '@testing-library/react';

import {
  areFiltersEqual,
  filtersToQuery,
  parseQuery,
  useSearchPageFilterState,
} from '../searchFilters';

enableMapSet();

describe('searchFilters', () => {
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
  });

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

    it('updating filter query', () => {
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
        { type: 'sql', condition: `service IN ('app')` },
        { type: 'sql', condition: `level IN ('info')` }, // Should only have the included value, no excluded values
      ]);
    });
  });
});
