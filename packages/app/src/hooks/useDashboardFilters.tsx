import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

import { FilterState, filtersToQuery, parseQuery } from '@/searchFilters';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

const filterQueriesParser = parseAsJsonEncoded<Filter[]>();

const useDashboardFilters = (filters: DashboardFilter[]) => {
  const [filterQueries, setFilterQueries] = useQueryState(
    'filters',
    filterQueriesParser,
  );

  const setFilterValue = useCallback(
    (expression: string, values: string[]) => {
      setFilterQueries(prev => {
        const { filters: filterValues } = parseQuery(prev ?? []);
        if (values.length === 0) {
          delete filterValues[expression];
        } else {
          filterValues[expression] = {
            included: new Set(values),
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

  const {
    valuesForExistingFilters,
    queriesForExistingFilters,
    ignoredExpressions,
  } = useMemo(() => {
    const { filters: parsedFilters } = parseQuery(filterQueries ?? []);
    const valuesForExistingFilters: FilterState = {};
    const knownExpressions = new Set(filters.map(f => f.expression));
    const ignored: string[] = [];

    for (const { expression } of filters) {
      if (expression in parsedFilters) {
        valuesForExistingFilters[expression] = parsedFilters[expression];
      }
    }
    for (const key of Object.keys(parsedFilters)) {
      if (!knownExpressions.has(key)) {
        ignored.push(key);
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
      ignoredExpressions: ignored,
    };
  }, [filterQueries, filters]);

  return {
    filterValues: valuesForExistingFilters,
    filterQueries: queriesForExistingFilters,
    setFilterValue,
    setFilterQueries,
    /**
     * Expressions parsed from the URL `filters=` param that don't correspond
     * to any of this dashboard's declared filters — i.e., values that would
     * be silently dropped. Callers can surface a warning.
     */
    ignoredFilterExpressions: ignoredExpressions,
  };
};

export default useDashboardFilters;
