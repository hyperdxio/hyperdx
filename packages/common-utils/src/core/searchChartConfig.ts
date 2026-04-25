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
 * (for Log / Trace sources).
 *
 * Treats an empty string as "no select" so we fall through to the defaults
 * — matches the app's historical behavior.
 */
function resolveSelect(
  source: TSource,
  select: SelectList | null | undefined,
  defaultSelect: BuilderChartConfig['select'] | undefined,
): BuilderChartConfig['select'] {
  if (select != null) {
    if (typeof select === 'string') {
      if (select.length > 0) return select;
    } else if (select.length > 0) {
      return select;
    }
  }
  if (defaultSelect != null) {
    if (typeof defaultSelect === 'string') {
      if (defaultSelect.length > 0) return defaultSelect;
    } else if (defaultSelect.length > 0) {
      return defaultSelect;
    }
  }
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
