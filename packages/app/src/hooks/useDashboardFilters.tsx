import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
import { parseKeyPath } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

import { parseQuery } from '@/searchFilters';
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

        return filtersToQuery(filterValues);
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
    const ignored: string[] = [];

    // Build a normalized lookup so bracket-notation expressions
    // (e.g. SpanAttributes['k8s.pod.name']) match the dot-notation keys
    // returned by parseLuceneFilter (e.g. SpanAttributes.k8s.pod.name).
    const normalizeKey = (k: string) => parseKeyPath(k).join('.');
    const normalizedParsed = new Map(
      Object.entries(parsedFilters).map(([k, v]) => [normalizeKey(k), v]),
    );
    const knownNormalized = new Set(
      filters.map(f => normalizeKey(f.expression)),
    );

    for (const { expression } of filters) {
      const norm = normalizeKey(expression);
      const match = normalizedParsed.get(norm);
      if (match) {
        valuesForExistingFilters[expression] = match;
      }
    }
    for (const key of Object.keys(parsedFilters)) {
      if (!knownNormalized.has(normalizeKey(key))) {
        ignored.push(key);
      }
    }

    return {
      valuesForExistingFilters,
      queriesForExistingFilters: filtersToQuery(valuesForExistingFilters),
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
