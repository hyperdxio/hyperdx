import { useCallback, useMemo } from 'react';
import { useQueryState } from 'nuqs';
import {
  FilterSelection,
  filterSelectionKey,
  parseDashboardFilterValues,
  ParsedDashboardFilterValues,
  resolveFilterSelection,
  serializeDashboardFilterValues,
} from '@hyperdx/common-utils/dist/dashboardFilterValues';
import {
  FilterState,
  filtersToQuery,
  getDashboardVariableFilters,
  getFilterBroadcastTarget,
  getFilterExpression,
  isFilterBroadcastEnabled,
  isQueryExpressionFilter,
  isStaticListFilter,
} from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
  Filter,
} from '@hyperdx/common-utils/dist/types';

import { dashboardFilterValuesParser } from '@/utils/queryParsers';

/**
 * Whether a filter definition broadcasts its selected value onto a tile
 * whose source is `sourceId`.
 */
const definitionAppliesToSource = (
  definition: DashboardFilter,
  sourceId: string | undefined,
): boolean => {
  const target = getFilterBroadcastTarget(definition);
  if (!target) return false;
  const appliesTo = target.appliesToSourceIds;
  if (!appliesTo || appliesTo.length === 0) return true;
  return !!sourceId && appliesTo.includes(sourceId);
};

const hasSelection = (selection: FilterSelection): boolean =>
  selection.included.size > 0 ||
  selection.excluded.size > 0 ||
  selection.range != null;

/**
 * The variable-keyed format carries a plain list of selected values, so it can
 * only represent an inclusion. An (unsupported) `NOT IN` / `BETWEEN` entry stays
 * expression-keyed.
 */
const isRepresentableAsVariable = (selection: FilterSelection): boolean =>
  selection.excluded.size === 0 && selection.range == null;

/**
 * Rebuild the whole state array from the selections every declared filter
 * currently resolves to. Anything that belongs to no declared filter is
 * carried over untouched.
 */
const rebuildEntries = (
  filters: DashboardFilter[],
  parsed: ParsedDashboardFilterValues,
) => {
  const byExpression: FilterState = {};
  const byVariable = new Map<string, string[]>();
  const declaredExpressions = new Set<string>();
  const declaredVariableNames = new Set<string>();

  for (const filter of filters) {
    const expression = getFilterExpression(filter);
    if (expression) declaredExpressions.add(expression);

    const key = filterSelectionKey(filter);
    if (key.kind !== 'variable') continue;
    declaredVariableNames.add(key.name);
    if (byVariable.has(key.name)) continue; // First definition of a name wins.

    const selection = resolveFilterSelection(filter, parsed);
    if (!selection) continue;
    if (!isRepresentableAsVariable(selection) && expression) {
      byExpression[expression] = selection;
    } else if (selection.included.size > 0) {
      byVariable.set(key.name, Array.from(selection.included).map(String));
    }
  }

  // Filters that aren't variable-enabled stay expression-keyed. Written after
  // the loop above so that when a plain and a variable-enabled filter share an
  // expression, the surviving entry carries the plain filter's selection.
  for (const filter of filters) {
    const key = filterSelectionKey(filter);
    if (key.kind !== 'expression') continue;
    const selection = resolveFilterSelection(filter, parsed);
    if (selection && hasSelection(selection)) {
      byExpression[key.expression] = selection;
    }
  }

  // Pass through any entries that don't correspond to a declared filter.
  for (const [name, values] of parsed.byVariable) {
    if (!declaredVariableNames.has(name)) byVariable.set(name, values);
  }
  for (const [expression, selection] of Object.entries(parsed.byExpression)) {
    if (!declaredExpressions.has(expression)) {
      byExpression[expression] = selection;
    }
  }

  return serializeDashboardFilterValues({
    byExpression,
    byVariable,
    passthrough: parsed.passthrough,
  });
};

