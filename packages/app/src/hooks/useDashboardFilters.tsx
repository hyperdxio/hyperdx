import { useCallback, useMemo } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

import { FilterState, filtersToQuery, parseQuery } from '@/searchFilters';

const useDashboardFilters = (filters: DashboardFilter[]) => {
  const [filterQueries, setFilterQueries] = useQueryState(
    'filters',
    parseAsJson<Filter[]>(),
  );

  const setFilterValue = useCallback(
    (expression: string, value: string | null) => {
      setFilterQueries(prev => {
        const { filters: filterValues } = parseQuery(prev ?? []);
        if (value === undefined || value === null) {
          delete filterValues[expression];
        } else {
          filterValues[expression] = {
            included: new Set([value]),
            excluded: new Set(),
          };
        }

        return filtersToQuery(
          filterValues,
          { stringifyKeys: false }, // Don't wrap keys with toString(), to preserve exact key names in URL query parameters
        );
      });
    },
    [setFilterQueries],
  );

  const { valuesForExistingFilters, queriesForExistingFilters } =
    useMemo(() => {
      const { filters: parsedFilters } = parseQuery(filterQueries ?? []);
      const valuesForExistingFilters: FilterState = {};

      for (const { expression } of filters) {
        if (expression in parsedFilters) {
          valuesForExistingFilters[expression] = parsedFilters[expression];
        }
      }

      return {
        valuesForExistingFilters,
        queriesForExistingFilters: filtersToQuery(
          valuesForExistingFilters,
          // Wrap keys in `toString()` to support JSON/Dynamic-type columns.
          // All keys can be stringified, since filter select values are stringified as well.
          { stringifyKeys: true },
        ),
      };
    }, [filterQueries, filters]);

  return {
    filterValues: valuesForExistingFilters,
    filterQueries: queriesForExistingFilters,
    setFilterValue,
    setFilterQueries,
  };
};

export default useDashboardFilters;
