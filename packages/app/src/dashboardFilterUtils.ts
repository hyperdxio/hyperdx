// Shared helpers for dashboard-level "constant" filters (HDX-4404).
//
// Three call sites used to inline `parseKeyPath(expr).join('.')` walks
// to build a Set of constant expressions, merge constant entries into
// savedFilterValues on save, and strip constant entries out of the URL
// on hydration. Promoting them into a module gives one place to test
// and one place to maintain. Page-level (`DBDashboardPage.tsx`),
// hook-level (`useDashboardFilters.tsx`), and chip-level
// (`DashboardFilters.tsx`) all consume the same primitives.
//
// `parseQuery` parses simple `type: 'sql'` IN / NOT IN / BETWEEN
// conditions into a keyed `FilterState` and ignores anything else, so
// the saved/URL filter values these helpers round-trip are the same
// `type: 'sql'` shape `filtersToQuery` emits.
import { parseKeyPath } from '@hyperdx/common-utils/dist/core/metadata';
import {
  type FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import type { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

import { parseQuery } from '@/searchFilters';

/**
 * Normalize a filter expression to dot-notation so bracket-notation
 * (`SpanAttributes['k8s.pod.name']`) and dot-notation
 * (`SpanAttributes.k8s.pod.name`) lookups match.
 */
export const normalizeExpression = (expr: string): string =>
  parseKeyPath(expr).join('.');

/**
 * Set of normalized expressions that are locked by `constant: true` on
 * one of the dashboard's filter definitions.
 */
export const buildConstantExpressionSet = (
  filters: DashboardFilter[] | undefined | null,
): Set<string> => {
  const set = new Set<string>();
  if (!filters) return set;
  for (const f of filters) {
    if (f.constant) set.add(normalizeExpression(f.expression));
  }
  return set;
};

/**
 * Strip constant-expression entries out of the URL filter state. The
 * read path (`useDashboardFilters`) overlays constants from
 * `savedFilterValues` on every read regardless of URL state, so writing
 * them to the URL would (a) leak the locked scope into shared links and
 * (b) duplicate the value across two sources of truth.
 *
 * Returns `null` if nothing remains so the caller can clear the
 * `filters=` query param entirely.
 */
export const stripConstantsFromUrl = (
  savedFilterValues: Filter[],
  constantExpressions: Set<string>,
): Filter[] | null => {
  if (constantExpressions.size === 0) return savedFilterValues;
  const { filters: parsedSaved } = parseQuery(savedFilterValues);
  const remaining: FilterState = {};
  for (const [key, value] of Object.entries(parsedSaved)) {
    if (!constantExpressions.has(normalizeExpression(key))) {
      remaining[key] = value;
    }
  }
  const remainingQueries = filtersToQuery(remaining);
  return remainingQueries.length ? remainingQueries : null;
};

/**
 * Merge constant-filter entries from the existing `savedFilterValues`
 * with the current URL state, dropping any URL entry whose normalized
 * expression collides with a constant. Used by the "Save default"
 * handler so a user clicking that button doesn't clobber the locked
 * values (which are intentionally absent from the URL).
 */
export const mergeConstantFiltersForSave = (
  savedFilterValues: Filter[] | undefined | null,
  urlFilterValues: Filter[],
  constantExpressions: Set<string>,
): Filter[] => {
  if (constantExpressions.size === 0) return urlFilterValues;
  const { filters: parsedSaved } = parseQuery(savedFilterValues ?? []);
  const preservedSaved: FilterState = {};
  for (const [key, value] of Object.entries(parsedSaved)) {
    if (constantExpressions.has(normalizeExpression(key))) {
      preservedSaved[key] = value;
    }
  }
  const { filters: parsedUrl } = parseQuery(urlFilterValues);
  const filteredUrl: FilterState = {};
  for (const [key, value] of Object.entries(parsedUrl)) {
    if (!constantExpressions.has(normalizeExpression(key))) {
      filteredUrl[key] = value;
    }
  }
  return [...filtersToQuery(preservedSaved), ...filtersToQuery(filteredUrl)];
};

/**
 * Upsert a saved default value into `savedFilterValues` for the given
 * filter expression. An empty `values` array removes the entry.
 *
 * Match is by normalized expression so bracket-notation and
 * dot-notation collide on the same key (which is what we want).
 */
export const upsertSavedDefault = (
  savedFilterValues: Filter[] | undefined | null,
  expression: string,
  values: string[],
): Filter[] => {
  const existing = savedFilterValues ?? [];
  const { filters: parsed } = parseQuery(existing);
  const norm = normalizeExpression(expression);
  const remaining: FilterState = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (normalizeExpression(key) !== norm) {
      remaining[key] = value;
    }
  }
  if (values.length > 0) {
    remaining[expression] = {
      included: new Set(values),
      excluded: new Set(),
    };
  }
  return filtersToQuery(remaining);
};

/**
 * Remove any `savedFilterValues` entry whose normalized expression
 * matches a deleted filter's expression. Used by `handleRemoveFilter`
 * so deleting + recreating a filter on the same expression doesn't
 * silently re-lock to an orphaned value.
 */
export const removeSavedDefaultForExpression = (
  savedFilterValues: Filter[] | undefined | null,
  expression: string,
): Filter[] | undefined => {
  if (!savedFilterValues?.length) return savedFilterValues ?? undefined;
  const norm = normalizeExpression(expression);
  const { filters: parsed } = parseQuery(savedFilterValues);
  const remaining: FilterState = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (normalizeExpression(key) !== norm) {
      remaining[key] = value;
    }
  }
  return filtersToQuery(remaining);
};