const useDashboardFilters = (filters: DashboardFilter[]) => {
  const [filterValueEntries, setFilterValueEntries] = useQueryState(
    'filters',
    dashboardFilterValuesParser,
  );

  const setFilterValue = useCallback(
    (filterId: string, values: string[]) => {
      setFilterValueEntries(prev => {
        const target = filters.find(f => f.id === filterId);
        if (!target) return prev;

        const parsed = parseDashboardFilterValues(prev ?? []);

        // Apply the change to the parsed state rather than to the rebuilt
        // output, so the filter it targets resolves to the new values even when
        // a sibling shares its variable name or expression.
        const key = filterSelectionKey(target);
        if (key.kind === 'variable') {
          // Set even when empty to avoid falling back to a legacy expression-keyed value
          parsed.byVariable.set(key.name, values);
        } else if (values.length === 0) {
          delete parsed.byExpression[key.expression];
        } else {
          parsed.byExpression[key.expression] = {
            included: new Set(values),
            excluded: new Set(),
          };
        }

        return rebuildEntries(filters, parsed);
      });
    },
    [setFilterValueEntries, filters],
  );

  const {
    selectionByFilterId,
    ignoredExpressions,
    ignoredVariableNames,
    variables,
  } = useMemo<{
    selectionByFilterId: ReadonlyMap<string, FilterSelection>;
    ignoredExpressions: string[];
    ignoredVariableNames: string[];
    variables: ChartVariable[];
  }>(() => {
    const parsed = parseDashboardFilterValues(filterValueEntries ?? []);

    // Keyed by filter ID: two definitions may share one expression
    const selectionByFilterId = new Map<string, FilterSelection>();
    for (const filter of filters) {
      const selection = resolveFilterSelection(filter, parsed);
      if (selection) selectionByFilterId.set(filter.id, selection);
    }

    // Find state that doesn't correspond to any declared filter, so the caller can surface a warning.
    const knownExpressions = new Set(
      filters.filter(isQueryExpressionFilter).map(f => f.expression),
    );
    const ignoredExpressions = Object.keys(parsed.byExpression).filter(
      expression => !knownExpressions.has(expression),
    );

    const variableFilters = getDashboardVariableFilters(filters);
    const declaredVariableNames = new Set(variableFilters.map(v => v.name));
    const ignoredVariableNames = Array.from(parsed.byVariable.keys()).filter(
      name => !declaredVariableNames.has(name),
    );

    const variables: ChartVariable[] = variableFilters.map(
      ({ filter, name }) => {
        const selection = selectionByFilterId.get(filter.id);
        return {
          name,
          expression: getFilterExpression(filter),
          // Sorted for deterministic react-query keys. Built explicitly rather
          // than by spreading the definition, so no extra key leaks into them.
          values: selection
            ? Array.from(selection.included).map(String).sort()
            : [],
        };
      },
    );

    return {
      selectionByFilterId,
      variables,
      ignoredExpressions,
      ignoredVariableNames,
    };
  }, [filterValueEntries, filters]);

  /** Returns the set of rendered filter conditions corresponding to filters matching the given predicate */
  const getFiltersQueriesFor = useCallback(
    (predicate: (filter: DashboardFilter) => boolean): Filter[] => {
      const seen = new Set<string>();
      const queries: Filter[] = [];
      for (const filter of filters) {
        if (!predicate(filter)) continue;
        if (isStaticListFilter(filter)) continue;
        const selection = selectionByFilterId.get(filter.id);
        if (!selection) continue;
        // Wrap keys in `toString()` to support JSON/Dynamic-type columns.
        // All keys can be stringified, since filter select values are stringified as well.
        const emitted = filtersToQuery(
          { [filter.expression]: selection },
          { stringifyKeys: true },
        );
        for (const query of emitted) {
          // Two definitions resolving to the same selection would otherwise
          // emit an identical condition twice, churning react-query keys.
          const dedupeKey = JSON.stringify(query);
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            queries.push(query);
          }
        }
      }
      return queries;
    },
    [filters, selectionByFilterId],
  );

  const broadcastedFilters = useMemo(
    () => getFiltersQueriesFor(isFilterBroadcastEnabled),
    [getFiltersQueriesFor],
  );

  /**
   * Returns the set of rendered filter conditions which should be
   * broadcast to tiles with the given sourceId
   **/
  const getFilterQueriesForSource = useCallback(
    (sourceId: string | undefined): Filter[] =>
      getFiltersQueriesFor(definition =>
        definitionAppliesToSource(definition, sourceId),
      ),
    [getFiltersQueriesFor],
  );

  return {
    /** Each declared filter's current selection, keyed by `filter.id`. */
    selectionByFilterId,
    /**
     * Queries for the broadcasting filters, unscoped by source. Callers with a
     * per-tile source should prefer `getFilterQueriesForSource`.
     */
    broadcastedFilters,
    /** Set the selected values for a filter, by its ID */
    setFilterValue,
    /** Set the raw filter value state */
    setFilterValueEntries,
    /** The raw persisted entries, as they appear in the URL param. */
    filterValueEntries,
    /**
     * Expressions parsed from the URL `filters=` param that don't correspond
     * to any of this dashboard's declared filters — i.e., values that would
     * be silently dropped. Callers can surface a warning.
     */
    ignoredFilterExpressions: ignoredExpressions,
    /**
     * Variable names from the URL `filters=` param that name no declared
     * variable-enabled filter — orphaned by a rename, a deletion, or a filter
     * whose variable was turned off.
     */
    ignoredVariableNames,
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
