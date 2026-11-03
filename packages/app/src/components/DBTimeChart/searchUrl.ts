import { add } from 'date-fns';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import type { AdhocConditionEntry } from '@hyperdx/common-utils/dist/filters';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import {
  AGG_FNS,
  buildEventsSearchUrl,
  ChartKeyJoiner,
  type LineData,
  tryExpandConfigVariables,
} from '@/ChartUtils';

export type SeriesGroupFilter = { column: string; value: string };

// Decode a Recharts series key (e.g. "count · error · api") into the
// underlying group-column filters. This is the same decode buildSeriesSearchUrl
// uses, extracted so the focus callback can hand the caller structured filters
// (rather than a display string) to apply to a sibling results list.
export function decodeSeriesGroupFilters({
  seriesKey,
  groupColumns,
  isSingleValueColumn,
}: {
  seriesKey: string | undefined;
  groupColumns: string[];
  isSingleValueColumn: boolean | undefined;
}): SeriesGroupFilter[] {
  const seriesKeys = seriesKey?.split(ChartKeyJoiner);
  const groupFilters: SeriesGroupFilter[] = [];

  if (seriesKeys?.length && groupColumns?.length) {
    // When the series has multiple value columns, the key is prefixed with the
    // value column name (e.g. "count · error"), so the group values start at
    // index 1. (The "no group columns" case the original inline code also
    // guarded is impossible here — this block only runs when groupColumns is
    // non-empty.)
    const startsWithValueColumn = !(isSingleValueColumn ?? true);
    const groupValues = startsWithValueColumn
      ? seriesKeys.slice(1)
      : seriesKeys;

    groupValues.forEach((value, index) => {
      if (groupColumns[index] != null) {
        groupFilters.push({ column: groupColumns[index], value });
      }
    });
  }

  return groupFilters;
}

/**
 * The ad hoc filter entries that select one chart series: its PromQL labels,
 * or a key per group-by column. Undefined when some group column has no key
 * or can't be filtered on, since filtering on the rest would match more than
 * the series.
 */
export function getSeriesFilterEntries({
  line,
  groupColumns,
  filterKeyByColumn,
  promqlSeriesLabels,
}: {
  line: Pick<LineData, 'groupValues'> | undefined;
  groupColumns: string[];
  filterKeyByColumn: ReadonlyMap<string, string>;
  promqlSeriesLabels?: Record<string, Record<string, string>>;
}): AdhocConditionEntry[] | undefined {
  if (!line || groupColumns.length === 0) return undefined;
  if (promqlSeriesLabels) {
    // PromQL series are grouped by their name alone.
    const labels = promqlSeriesLabels[String(line.groupValues[0])];
    // An ad hoc filter reaches every PromQL query, so a `__name__` condition
    // would empty those on other metrics.
    return labels
      ? Object.entries(labels)
          .filter(([key]) => key !== '__name__')
          .map(([key, value]) => ({ key, value }))
      : undefined;
  }
  const entries: AdhocConditionEntry[] = [];
  for (const [index, column] of groupColumns.entries()) {
    const key = filterKeyByColumn.get(column);
    const value = line.groupValues[index];
    // NULL doesn't match `= ''`, and Map / Array / Tuple / JSON values are
    // JSON in the series key, which their `toString()` wouldn't match.
    if (!key || value == null || typeof value === 'object') return undefined;
    entries.push({ key, value: String(value) });
  }
  return entries;
}

/**
 * Build the drill-down search URL for a clicked point, or null when the chart
 * cannot support it: raw SQL and PromQL charts don't resolve to a single source,
 * and a click with no resolved date has no range to filter on.
 *
 * Pure, and extracted from a useCallback in the chart so the branching here can
 * be read and tested without a render — in particular which value column a
 * series key maps to, and whether that column's aggregation is attributable to
 * individual events at all (a non-attributable agg must not produce a value
 * filter, or the drill-down returns rows that never contributed to the point).
 */
