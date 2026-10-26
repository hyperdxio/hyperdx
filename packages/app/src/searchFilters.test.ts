import { enableMapSet } from 'immer';
import { Filter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import { parseQuery, useSearchPageFilterState } from '@/searchFilters';

// Filter state stores values in Sets; the app enables immer's MapSet plugin at
// startup, but this isolated hook test must enable it explicitly.
enableMapSet();

// Stable reference so the hook's parsed-query effect does not re-run and reset
// local filter state between renders (the empty default is a new array each
// render).
const EMPTY_SEARCH_QUERY: Filter[] = [];

describe('useSearchPageFilterState replaceFilterValue', () => {
  it('swaps an included value for a new one, preserving included polarity', () => {
    const onFilterChange = jest.fn();
    const { result } = renderHook(() =>
      useSearchPageFilterState({
        searchQuery: EMPTY_SEARCH_QUERY,
        onFilterChange,
        knownColumns: new Set(),
      }),
    );

    act(() => {
      result.current.setFilterValue('status', '200');
    });
    act(() => {
      result.current.replaceFilterValue('status', '200', '404', 'include');
    });

    expect([...result.current.filters.status.included]).toEqual(['404']);
    expect([...result.current.filters.status.excluded]).toEqual([]);
  });

  it('swaps an excluded value for a new one, preserving excluded polarity', () => {
    const onFilterChange = jest.fn();
    const { result } = renderHook(() =>
      useSearchPageFilterState({
        searchQuery: EMPTY_SEARCH_QUERY,
        onFilterChange,
        knownColumns: new Set(),
      }),
    );

    act(() => {
      result.current.setFilterValue('status', '500', 'exclude');
    });
    act(() => {
      result.current.replaceFilterValue('status', '500', '502', 'exclude');
    });

    expect([...result.current.filters.status.excluded]).toEqual(['502']);
    expect([...result.current.filters.status.included]).toEqual([]);
  });

  it('emits onFilterChange exactly once per replace', () => {
    const onFilterChange = jest.fn();
    const { result } = renderHook(() =>
      useSearchPageFilterState({
        searchQuery: EMPTY_SEARCH_QUERY,
        onFilterChange,
        knownColumns: new Set(),
      }),
    );

    act(() => {
      result.current.setFilterValue('status', '200');
    });
    onFilterChange.mockClear();
    act(() => {
      result.current.replaceFilterValue('status', '200', '404', 'include');
    });

    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });
});

describe('canonical key escaping at the persistence boundary', () => {
  // In-memory FilterState keys stay clean (what the sidebar/comparisons use);
  // the persisted Filter[] handed to onFilterChange (URL + saved search) carries
  // the canonical backtick-quoted/bracket ClickHouse key.

  describe('parseQuery stays verbatim (no key transformation)', () => {
    it('keeps an already-quoted leading key as-is', () => {
      const result = parseQuery([
        { type: 'sql', condition: "`service-name` IN ('a')" },
      ]);
      expect(result.filters).toEqual({
        '`service-name`': { included: new Set(['a']), excluded: new Set() },
      });
    });

    it('keeps a dot-form key as-is (dashboards rely on verbatim keys)', () => {
      const result = parseQuery([
        { type: 'sql', condition: "service.name IN ('a')" },
      ]);
      expect(result.filters).toEqual({
        'service.name': { included: new Set(['a']), excluded: new Set() },
      });
    });
  });

  describe('useSearchPageFilterState', () => {
    // Stable references so the hook's parsed-query effect doesn't reset local
    // filter state between renders.
    const HYPHEN_COLUMNS = new Set(['service-name']);
    const MAP_COLUMNS = new Set(['my-map']);
    const PLAIN_COLUMNS = new Set(['ServiceName']);

    it('keeps the FilterState key clean but emits a quoted key to the URL', () => {
      const onFilterChange = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: EMPTY_SEARCH_QUERY,
          onFilterChange,
          knownColumns: HYPHEN_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue('service-name', 'a');
      });

      // in-memory: clean
      expect(Object.keys(result.current.filters)).toEqual(['service-name']);
      // persisted: canonical/escaped
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: "`service-name` IN ('a')" },
      ]);
    });

    it('escapes a Map sub-key (quoted root) for the persisted query only', () => {
      const onFilterChange = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: EMPTY_SEARCH_QUERY,
          onFilterChange,
          knownColumns: MAP_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue("my-map['k']", 'v');
      });

      expect(Object.keys(result.current.filters)).toEqual(["my-map['k']"]);
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: "`my-map`['k'] IN ('v')" },
      ]);
    });

    it('leaves a plain column unquoted in both forms', () => {
      const onFilterChange = jest.fn();
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery: EMPTY_SEARCH_QUERY,
          onFilterChange,
          knownColumns: PLAIN_COLUMNS,
        }),
      );

      act(() => {
        result.current.setFilterValue('ServiceName', 'a');
      });

      expect(Object.keys(result.current.filters)).toEqual(['ServiceName']);
      expect(onFilterChange).toHaveBeenLastCalledWith([
        { type: 'sql', condition: "ServiceName IN ('a')" },
      ]);
    });

    it('unescapes a quoted key loaded from the URL back into clean FilterState', () => {
      const onFilterChange = jest.fn();
      const searchQuery: Filter[] = [
        { type: 'sql', condition: "`service-name` IN ('a')" },
      ];
      const { result } = renderHook(() =>
        useSearchPageFilterState({
          searchQuery,
          onFilterChange,
          knownColumns: HYPHEN_COLUMNS,
        }),
      );

      expect(Object.keys(result.current.filters)).toEqual(['service-name']);
      expect([...result.current.filters['service-name'].included]).toEqual([
        'a',
      ]);
    });
  });
});
