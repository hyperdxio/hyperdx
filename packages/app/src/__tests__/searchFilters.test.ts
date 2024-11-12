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
      const filters = { a: new Set(['b']) };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
      ]);
    });

    it('should return query for multiple filters', () => {
      const filters = { a: new Set(['b']), c: new Set(['d', 'x']) };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
        { type: 'sql', condition: "c IN ('d', 'x')" },
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
      expect(result.filters).toEqual({ service: new Set(['z']) });
    });

    it('parses 1 group, multiple values', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('z', 'y', 'x')` },
      ]);
      expect(result.filters).toEqual({ service: new Set(['z', 'y', 'x']) });
    });

    it('parses 3 groups, multiple values', () => {
      const result = parseQuery([
        { type: 'sql', condition: `service IN ('z', 'y', 'x')` },
        { type: 'sql', condition: `level IN ('info', 'error')` },
        { type: 'sql', condition: `type IN ('event')` },
      ]);
      expect(result.filters).toEqual({
        service: new Set(['z', 'y', 'x']),
        level: new Set(['info', 'error']),
        type: new Set(['event']),
      });
    });

    it('skips non-supported filters', () => {
      const result = parseQuery([{ type: 'lucene', condition: `app:*` }]);
      expect(result.filters).toEqual({});
    });
  });

  describe('areFiltersEqual', () => {
    it('should return true for equal filters', () => {
      const a = { a: new Set(['b']) };
      const b = { a: new Set(['b']) };
      expect(areFiltersEqual(a, b)).toBe(true);
    });

    it('should return false for different filters', () => {
      const a = { a: new Set(['b']) };
      const b = { a: new Set(['c']) };
      expect(areFiltersEqual(a, b)).toBe(false);
    });

    it('should return true for equal filters in different order', () => {
      const a = {
        service: new Set(['a', 'b']),
        level: new Set(['info', 'error']),
        type: new Set<string>(),
      };
      const b = {
        level: new Set(['error', 'info']),
        service: new Set(['b', 'a']),
        type: new Set<string>(),
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
        service: new Set(['hdx-oss-dev-app']),
        hyperdx_event_type: new Set(['span']),
        level: new Set(['info', 'ok']),
      });
    });
  });
});
