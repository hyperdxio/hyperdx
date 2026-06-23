import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
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
    filtersByExpression,
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

    // Multiple filter definitions may share the same expression but each
    // declare a different `appliesToSourceIds` scope.
    const filtersByExpression = new Map<string, DashboardFilter[]>();
    for (const f of filters) {
      const existing = filtersByExpression.get(f.expression);
      if (existing) {
        existing.push(f);
      } else {
        filtersByExpression.set(f.expression, [f]);
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
      filtersByExpression,
    };
  }, [filterQueries, filters]);

  // Return only the filter queries that should be applied to a tile whose
  // source is `sourceId`. When multiple filter definitions share the same
  // expression, their scopes are unioned: the filter value applies if ANY
  // sibling is unscoped or includes `sourceId`. A filter with no
  // `appliesToSourceIds` (or an empty array) is treated as "applies to all".
  // If `sourceId` is undefined (e.g. a RawSQL tile with no resolvable
  // source), scoped filters are skipped and only unscoped filters are
  // returned.
  const getFilterQueriesForSource = useCallback(
    (sourceId: string | undefined): Filter[] => {
      const scoped: FilterState = {};
      for (const [expression, state] of Object.entries(
        valuesForExistingFilters,
      )) {
        const definitions = filtersByExpression.get(expression) ?? [];
        const applies = definitions.some(def => {
          const appliesTo = def.appliesToSourceIds;
          if (!appliesTo || appliesTo.length === 0) return true;
          return !!sourceId && appliesTo.includes(sourceId);
        });
        if (applies) {
          scoped[expression] = state;
        }
      }
      // Wrap keys in `toString()` to support JSON/Dynamic-type columns,
      // consistent with the transformation applied in `queriesForExistingFilters` above.
      return filtersToQuery(scoped, { stringifyKeys: true });
    },
    [valuesForExistingFilters, filtersByExpression],
  );

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
    /**
     * Returns the subset of filter queries that should apply to a tile whose
     * source is `sourceId`. Filters with no `appliesToSourceIds` apply to all
     * tiles. Filters with `appliesToSourceIds` defined apply only to tiles
     * whose source ID is in the list.
     */
    getFilterQueriesForSource,
  };
};

export default useDashboardFilters;
