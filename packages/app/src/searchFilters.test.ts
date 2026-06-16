import { enableMapSet } from 'immer';
import { Filter } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import { useSearchPageFilterState } from '@/searchFilters';

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
