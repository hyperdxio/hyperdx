import React, { useCallback, useEffect } from 'react';
import produce from 'immer';
import type { Filter } from '@hyperdx/common-utils/dist/types';

import { useLocalStorage } from './utils';

export type FilterState = {
  [key: string]: {
    included: Set<string>;
    excluded: Set<string>;
  };
};

export const filtersToQuery = (filters: FilterState): Filter[] => {
  return Object.entries(filters)
    .filter(
      ([_, values]) => values.included.size > 0 || values.excluded.size > 0,
    )
    .flatMap(([key, values]) => {
      const conditions = [];
      if (values.included.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${key} IN (${Array.from(values.included)
            .map(v => `'${v}'`)
            .join(', ')})`,
        });
      }
      if (values.excluded.size > 0) {
        conditions.push({
          type: 'sql' as const,
          condition: `${key} NOT IN (${Array.from(values.excluded)
            .map(v => `'${v}'`)
            .join(', ')})`,
        });
      }
      return conditions;
    });
};

export const areFiltersEqual = (a: FilterState, b: FilterState) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!b[key]) return false;

    // Check included values
    if (a[key].included.size !== b[key].included.size) return false;
    for (const value of a[key].included) {
      if (!b[key].included.has(value)) return false;
    }

    // Check excluded values
    if (a[key].excluded.size !== b[key].excluded.size) return false;
    for (const value of a[key].excluded) {
      if (!b[key].excluded.has(value)) return false;
    }
  }

  return true;
};

export const parseQuery = (
  q: Filter[],
): {
  filters: FilterState;
} => {
  const state = new Map<
    string,
    { included: Set<string>; excluded: Set<string> }
  >();
  for (const filter of q) {
    if (filter.type !== 'sql') continue;

    const isExclude = filter.condition.includes('NOT IN');
    const [key, values] = filter.condition.split(
      isExclude ? ' NOT IN ' : ' IN ',
    );
    const keyStr = key.trim();
    const valuesStr = values
      .replace('(', '')
      .replace(')', '')
      .split(',')
      .map(v => v.trim().replace(/'/g, ''));

    if (!state.has(keyStr)) {
      state.set(keyStr, { included: new Set(), excluded: new Set() });
    }
    const sets = state.get(keyStr)!;
    valuesStr.forEach(v => {
      if (isExclude) {
        sets.excluded.add(v);
      } else {
        sets.included.add(v);
      }
    });
  }
  return { filters: Object.fromEntries(state) };
};

export const useSearchPageFilterState = ({
  searchQuery = [],
  onFilterChange,
}: {
  searchQuery?: Filter[];
  onFilterChange: (filters: Filter[]) => void;
}) => {
  const parsedQuery = React.useMemo(() => {
    try {
      return parseQuery(searchQuery);
    } catch (e) {
      console.error(e);
      return { filters: {} };
    }
  }, [searchQuery]);

  const [filters, setFilters] = React.useState<FilterState>({});

  React.useEffect(() => {
    if (
      !areFiltersEqual(filters, parsedQuery.filters) &&
      Object.values(parsedQuery.filters).length > 0
    ) {
      setFilters(parsedQuery.filters);
    }
    // only react to changes in parsed query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedQuery.filters]);

  const updateFilterQuery = React.useCallback(
    (newFilters: FilterState) => {
      onFilterChange(filtersToQuery(newFilters));
    },
    [onFilterChange],
  );

  const setFilterValue = React.useCallback(
    (
      property: string,
      value: string,
      action?: 'only' | 'exclude' | 'include',
    ) => {
      setFilters(prevFilters => {
        const newFilters = produce(prevFilters, draft => {
          if (!draft[property]) {
            draft[property] = { included: new Set(), excluded: new Set() };
          }

          if (action === 'only') {
            draft[property] = {
              included: new Set([value]),
              excluded: new Set(),
            };
            return;
          }

          if (action === 'exclude') {
            // Remove from included if it was there
            draft[property].included.delete(value);
            // Toggle in excluded
            if (draft[property].excluded.has(value)) {
              draft[property].excluded.delete(value);
            } else {
              draft[property].excluded.add(value);
            }
            return;
          }

          // Regular toggle (include)
          draft[property].excluded.delete(value);
          if (draft[property].included.has(value)) {
            draft[property].included.delete(value);
          } else {
            draft[property].included.add(value);
          }
        });
        updateFilterQuery(newFilters);
        return newFilters;
      });
    },
    [updateFilterQuery],
  );

  const clearFilter = React.useCallback(
    (property: string) => {
      setFilters(prevFilters => {
        const newFilters = produce(prevFilters, draft => {
          delete draft[property];
        });
        updateFilterQuery(newFilters);
        return newFilters;
      });
    },
    [updateFilterQuery],
  );

  const clearAllFilters = React.useCallback(() => {
    setFilters(() => ({}));
    updateFilterQuery({});
  }, [updateFilterQuery]);

  return {
    filters,
    setFilters,
    setFilterValue,
    clearFilter,
    clearAllFilters,
  };
};

type PinnedFilters = {
  [key: string]: {
    value: string;
    mode: 'include' | 'exclude';
  }[];
};

export type FilterStateHook = ReturnType<typeof useSearchPageFilterState>;

export function usePinnedFilters({
  filters,
  setFilterValue,
  _clearAllFilters,
  _clearFilter,
  sourceId,
}: {
  filters: FilterStateHook['filters'];
  setFilterValue: FilterStateHook['setFilterValue'];
  _clearAllFilters: FilterStateHook['clearAllFilters'];
  _clearFilter: FilterStateHook['clearFilter'];
  sourceId?: string;
}) {
  ////////////////////////////////////////////////////////
  // State Functions
  ////////////////////////////////////////////////////////
  // Eventually replace pinnedFilters with a GET from api/mongo
  // Eventually replace setPinnedFilters with a POST to api/mongo
  const [pinnedFilters, setPinnedFilters] = useLocalStorage<PinnedFilters>(
    'hdx-pinned-search-filters',
    {},
  );
  const [isPinnedFiltersActive, _setPinnedFiltersActive] =
    useLocalStorage<boolean>('hdx-pinned-search-filters-active', false);

  useEffect(() => {
    if (!sourceId) return;
    _clearAllFilters();
  }, [sourceId]);

  ////////////////////////////////////////////////////////
  // Helper Functions
  ////////////////////////////////////////////////////////
  const currentFilterMode = useCallback(
    (property: string, value: string): 'include' | 'exclude' | null => {
      if (!filters[property]) return null;
      if (filters[property].included.has(value)) return 'include';
      if (filters[property].excluded.has(value)) return 'exclude';
      return null;
    },
    [filters],
  );

  ////////////////////////////////////////////////////////
  // Business Functions
  ////////////////////////////////////////////////////////
  const setPinnedFilterValue = useCallback(
    (property: string, value: string) => {
      let mode = currentFilterMode(property, value);
      // if the pin is directly clicked without the checkbox clicked, apply an
      // 'include' filter
      if (mode === null) {
        mode = 'include';
        setFilterValue(property, value, mode);
      }
      setPinnedFilters(prevPins =>
        produce(prevPins, draft => {
          if (!draft[property]) {
            draft[property] = [];
          }
          if (draft[property].findIndex(v => v.value === value) === -1) {
            draft[property].push({ value, mode: mode! });
          }
          return draft;
        }),
      );
      if (!isPinnedFiltersActive) {
        setPinnedFiltersActive(true);
      }
    },
    [pinnedFilters, setPinnedFilters, setFilterValue],
  );

  const setPinnedFiltersActive = useCallback(
    (val: Parameters<typeof _setPinnedFiltersActive>[0]) => {
      const newIsPinnedFiltersActive =
        val instanceof Function ? val(isPinnedFiltersActive) : val;
      if (newIsPinnedFiltersActive && !isPinnedFiltersActive) {
        // apply all pinned filters
        for (const [property, pins] of Object.entries(pinnedFilters)) {
          for (const pin of pins) {
            if (currentFilterMode(property, pin.value) !== pin.mode) {
              setFilterValue(property, pin.value, pin.mode);
            }
          }
        }
        _setPinnedFiltersActive(() => newIsPinnedFiltersActive);
      } else if (!newIsPinnedFiltersActive && isPinnedFiltersActive) {
        // remove all pinned filters
        for (const [property, pins] of Object.entries(pinnedFilters)) {
          for (const pin of pins) {
            setFilterValue(property, pin.value, pin.mode);
          }
        }
        _setPinnedFiltersActive(() => newIsPinnedFiltersActive);
      }
    },
    [
      _setPinnedFiltersActive,
      setFilterValue,
      pinnedFilters,
      isPinnedFiltersActive,
    ],
  );

  const clearPinnedFilterValue = useCallback(
    (property: string, value: string) => {
      if (!Object.hasOwn(pinnedFilters, property)) return;
      setPinnedFilters(prevFilters =>
        produce(prevFilters, draft => {
          const newArr = draft[property].filter(v => v.value !== value);
          draft[property] = newArr;
          if (draft[property].length === 0) {
            delete draft[property];
          }
          return draft;
        }),
      );
    },
    [pinnedFilters, setPinnedFilters],
  );

  const checkIsFilterValuePinned = useCallback(
    (name: string, _value: string): boolean => {
      return Object.entries(pinnedFilters).some(([filterName, opts]) => {
        return (
          filterName === name && opts.some(({ value }) => value === _value)
        );
      });
    },
    [pinnedFilters],
  );

  // clears specified filters, except for pins if pinning is active
  const clearFilter = useCallback(
    (property: string) => {
      if (!isPinnedFiltersActive) {
        _clearFilter(property);
        return;
      }

      // clear all filters that are not pinned
      const sets = structuredClone(filters[property]);
      for (const value of sets.included.keys()) {
        if (!checkIsFilterValuePinned(property, value)) {
          // toggle includes off
          setFilterValue(property, value, 'include');
        }
      }
      for (const value of sets.excluded.keys()) {
        if (!checkIsFilterValuePinned(property, value)) {
          // toggle excludes off
          setFilterValue(property, value, 'exclude');
        }
      }
    },
    [filters, checkIsFilterValuePinned, setFilterValue],
  );

  // clears filters, except for pins if pinning is active
  const clearAllFilters = useCallback(() => {
    if (!isPinnedFiltersActive) {
      _clearAllFilters();
      return;
    }

    // clear all filters except for those that are pinned
    for (const property of Object.keys(filters)) {
      clearFilter(property);
    }
  }, [isPinnedFiltersActive, _clearAllFilters, clearFilter]);

  return {
    pinnedFilters,
    setPinnedFilterValue,
    clearPinnedFilterValue,
    isPinnedFiltersActive,
    setPinnedFiltersActive,
    checkIsFilterValuePinned,
    clearAllFilters,
    clearFilter,
  };
}
