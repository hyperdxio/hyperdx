import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
import {
  FilterState,
  filtersToQuery,
  getDashboardVariableDeclarations,
  isFilterBroadcastEnabled,
} from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
  DashboardFilterValue,
  Filter,
} from '@hyperdx/common-utils/dist/types';

import { parseQuery } from '@/searchFilters';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

export const filterQueriesParser = parseAsJsonEncoded<DashboardFilterValue[]>();

/**
 * Narrow the persisted entries to the ones the expression-keyed reader
 * understands. Variable-keyed entries are not read or written here yet.
 */
const expressionKeyedEntries = (
  entries: DashboardFilterValue[] | null | undefined,
): Filter[] =>
  (entries ?? []).filter((entry): entry is Filter => entry.type !== 'variable');

/**
 * Whether a filter definition broadcasts its selected value onto a tile
 * whose source is `sourceId`.
 */
const definitionAppliesToSource = (
  definition: DashboardFilter,
  sourceId: string | undefined,
): boolean => {
  if (!isFilterBroadcastEnabled(definition)) return false;
  const appliesTo = definition.appliesToSourceIds;
  if (!appliesTo || appliesTo.length === 0) return true;
  return !!sourceId && appliesTo.includes(sourceId);
};

const useDashboardFilters = (filters: DashboardFilter[]) => {
  const [filterQueries, setFilterQueries] = useQueryState(
    'filters',
    filterQueriesParser,
  );

  const setFilterValue = useCallback(
    (expression: string, values: string[]) => {
      setFilterQueries(prev => {
        const { filters: filterValues } = parseQuery(
          expressionKeyedEntries(prev),
        );
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
    variables,
  } = useMemo(() => {
    const { filters: parsedFilters } = parseQuery(
      expressionKeyedEntries(filterQueries),
    );
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

    const broadcastValues: FilterState = {};
    for (const [expression, state] of Object.entries(
      valuesForExistingFilters,
    )) {
      const definitions = filtersByExpression.get(expression) ?? [];
      if (definitions.some(isFilterBroadcastEnabled)) {
        broadcastValues[expression] = state;
      }
    }

    const variables: ChartVariable[] = getDashboardVariableDeclarations(
      filters,
    ).map(definition => {
      const selection = definition.expression
        ? valuesForExistingFilters[definition.expression]
        : undefined;
      return {
        ...definition,
        values: selection
          ? Array.from(selection.included).map(String).sort() // Sorted for deterministic react-query keys
          : [],
      };
    });

    return {
      valuesForExistingFilters,
      variables,
      queriesForExistingFilters: filtersToQuery(
        broadcastValues,
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
  // sibling broadcasts to `sourceId`. A filter with no `appliesToSourceIds`
  // (or an empty array) is treated as "applies to all"; a filter with
  // broadcasting disabled applies to nothing. If `sourceId` is undefined
  // (e.g. a RawSQL tile with no resolvable source), scoped filters are
  // skipped and only unscoped filters are returned.
  const getFilterQueriesForSource = useCallback(
    (sourceId: string | undefined): Filter[] => {
      const scoped: FilterState = {};
      for (const [expression, state] of Object.entries(
        valuesForExistingFilters,
      )) {
        const definitions = filtersByExpression.get(expression) ?? [];
        const applies = definitions.some(def =>
          definitionAppliesToSource(def, sourceId),
        );
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
    /**
     * Queries for the broadcasting filters, unscoped by source. Callers with a
     * per-tile source should prefer `getFilterQueriesForSource`.
     */
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
     * whose source ID is in the list. Filters with broadcasting disabled
     * apply to no tiles at all.
     */
    getFilterQueriesForSource,
    /** The dashboard's variable-enabled filters and their currently selected values. */
    variables,
  };
};

export default useDashboardFilters;
