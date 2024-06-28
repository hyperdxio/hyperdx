import React from 'react';
import produce from 'immer';

export type FilterState = {
  [key: string]: Set<string>;
};

const parenthesize = (s: string) => (s.length ? `(${s})` : '');

export const filtersToQuery = (filters: FilterState) => {
  const query = Object.entries(filters)
    .map(([property, values]) => {
      const v = Array.from(values)
        .map(value => `${property}:"${value}"`)
        .filter(Boolean)
        .join(' OR ');
      return parenthesize(v);
    })
    .filter(Boolean)
    .join(' AND ');

  return parenthesize(query);
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
  q: string,
): {
  filters: FilterState;
  filterQueryPosition?: [number, number];
} => {
  const filters: FilterState = {};

  // Filter string always starts and ends with double parentheses
  const startPos = q.indexOf('((');
  const endPos = q.lastIndexOf('))');

  // No filter string
  if (startPos === -1 && endPos === -1) {
    return { filters };
  }

  // Parse filter string
  const filterString = q.slice(startPos + 2, endPos);
  const filterGroups = filterString.split(') AND (');

  for (const groupString of filterGroups) {
    let propertyName = '';
    const values = groupString.split(' OR ');
    for (const valueString of values) {
      // valueString is in the format 'property:"value"'
      const [property, value] = valueString.split(':');
      if (!propertyName) {
        propertyName = property;
      } else if (propertyName !== property) {
        throw new Error(
          `Invalid filter string, expected ${propertyName} but got ${property}`,
        );
      }
      const unquotedValue = value?.replaceAll('"', '');
      if (!filters[propertyName]) {
        filters[propertyName] = new Set();
      }
      filters[propertyName].add(unquotedValue);
    }
  }

  return {
    filters,
    filterQueryPosition: startPos === -1 ? undefined : [startPos, endPos + 2],
  };
};

export const useSearchPageFilterState = ({
  searchQuery = '',
  onSearchQueryChange,
}: {
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}) => {
  const [filters, setFilters] = React.useState<FilterState>({});

  const parsedQuery = React.useMemo(() => {
    try {
      return parseQuery(searchQuery);
    } catch (e) {
      console.error(e);
      return { filters: {} };
    }
  }, [searchQuery]);

  const updateFilterQuery = React.useCallback(
    (newFilters: FilterState) => {
      const { filterQueryPosition } = parsedQuery;

      let newQuery = '';
      if (!filterQueryPosition) {
        // append the filter query to the end of the user query
        newQuery = [searchQuery.trim(), filtersToQuery(newFilters)]
          .filter(Boolean)
          .join(' ');
      } else {
        const [start, end] = filterQueryPosition;
        newQuery = [
          searchQuery.slice(0, start).trim(),
          filtersToQuery(newFilters),
          searchQuery.slice(end).trim(),
        ]
          .filter(Boolean)
          .join(' ');
      }
      onSearchQueryChange?.(newQuery);
    },
    [onSearchQueryChange, parsedQuery, searchQuery],
  );

  React.useEffect(() => {
    if (!areFiltersEqual(filters, parsedQuery.filters)) {
      setFilters(parsedQuery.filters);
    }
    // only react to changes in parsed query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedQuery.filters]);

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

  return {
    filters,
    clearFilter,
    setFilters,
    setFilterValue,
  };
};
