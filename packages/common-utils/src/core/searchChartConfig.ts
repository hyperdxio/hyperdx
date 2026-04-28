import {
  BuilderChartConfig,
  DateRange,
  DisplayType,
  Filter,
  isLogSource,
  isTraceSource,
  pickSampleWeightExpressionProps,
  SearchCondition,
  SearchConditionLanguage,
  SelectList,
  SortSpecificationList,
  SQLInterval,
  TSource,
} from '@/types';

/**
 * Return type for `buildSearchChartConfig`.
 *
 * The full `BuilderChartConfig` (with required `timestampValueExpression`,
 * which we always set from the source) plus optional date-range knobs that
 * are present iff the caller passed them.
 *
 * This is intentionally narrower than `BuilderChartConfigWithOptDateRange`
 * (which makes `timestampValueExpression` optional). The narrower type lets
 * downstream consumers spread the result into a `BuilderChartConfigWithDateRange`
 * after adding `dateRange` without TS rejecting the timestamp field.
 */
export type SearchChartConfig = BuilderChartConfig & Partial<DateRange>;

/**
 * Default SELECT used by alert evaluators when no caller-supplied SELECT
 * is provided: a single `count()` aggregate.
 *
 * Shared between the scheduled alert task (`checkAlerts/index.ts`) and the
 * alert preview chart (`AlertPreviewChart.tsx`) so the two paths produce
 * byte-identical SELECT shapes. The `as const` annotations are required
 * so TypeScript infers literal types (`'count'`, `'sql'`) that satisfy the
 * strict branch of `RootValueExpressionSchema` (which requires
 * `aggConditionLanguage` whenever `aggFn` is set).
 *
 * Today every field except `aggFn` is empty / no-op — but pinning the
 * shape now prevents the alert task and the preview from drifting if
 * someone later adds, e.g., a non-empty `aggCondition` to one site without
 * also adding `aggConditionLanguage` (which would silently render under
 * `lucene` vs `sql` in different code paths inside `renderChartConfig`).
 */
export const ALERT_COUNT_DEFAULT_SELECT: SelectList = [
  {
    aggFn: 'count' as const,
    aggCondition: '',
    aggConditionLanguage: 'sql' as const,
    valueExpression: '',
  },
];

/**
 * Saved-search-shaped inputs for assembling a chart config.
 *
 * Fields are primitives (not a persisted SavedSearch) so this can also be
 * called from in-flight, unsaved contexts like the alert preview chart.
 */
export type SearchChartConfigInput = {
  where: SearchCondition | null | undefined;
  whereLanguage?: SearchConditionLanguage | null;
  filters?: Filter[] | null;
  /**
   * SELECT list. If null/undefined/empty, falls back to `defaultSelect`, then
   * to `source.defaultTableSelectExpression` when the source kind supports it.
   */
  select?: SelectList | null;
  orderBy?: SortSpecificationList | null;
  groupBy?: SelectList | null;

  // Display / time-range knobs
  displayType?: DisplayType;
  /** Overrides `source.connection` when provided. */
  connection?: string;
  dateRange?: [Date, Date];
  dateRangeStartInclusive?: boolean;
  dateRangeEndInclusive?: boolean;
  granularity?: SQLInterval;

  /** Fallback SELECT when neither `select` nor the source's default is set. */
  defaultSelect?: BuilderChartConfig['select'];
};

/**
 * Resolve the SELECT list, preferring caller-provided `select`, then the
 * caller's `defaultSelect`, then the source's `defaultTableSelectExpression`
 * (for Log / Trace sources), falling back to an empty string.
 *
 * Both `string` and `DerivedColumn[]` SELECT shapes have a `.length` property,
 * so a single non-empty check covers "skip empty `''` strings and skip empty
 * `[]` arrays" symmetrically — matching the app's historical behavior.
 */
function resolveSelect(
  source: TSource,
  select: SelectList | null | undefined,
  defaultSelect: BuilderChartConfig['select'] | undefined,
): BuilderChartConfig['select'] {
  const isNonEmpty = (v: SelectList | null | undefined): v is SelectList =>
    v != null && v.length > 0;

  if (isNonEmpty(select)) return select;
  if (isNonEmpty(defaultSelect)) return defaultSelect;
  if (isLogSource(source) || isTraceSource(source)) {
    return source.defaultTableSelectExpression ?? '';
  }
  return '';
}

/**
 * Build a `BuilderChartConfigWithOptDateRange` from a source plus
 * saved-search-style inputs.
 *
 * This is the single source of truth for "how do we translate a saved search
 * (or unsaved alert preview) into a chart config?" and is shared by:
 *   - the app search page (`DBSearchPage`)
 *   - the alert preview chart in the alert editor (`AlertPreviewChart`)
 *   - the scheduled alert task's SAVED_SEARCH evaluator
 *
 * Keeping this in one place prevents drift like HDX-4111, where the app
 * applied `source.tableFilterExpression` and the alert task did not,
 * producing false-positive alerts whose count did not reconcile with the
 * app's results for the same saved search and window.
 */
export function buildSearchChartConfig(
  source: TSource,
  input: SearchChartConfigInput,
): SearchChartConfig {
  // Prepend the Log source's `tableFilterExpression` as a SQL filter when set,
  // so the alert query and the app search see the same row set.
  // Log sources are the only kind that carries `tableFilterExpression` today.
  //
  // NOTE: `tableFilterExpression` is deprecated. It's an application-side SQL
  // predicate (not a ClickHouse row policy), so it can't enforce real tenant
  // isolation — anyone with direct SELECT access to the table bypasses it.
  // For hard isolation, configure a ClickHouse ROW POLICY at the DB level
  // instead. Existing values are still honored here for backward
  // compatibility; new sources should not set the field.
  const tableFilter: Filter[] =
    isLogSource(source) && source.tableFilterExpression != null
      ? [{ type: 'sql', condition: source.tableFilterExpression }]
      : [];
  const userFilters: Filter[] = input.filters ?? [];
  const mergedFilters: Filter[] = [...tableFilter, ...userFilters];

  const implicitColumnExpression =
    isLogSource(source) || isTraceSource(source)
      ? source.implicitColumnExpression
      : undefined;

  const config: SearchChartConfig = {
    connection: input.connection ?? source.connection,
    displayType: input.displayType ?? DisplayType.Search,
    source: source.id,
    from: source.from,
    select: resolveSelect(source, input.select, input.defaultSelect),
    where: input.where ?? '',
    whereLanguage: input.whereLanguage ?? 'sql',
    timestampValueExpression: source.timestampValueExpression,
    ...(implicitColumnExpression != null ? { implicitColumnExpression } : {}),
    ...pickSampleWeightExpressionProps(source),
    ...(mergedFilters.length > 0 ? { filters: mergedFilters } : {}),
    ...(input.groupBy != null ? { groupBy: input.groupBy } : {}),
    ...(input.orderBy != null ? { orderBy: input.orderBy } : {}),
    ...(input.dateRange != null ? { dateRange: input.dateRange } : {}),
    ...(input.dateRangeStartInclusive != null
      ? { dateRangeStartInclusive: input.dateRangeStartInclusive }
      : {}),
    ...(input.dateRangeEndInclusive != null
      ? { dateRangeEndInclusive: input.dateRangeEndInclusive }
      : {}),
    ...(input.granularity != null ? { granularity: input.granularity } : {}),
  };

  return config;
}
