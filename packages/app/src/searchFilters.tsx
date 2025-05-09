import React from 'react';
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
  [key: string]: string[];
};

export type FilterStateHook = ReturnType<typeof useSearchPageFilterState>;

function usePinnedFilterBySource(sourceId: string | null) {
  // Eventually replace pinnedFilters with a GET from api/mongo
  // Eventually replace setPinnedFilters with a POST to api/mongo
  const [_pinnedFilters, _setPinnedFilters] = useLocalStorage<{
    [sourceId: string]: PinnedFilters;
  }>('hdx-pinned-search-filters', {});

  const pinnedFilters = React.useMemo<PinnedFilters>(
    () =>
      !sourceId || !_pinnedFilters[sourceId] ? {} : _pinnedFilters[sourceId],
    [_pinnedFilters, sourceId],
  );
  const setPinnedFilters = React.useCallback<
    (val: PinnedFilters | ((pf: PinnedFilters) => PinnedFilters)) => void
  >(
    val => {
      if (!sourceId) return;
      _setPinnedFilters(prev =>
        produce(prev, draft => {
          draft[sourceId] =
            val instanceof Function ? val(draft[sourceId] ?? {}) : val;
        }),
      );
    },
    [sourceId, _setPinnedFilters],
  );
  return { pinnedFilters, setPinnedFilters };
}

export function usePinnedFilters(sourceId: string | null) {
  const { pinnedFilters, setPinnedFilters } = usePinnedFilterBySource(sourceId);

  const toggleFilterPin = React.useCallback(
    (property: string, value: string) => {
      setPinnedFilters(prevPins =>
        produce(prevPins, draft => {
          if (!draft[property]) {
            draft[property] = [];
          }
          const idx = draft[property].findIndex(v => v === value);
          if (idx >= 0) {
            draft[property].splice(idx);
          } else {
            draft[property].push(value);
          }
          return draft;
        }),
      );
    },
    [setPinnedFilters],
  );

  const isFilterPinned = React.useCallback(
    (property: string, value: string): boolean => {
      return (
        pinnedFilters[property] &&
        pinnedFilters[property].some(v => v === value)
      );
    },
    [pinnedFilters],
  );

  return {
    toggleFilterPin,
    isFilterPinned,
  };
}
