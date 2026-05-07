import {
  BuilderChartConfig,
  DateRange,
  DisplayType,
  Filter,
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
   * SELECT list. If null/undefined/empty, falls back to
   * `source.defaultTableSelectExpression` when the source kind supports it.
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
};

/**
 * Resolve the SELECT list, preferring caller-provided `select`, falling back
 * to '*'. In Berg, sources are agnostic Athena tables; there is no
 * source-side default-select expression.
 *
 * Both `string` and `DerivedColumn[]` SELECT shapes have a `.length` property,
 * so a single non-empty check covers "skip empty `''` strings and skip empty
 * `[]` arrays" symmetrically.
 */
function resolveSelect(
  _source: TSource,
  select: SelectList | null | undefined,
): BuilderChartConfig['select'] {
  if (select != null && select.length > 0) return select;
  return '*';
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
 * Keeping the assembly in one place prevents drift between the three paths
 * — for example, ensuring `source.tableFilterExpression` (and any future
 * source-level fields) is applied uniformly, so the alert task and the app
 * search produce the same row set for the same saved search and window.
 */
export function buildSearchChartConfig(
  source: TSource,
  input: SearchChartConfigInput,
): SearchChartConfig {
  const userFilters: Filter[] = input.filters ?? [];

  const config: SearchChartConfig = {
    connection: input.connection ?? '',
    displayType: input.displayType ?? DisplayType.Search,
    source: source.id,
    from: { databaseName: source.database, tableName: source.table },
    select: resolveSelect(source, input.select),
    where: input.where ?? '',
    whereLanguage: input.whereLanguage ?? 'sql',
    timestampValueExpression: source.timestampColumn ?? '',
    ...(userFilters.length > 0 ? { filters: userFilters } : {}),
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
