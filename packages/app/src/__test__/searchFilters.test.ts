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
      expect(filtersToQuery(filters)).toBe('');
    });

    it('should return query for one filter', () => {
      const filters = { a: new Set(['b']) };
      expect(filtersToQuery(filters)).toBe('((a:"b"))');
    });

    it('should return query for multiple filters', () => {
      const filters = { a: new Set(['b']), c: new Set(['d']) };
      expect(filtersToQuery(filters)).toBe('((a:"b") AND (c:"d"))');
    });
  });

  describe('parseQuery', () => {
    it('empty query', () => {
      const result = parseQuery('');
      expect(result.filters).toEqual({});
    });

    it('user query only', () => {
      const result = parseQuery('foo');
      expect(result.filters).toEqual({});
    });

    it('user query only, complex', () => {
      const q = '(foo AND service:"bar") OR baz';
      const result = parseQuery(q);
      expect(result.filters).toEqual({});
    });

    it('parses one filter', () => {
      const result = parseQuery('((service:"z"))');
      expect(result.filters).toEqual({ service: new Set(['z']) });
    });

    it('parses one filter with user query, left', () => {
      const result = parseQuery('user query here ((service:"z"))');
      expect(result.filters).toEqual({ service: new Set(['z']) });
    });

    it('parses one filter with user query, right', () => {
      const result = parseQuery('((service:"z")) user query here');
      expect(result.filters).toEqual({ service: new Set(['z']) });
    });

    it('parses 1 group, multiple values', () => {
      const result = parseQuery(
        '((service:"z" OR service:"y" OR service:"x"))',
      );
      expect(result.filters).toEqual({ service: new Set(['z', 'y', 'x']) });
    });

    it('parses 3 groups, multiple values', () => {
      const result = parseQuery(
        '((service:"z" OR service:"y" OR service:"x") AND (level:"info" OR level:"error") AND (type:"event"))',
      );
      expect(result.filters).toEqual({
        service: new Set(['z', 'y', 'x']),
        level: new Set(['info', 'error']),
        type: new Set(['event']),
      });
    });

    it('throws when filter query is invalid', () => {
      try {
        parseQuery(
          '((service:"z" OR level:"y" OR service:"x") AND (level:"info" OR level:"error") AND (type:"event"))',
        );
        expect(false).toBe(true); // should not reach here
      } catch (e) {
        expect(e.message).not.toBeNull();
      }
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
    const onSearchQueryChange = jest.fn();

    it('adding filter to empty query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: '',
          onSearchQueryChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'app');
        result.current.setFilterValue('level', 'error');
      });

      expect(onSearchQueryChange).toHaveBeenLastCalledWith(
        '((service:"app") AND (level:"error"))',
      );
    });

    it('adding filter to existing user query, left', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: 'user query here',
          onSearchQueryChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'app');
        result.current.setFilterValue('level', 'error');
        result.current.setFilterValue('service', 'app'); // deselect
      });

      expect(onSearchQueryChange).toHaveBeenLastCalledWith(
        'user query here ((level:"error"))',
      );
    });

    it('updating filter query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery:
            '((service:"hdx-oss-dev-app") AND (hyperdx_event_type:"span") AND (level:"info" OR level:"ok"))',
          onSearchQueryChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'hdx-oss-dev-app'); // deselect
        result.current.setFilterValue('another_facet', 'some_value');
      });

      expect(onSearchQueryChange).toHaveBeenLastCalledWith(
        '((hyperdx_event_type:"span") AND (level:"info" OR level:"ok") AND (another_facet:"some_value"))',
      );
    });

    it('updating filter query with user query on both sides', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery:
            'user query here ((service:"hdx-oss-dev-app")) user query here',
          onSearchQueryChange,
        }),
      );

      act(() => {
        result.current.setFilterValue('service', 'hdx-oss-dev-app'); // deselect
        result.current.setFilterValue('another_facet', 'some_value');
      });

      expect(onSearchQueryChange).toHaveBeenLastCalledWith(
        'user query here ((another_facet:"some_value")) user query here',
      );
    });

    it('clearing filter', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery:
            '((service:"hdx-oss-dev-app") AND (hyperdx_event_type:"span") AND (level:"info" OR level:"ok"))',
          onSearchQueryChange,
        }),
      );

      act(() => {
        result.current.clearFilter('level');
      });

      expect(onSearchQueryChange).toHaveBeenLastCalledWith(
        '((service:"hdx-oss-dev-app") AND (hyperdx_event_type:"span"))',
      );
    });

    it('correctly hydrates filter state from query', () => {
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery:
            'some user query here ((service:"hdx-oss-dev-app") AND (hyperdx_event_type:"span") AND (level:"info" OR level:"ok")) do not mind me',
          onSearchQueryChange,
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