export function buildSeriesSearchUrl({
  seriesKey,
  seriesValue,
  clickedActiveLabelDate,
  source,
  config,
  granularity,
  groupColumns,
  valueColumns,
  isSingleValueColumn,
}: {
  seriesKey?: string;
  seriesValue?: number;
  clickedActiveLabelDate: Date | undefined;
  source: TSource | undefined;
  config: ChartConfigWithDateRange;
  granularity: string;
  groupColumns: string[];
  valueColumns: string[] | undefined;
  isSingleValueColumn: boolean | undefined;
}): string | null {
  // Raw SQL charts are not supported for drill-down as we don't know the source which is being used.
  if (
    clickedActiveLabelDate == null ||
    source == null ||
    isRawSqlChartConfig(config) ||
    isPromqlChartConfig(config)
  ) {
    return null;
  }

  // The search page has no variable machinery, so the expressions read here and
  // handed to buildEventsSearchUrl must be final SQL/Lucene. `whereLanguage` is
  // pinned to buildEventsSearchUrl's default first, since expansion below
  // leaves nothing for it to expand.
  const expandedConfig = tryExpandConfigVariables({
    ...config,
    whereLanguage: config.whereLanguage || 'lucene',
  });

  // Parse the series key to extract group values
  const seriesKeys = seriesKey?.split(ChartKeyJoiner);
  const groupFilters = decodeSeriesGroupFilters({
    seriesKey,
    groupColumns,
    isSingleValueColumn,
  });

  // Build value range filter for Y-axis if provided
  let valueRangeFilter:
    | {
        expression: string;
        value: number;
      }
    | undefined;

  // Metric formula configs with hidden operand series project only the formula
  // column(s), so value columns no longer map positionally onto `select` — skip
  // the value-range filter rather than misattributing a formula value to an
  // operand's expression. (With operands shown, the operand columns still map by
  // index and formula columns fall past the `< expandedConfig.select.length`
  // bound below.)
  const operandsHidden =
    isBuilderChartConfig(expandedConfig) &&
    (expandedConfig.formulas?.length ?? 0) > 0 &&
    expandedConfig.showOperandSeries === false;

  // `!= null`, not truthiness: a clicked value of exactly 0 is a real point —
  // buildActiveClickSeries preserves zeroes — and skipping the filter for it
  // drills down to every event in the bucket instead of the matching ones.
  if (
    seriesValue != null &&
    !operandsHidden &&
    Array.isArray(expandedConfig.select) &&
    expandedConfig.select.length > 0
  ) {
    // Determine which value column to filter on
    let valueExpression: string | undefined;

    if ((isSingleValueColumn ?? true) && expandedConfig.select.length === 1) {
      const firstSelect = expandedConfig.select[0];
      const aggFn =
        typeof firstSelect === 'string' ? undefined : firstSelect.aggFn;
      // Only add value range filter if the aggregation is attributable
      const isAttributable =
        AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

      if (isAttributable) {
        valueExpression =
          typeof firstSelect === 'string'
            ? firstSelect
            : firstSelect.valueExpression;
      }
    } else if (seriesKeys?.length && (valueColumns?.length ?? 0) > 0) {
      const firstPart = seriesKeys[0];
      const valueColumnIndex = valueColumns?.findIndex(
        col => col === firstPart,
      );

      if (
        valueColumnIndex != null &&
        valueColumnIndex >= 0 &&
        valueColumnIndex < expandedConfig.select.length
      ) {
        const selectItem = expandedConfig.select[valueColumnIndex];
        const aggFn =
          typeof selectItem === 'string' ? undefined : selectItem.aggFn;
        // Only add value range filter if the aggregation is attributable
        const isAttributable =
          AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

        if (isAttributable) {
          valueExpression =
            typeof selectItem === 'string'
              ? selectItem
              : selectItem.valueExpression;
        }
      }
    }

    if (valueExpression) {
      valueRangeFilter = {
        expression: valueExpression,
        value: seriesValue,
      };
    }
  }

  // Calculate time range from clicked date and granularity
  const from = clickedActiveLabelDate;
  const to = add(clickedActiveLabelDate, {
    seconds: convertGranularityToSeconds(granularity),
  });

  return buildEventsSearchUrl({
    source,
    config: expandedConfig,
    dateRange: [from, to],
    groupFilters,
    valueRangeFilter,
  });
}
