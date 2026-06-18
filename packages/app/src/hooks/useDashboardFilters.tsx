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
   * The dashboard's saved filter values, in the same shape used in the
   * URL. Constant filters (`constant: true`) source their locked value
   * from this array, matched by filter expression. Optional; when
   * omitted, constant filters resolve to no value.
   */
  savedFilterValues?: Filter[] | null;
  /**
   * Gate the overlay until the dashboard has finished loading. When the
   * caller is still fetching (`dashboard?.filters` not yet available),
   * the hook can't tell whether a URL entry collides with an as-yet-
   * unknown `constant: true` filter, so emitting the URL value into
   * tile queries would let React Query cache a tile result scoped to
   * the stale URL value rather than the locked saved value. Pass
   * `false` while loading and flip to `true` once the dashboard has
   * resolved (`dashboardReady` in `DBDashboardPage`).
   *
   * Defaults to `true` so callers that don't have a loading state
   * (tests, preset dashboards) keep working unchanged.
   */
  enabled?: boolean;
}

const useDashboardFilters = (
  filters: DashboardFilter[],
  { savedFilterValues, enabled = true }: UseDashboardFiltersOptions = {},
) => {
  const [filterQueries, setFilterQueries] = useQueryState(
    'filters',
    filterQueriesParser,
  );

  // Set of normalized expressions that are locked by `constant: true`.
  // `setFilterValue` skips writes to these, and read paths overlay the
  // saved value regardless of URL state. Normalized (bracket and dot
  // forms collide) to stay consistent with the filter helpers in
  // `dashboardFilterUtils` and the schema refinement in `types.ts`.
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
        if (values.length === 0) {
          delete filterValues[expression];
        } else {
          filterValues[expression] = {
            included: new Set(values),
            excluded: new Set(),
          };
        }

        // Output scrubber: a viewer with a stale shared URL might land
        // with `filterValues` already containing entries for expressions
        // that are now `constant: true`. Without this scrub, the very
        // next `setFilterValue` call for any sibling expression would
        // re-emit the stale constant entry into the URL via
        // `filtersToQuery`, re-publishing the locked scope back into
        // shared links. Drop those entries before re-encoding so the
        // URL stays clean of locked expressions on every write.
        for (const expr of Object.keys(filterValues)) {
          if (constantExpressions.has(normalizeExpression(expr))) {
            delete filterValues[expr];
          }
        }

        return filtersToQuery(
          filterValues,
          { stringifyKeys: false }, // Don't wrap keys with toString(), to preserve exact key names in URL query parameters
        );
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
    // Race guard: while `enabled` is false (typically because the
    // dashboard is still loading), short-circuit to empty results.
    // Without this gate, the hook would treat URL entries as editable
    // (no constants known yet) and emit them into tile queries before
    // `dashboard.filters` and `savedFilterValues` arrive, letting
    // React Query cache a tile result scoped to the stale URL value
    // rather than the eventual locked saved value.
    if (!enabled) {
      return {
        valuesForExistingFilters: {} as FilterState,
        queriesForExistingFilters: [] as Filter[],
        ignoredExpressions: [] as string[],
        filtersByExpression: new Map<string, DashboardFilter[]>(),
      };
    }
    const { filters: parsedFilters } = parseQuery(filterQueries ?? []);
    const valuesForExistingFilters: FilterState = {};
    const knownExpressions = new Set(filters.map(f => f.expression));
    const ignored: string[] = [];

    // Build a normalized lookup of saved filter values so constant filters
    // can resolve their locked value regardless of URL state. Saved values
    // are stored in the same shape as URL filters, so the same parser
    // produces the same expression-keyed FilterState.
    const { filters: parsedSaved } = parseQuery(savedFilterValues ?? []);
    const normalizedSaved = new Map(
      Object.entries(parsedSaved).map(([k, v]) => [normalizeExpression(k), v]),
    );

    for (const { expression } of filters) {
      const norm = normalizeExpression(expression);
      const treatAsConstant = constantExpressions.has(norm);
      // Constant filters always source their value from savedFilterValues,
      // ignoring any URL state on the same expression. This is what makes
      // the value "locked": the viewer cannot override it via the URL.
      // Editable filters match the URL exactly (the parser preserves the
      // key verbatim), consistent with the rest of the pipeline.
      const match = treatAsConstant
        ? normalizedSaved.get(norm)
        : parsedFilters[expression];
      if (match) {
        valuesForExistingFilters[expression] = match;
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
  }, [filterQueries, filters, savedFilterValues, enabled, constantExpressions]);

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

  // Input guard for stale shared URLs: when the URL carries entries for
  // expressions that are now `constant: true`, scrub them on load so a
  // later `setFilterValue` for any other expression doesn't re-emit them
  // back into the URL via `filtersToQuery`. Read paths already overlay
  // the saved value regardless of URL state; this step keeps the URL
  // itself clean. Runs once per first non-empty filterQueries snapshot.
  const hasScrubbedConstantsRef = useRef(false);
  useEffect(() => {
    if (hasScrubbedConstantsRef.current) return;
    if (!filterQueries || filterQueries.length === 0) return;
    if (constantExpressions.size === 0) return;
    const { filters: parsed } = parseQuery(filterQueries);
    let removed = false;
    for (const key of Object.keys(parsed)) {
      if (constantExpressions.has(normalizeExpression(key))) {
        delete parsed[key];
        removed = true;
      }
    }
    hasScrubbedConstantsRef.current = true;
    if (removed) {
      const next = filtersToQuery(parsed, { stringifyKeys: false });
      setFilterQueries(next.length ? next : null);
    }
  }, [filterQueries, constantExpressions, setFilterQueries]);

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
