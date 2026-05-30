import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryState } from 'nuqs';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

import {
  buildConstantExpressionSet,
  normalizeExpression,
} from '@/dashboardFilterUtils';
import { parseQuery } from '@/searchFilters';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

const filterQueriesParser = parseAsJsonEncoded<Filter[]>();

interface UseDashboardFiltersOptions {
  /**
   * The dashboard's saved filter values, in the same Lucene-encoded shape
   * used in the URL. Constant filters (`constant: true`) source their
   * locked value from this array, matched by filter expression.
   * Optional; when omitted, constant filters resolve to no value.
   */
  savedFilterValues?: Filter[] | null;
}

const useDashboardFilters = (
  filters: DashboardFilter[],
  { savedFilterValues }: UseDashboardFiltersOptions = {},
) => {
  const [filterQueries, setFilterQueries] = useQueryState(
    'filters',
    filterQueriesParser,
  );

  // Set of normalized expressions that are locked by `constant: true`.
  // `setFilterValue` skips writes to these, and read paths overlay the
  // saved value regardless of URL state.
  const constantExpressions = useMemo(
    () => buildConstantExpressionSet(filters),
    [filters],
  );

  const setFilterValue = useCallback(
    (expression: string, values: string[]) => {
      // Constant filters cannot be cleared or changed by the viewer; the
      // value is always sourced from `savedFilterValues`.
      if (constantExpressions.has(normalizeExpression(expression))) {
        return;
      }
      setFilterQueries(prev => {
        const { filters: filterValues } = parseQuery(prev ?? []);
        // Normalize the expression to dot notation so it matches the keys
        // returned by parseQuery (which converts bracket notation to dots).
        const key = normalizeExpression(expression);
        if (values.length === 0) {
          delete filterValues[key];
        } else {
          filterValues[key] = {
            included: new Set(values),
            excluded: new Set(),
          };
        }

        return filtersToQuery(filterValues);
      });
    },
    [setFilterQueries, constantExpressions],
  );

  const {
    valuesForExistingFilters,
    queriesForExistingFilters,
    ignoredExpressions,
    filtersByExpression,
  } = useMemo(() => {
    const { filters: parsedFilters } = parseQuery(filterQueries ?? []);
    const valuesForExistingFilters: FilterState = {};
    const ignored: string[] = [];

    const normalizedParsed = new Map(
      Object.entries(parsedFilters).map(([k, v]) => [
        normalizeExpression(k),
        v,
      ]),
    );
    const knownNormalized = new Set(
      filters.map(f => normalizeExpression(f.expression)),
    );

    // Build a normalized lookup of saved filter values so constant filters
    // can resolve their locked value regardless of URL state. Saved values
    // are stored in the same Lucene-encoded shape as URL filters, so the
    // same parser produces the same expression-keyed FilterState.
    const { filters: parsedSaved } = parseQuery(savedFilterValues ?? []);
    const normalizedSaved = new Map(
      Object.entries(parsedSaved).map(([k, v]) => [normalizeExpression(k), v]),
    );

    for (const { expression, constant } of filters) {
      const norm = normalizeExpression(expression);
      // Constant filters always source their value from savedFilterValues,
      // ignoring any URL state on the same expression. This is what makes
      // the value "locked": the viewer cannot override it via the URL.
      const savedMatch = constant ? normalizedSaved.get(norm) : undefined;
      const urlMatch = constant ? undefined : normalizedParsed.get(norm);
      const match = savedMatch ?? urlMatch;
      if (match) {
        valuesForExistingFilters[expression] = match;
      }
    }
    for (const key of Object.keys(parsedFilters)) {
      const norm = normalizeExpression(key);
      if (!knownNormalized.has(norm)) {
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
      queriesForExistingFilters: filtersToQuery(valuesForExistingFilters),
      ignoredExpressions: ignored,
      filtersByExpression,
    };
  }, [filterQueries, filters, savedFilterValues]);

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
      return filtersToQuery(scoped);
    },
    [valuesForExistingFilters, filtersByExpression],
  );

  // Migrate legacy SQL filters in the URL to Lucene on load
  const hasMigratedRef = useRef(false);
  useEffect(() => {
    if (hasMigratedRef.current || !filterQueries) return;
    const hasSqlFilters = filterQueries.some(
      f => 'condition' in f && f.type === 'sql',
    );
    if (hasSqlFilters) {
      hasMigratedRef.current = true;
      const { filters: parsed, passthroughFilters } = parseQuery(filterQueries);
      setFilterQueries([...filtersToQuery(parsed), ...passthroughFilters]);
    }
  }, [filterQueries, setFilterQueries]);

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
