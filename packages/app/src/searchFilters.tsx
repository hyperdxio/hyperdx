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

export const parseQuery = (
  q: string,
): {
  userQuery: string;
  filters: FilterState;
} => {
  let userQuery = '';
  const filters: FilterState = {};

  // Filter string always starts and ends with double parentheses
  const startPos = q.indexOf('((');
  const endPos = q.lastIndexOf('))');

  // No filter string
  if (startPos === -1 && endPos === -1) {
    return { userQuery: q, filters };
  }

  // User query can be either before or after the filter query
  if (startPos > 0) {
    userQuery = q.slice(0, startPos).trim();
  }
  if (endPos < q.length - 2) {
    userQuery += q.slice(endPos + 2).trim();
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

  return { userQuery, filters };
};

export const useSearchPageFilterState = ({
  searchQuery = '',
}: {
  searchQuery?: string;
}) => {
  const [filters, setFilters] = React.useState<FilterState>({});

  const filtersQuery = React.useMemo(() => filtersToQuery(filters), [filters]);

  const parsedQuery = React.useMemo(() => {
    try {
      return parseQuery(searchQuery);
    } catch (e) {
      console.error(e);
      return { userQuery: searchQuery, filters: {} };
    }
  }, [searchQuery]);

  React.useEffect(() => {
    if (filtersQuery && searchQuery.includes(filtersQuery)) {
      return;
    }
    setFilters(parsedQuery.filters);
  }, [filtersQuery, parsedQuery, searchQuery]);

  const setFilterValue = React.useCallback(
    (property: string, value: string, only?: boolean) => {
      setFilters(prevFilters =>
        produce(prevFilters, draft => {
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
        }),
      );
    },
    [setFilters],
  );

  const clearFilter = React.useCallback((property: string) => {
    setFilters(prevFilters =>
      produce(prevFilters, draft => {
        delete draft[property];
      }),
    );
  }, []);

  return {
    filters,
    clearFilter,
    setFilters,
    setFilterValue,
    filtersQuery,
    userQuery: parsedQuery.userQuery,
  };
};
