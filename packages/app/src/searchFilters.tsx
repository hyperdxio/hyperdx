import React from 'react';
import produce from 'immer';
import { Filter } from '@hyperdx/common-utils/dist/renderChartConfig';

export type FilterState = {
  [key: string]: Set<string>;
};

export const filtersToQuery = (filters: FilterState): Filter[] => {
  return Object.entries(filters)
    .filter(([_, values]) => values.size > 0)
    .map(([key, values]) => {
      return {
        type: 'sql',
        condition: `${key} IN (${Array.from(values)
          .map(v => `'${v}'`)
          .join(', ')})`,
      };
    });
};

export const areFiltersEqual = (a: FilterState, b: FilterState) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!b[key] || a[key].size !== b[key].size) {
      return false;
    }

    for (const value of a[key]) {
      if (!b[key].has(value)) {
        return false;
      }
    }
  }

  return true;
};

export const parseQuery = (
  q: Filter[],
): {
  filters: FilterState;
} => {
  const state = new Map<string, Set<string>>();
  for (const filter of q) {
    if (filter.type !== 'sql' || filter.condition.indexOf(' IN ') === -1) {
      continue;
    }

    const [key, values] = filter.condition.split(' IN ');
    const keyStr = key.trim();
    const valuesStr = values
      .replace('(', '')
      .replace(')', '')
      .split(',')
      .map(v => v.trim().replace(/'/g, ''));
    state.set(keyStr, new Set(valuesStr));
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
    (property: string, value: string, only?: boolean) => {
      setFilters(prevFilters => {
        const newFilters = produce(prevFilters, draft => {
          if (!draft[property]) {
            draft[property] = new Set();
          }
          // if only is true, set the value as the only value
          if (only) {
            draft[property] = new Set([value]);
            return;
          }
          const values = draft[property];
          if (values.has(value)) {
            values.delete(value);
          } else {
            values.add(value);
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
    setFilters({});
    updateFilterQuery({});
  }, [updateFilterQuery]);

  return {
    filters,
    clearFilter,
    setFilters,
    setFilterValue,
    clearAllFilters,
  };
};
