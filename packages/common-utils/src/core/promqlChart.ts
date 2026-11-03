import {
  displayTypeSupportsInstantQuery,
  getQueriedPromqlSeries,
  isRangeQuery,
  parsePromqlLe,
  promqlSeriesQueryType,
  promqlStepSeconds,
  reducePromqlSamples,
} from '@/core/promql';
import { renderPromqlSeriesNames } from '@/core/seriesNameTemplate';
import {
  getAlignedDateRange,
  getTimeChartGranularity,
  HEATMAP_AUTO_GRANULARITY_BUCKETS,
  MAX_TABLE_ROWS,
} from '@/core/utils';
import { substitutePromqlChartConfigTemplates } from '@/macros';
import {
  ChartVariable,
  DisplayType,
  PrometheusMatrixResult,
  PrometheusVectorResult,
  PromqlConditionFilter,
  PromqlExpressionList,
  PromqlReducer,
  PromqlSeries,
} from '@/types';

/** A query result a PromQL chart can't draw, such as a string or an unaggregated histogram. */
export class PromqlChartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromqlChartError';
  }
}

/**
 * A PromQL chart's resolved granularity, and its date range aligned to that
 * granularity's buckets when it runs a range query, so its samples land on the
 * same boundaries as the timeseries charts' and stay put across refreshes.
 * Time charts and heatmaps always run range queries.
 */
export function getPromqlChartRange(config: {
  promqlExpression?: PromqlExpressionList;
  displayType?: DisplayType;
  granularity?: string;
  alignDateRangeToGranularity?: boolean;
  dateRange: [Date, Date];
  minGranularitySeconds?: number;
}): { granularity: string; dateRange: [Date, Date] } {
  const granularity = getTimeChartGranularity(
    config.granularity,
    config.dateRange,
    config.minGranularitySeconds,
    config.displayType === DisplayType.Heatmap
      ? HEATMAP_AUTO_GRANULARITY_BUCKETS
      : undefined,
  );
  const runsRangeQuery =
    !displayTypeSupportsInstantQuery(config) || isRangeQuery(config);
  return {
    granularity,
    dateRange:
      runsRangeQuery && config.alignDateRangeToGranularity !== false
        ? getAlignedDateRange(config.dateRange, granularity)
        : config.dateRange,
  };
}

export type PromqlQuery =
  | {
      kind: 'range';
      expr: string;
      startSec: number;
      endSec: number;
      stepSec: number;
    }
  | {
      kind: 'instant';
      expr: string;
      timeSec: number;
      /** The most series to return. */
      limit?: number;
    };

/**
 * The queries a PromQL chart sends, one per expression it plots, with its
 * variables and macros expanded. Expects a resolved granularity and the date
 * range from getPromqlChartRange.
 */
export function getPromqlChartQueries(
  config: {
    promqlExpression: PromqlExpressionList;
    displayType?: DisplayType;
    granularity?: string;
    variables?: ChartVariable[];
    filters?: PromqlConditionFilter[];
    minGranularitySeconds?: number;
  },
  dateRange: [Date, Date],
): (PromqlSeries & { query: PromqlQuery })[] {
  const substituted = substitutePromqlChartConfigTemplates({
    ...config,
    dateRange,
  });
  const [startSec, endSec] = dateRange.map(date => date.getTime() / 1000);
  const stepSec = promqlStepSeconds(
    substituted.granularity,
    dateRange,
    substituted.minGranularitySeconds,
  );

  return getQueriedPromqlSeries(substituted).map(series => ({
    ...series,
    query:
      displayTypeSupportsInstantQuery(substituted) &&
      promqlSeriesQueryType(series) === 'instant'
        ? {
            kind: 'instant',
            expr: series.expression,
            timeSec: endSec,
            // A vector is one sample per series, so capping series caps a
            // table's rows exactly. Range queries go uncapped: series can be
            // sparse, so no series count bounds their samples without dropping
            // rows that would fit.
            limit:
              substituted.displayType === DisplayType.Table
                ? MAX_TABLE_ROWS
                : undefined,
          }
        : {
            kind: 'range',
            expr: series.expression,
            startSec,
            endSec,
            stepSec,
          },
  }));
}

/** One series of a result: its labels, and its `[unix seconds, value]` samples. */
type SampledSeries = {
  metric: Record<string, string>;
  values: [number, number][];
};

/** One expression's query result, normalized across the two endpoints. */
export type PromqlExpressionSamples = PromqlSeries & {
  /** Whether the result is bucketed by time. */
  isBucketed: boolean;
  result: SampledSeries[];
};

/** The `data` of a Prometheus query or query_range response. */
export type PromqlResultData =
  | { resultType: 'matrix'; result: PrometheusMatrixResult[] }
  | { resultType: 'vector'; result: PrometheusVectorResult[] }
  | { resultType: 'scalar'; result: [number, string] }
  | { resultType: 'string'; result: unknown };

/** A query result's series, with their samples parsed. */
export function toPromqlSamples(
  data: PromqlResultData,
): Pick<PromqlExpressionSamples, 'isBucketed' | 'result'> {
  switch (data.resultType) {
    case 'matrix':
      return {
        isBucketed: true,
        result: data.result.map(({ metric, values }) => ({
          metric,
          values: values.map(([ts, value]) => [ts, parseFloat(value)]),
        })),
      };
    case 'vector':
      return {
        isBucketed: false,
        result: data.result.map(({ metric, value }) => ({
          metric,
          values: [[value[0], parseFloat(value[1])]],
        })),
      };
    case 'scalar':
      return {
        isBucketed: false,
        result: [
          {
            metric: {},
            values: [[data.result[0], parseFloat(data.result[1])]],
          },
        ],
      };
    default:
      throw new PromqlChartError(
        'A PromQL chart needs numeric samples; this expression returned a string.',
      );
  }
}

/** Chart rows, shaped like a ClickHouse response. */
export type PromqlChartRows = {
  data: Record<string, string | number>[];
  meta: { name: string; type: string }[];
  rows: number;
  /** Time series only: each series' labels, by series name. */
  promqlSeriesLabels?: Record<string, Record<string, string>>;
};

/**
 * Rows for the whole chart, named like the chart names its series.
 *
 * Rows carry a `__hdx_time_bucket` if the result of any expression spans time,
 * otherwise no `__hdx_time_bucket` is included. Samples keep the timestamps
 * Prometheus gave them.
 */
export function toPromqlChartRows(
  expressions: PromqlExpressionSamples[],
  legendTemplate?: string,
): PromqlChartRows {
  const seriesNames = renderPromqlSeriesNames(expressions, legendTemplate);
  const isBucketed = expressions.some(result => result.isBucketed);

  const data: Record<string, string | number>[] = [];
  const promqlSeriesLabels = new Map<string, Record<string, string>>();
  expressions.forEach(({ result: series }, expressionIndex) => {
    series.forEach(({ values, metric }, seriesIndex) => {
      const seriesName = seriesNames.at(expressionIndex)?.at(seriesIndex);
      if (seriesName == null) {
        // Unreachable: renderPromqlSeriesNames returns one name per series.
        throw new Error(
          `No name rendered for series ${expressionIndex}:${seriesIndex}`,
        );
      }
      promqlSeriesLabels.set(seriesName, metric);
      for (const [ts, value] of values) {
        data.push(
          isBucketed
            ? {
                __hdx_time_bucket: new Date(ts * 1000).toISOString(),
                value,
                series_name: seriesName,
              }
            : { value, series_name: seriesName },
        );
      }
    });
  });

  return {
    data,
    meta: [
      ...(isBucketed
        ? [{ name: '__hdx_time_bucket', type: 'DateTime64(3)' }]
        : []),
      { name: 'value', type: 'Float64' },
      { name: 'series_name', type: 'String' },
    ],
    rows: data.length,
    promqlSeriesLabels: Object.fromEntries(promqlSeriesLabels),
  };
}

/** `base`, or `base_N` with the lowest N that doesn't collide with a label column. */
function uniqueColumnName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Every label any series carries, `__name__` first and the rest alphabetical. */
function labelColumns(expressions: PromqlExpressionSamples[]): string[] {
  const keys = new Set<string>();
  for (const { result } of expressions) {
    for (const { metric } of result) {
      for (const key of Object.keys(metric)) keys.add(key);
    }
  }
  const hasName = keys.delete('__name__');
  return [...(hasName ? ['__name__'] : []), ...[...keys].sort()];
}

/** Every sample of every series, lazily, so a capped caller stops reading early. */
function* samples(expressions: PromqlExpressionSamples[]) {
  for (const { result } of expressions) {
    for (const { metric, values } of result) {
      const labelValues = new Map(Object.entries(metric));
      for (const [ts, value] of values) yield { labelValues, ts, value };
    }
  }
}

/**
 * Rows for a table tile: one per sample, with a column per Prometheus label,
 * including __name__, plus Timestamp and Value column. Every row carries the
 * same keys in the same order.
 */
export function toPromqlTableRows(
  expressions: PromqlExpressionSamples[],
  maxRows: number = MAX_TABLE_ROWS,
): PromqlChartRows {
  const labels = labelColumns(expressions);
  const taken = new Set(labels);
  const timeColumn = expressions.some(({ isBucketed }) => isBucketed)
    ? uniqueColumnName('Timestamp', taken)
    : undefined;
  if (timeColumn) taken.add(timeColumn);
  const valueColumn = uniqueColumnName('Value', taken);

  // Cap the rows here, before the caller holds every sample.
  const data: Record<string, string | number>[] = [];
  for (const { labelValues, ts, value } of samples(expressions)) {
    if (data.length >= maxRows) break;
    const row: [string, string | number][] = [];
    if (timeColumn) row.push([timeColumn, new Date(ts * 1000).toISOString()]);
    for (const label of labels) {
      row.push([label, labelValues.get(label) ?? '']);
    }
    row.push([valueColumn, value]);
    data.push(Object.fromEntries(row));
  }

  return {
    data,
    meta: [
      ...(timeColumn ? [{ name: timeColumn, type: 'DateTime64(3)' }] : []),
      ...labels.map(name => ({ name, type: 'String' })),
      { name: valueColumn, type: 'Float64' },
    ],
    rows: data.length,
  };
}

/**
 * Rows for a histogram heatmap: one per sample, grouped by the series' `le`
 * bucket. Every series must be a distinct bucket (le).
 */
export function toPromqlHistogramRows(
  expressions: PromqlExpressionSamples[],
): PromqlChartRows {
  const seenLe = new Set<string>();
  const data: Record<string, string | number>[] = [];
  for (const { result } of expressions) {
    for (const { metric, values } of result) {
      const le = metric.le;
      if (Number.isNaN(parsePromqlLe(le))) {
        throw new PromqlChartError(
          'Histogram heatmaps need series with an "le" label, e.g. sum by (le) (rate(x_bucket[$__rate_interval])).',
        );
      }
      if (seenLe.has(le)) {
        throw new PromqlChartError(
          `Several series share le="${le}". Aggregate them by bucket with sum by (le) (...).`,
        );
      }
      seenLe.add(le);
      for (const [ts, value] of values) {
        data.push({
          __hdx_time_bucket: new Date(ts * 1000).toISOString(),
          le,
          value,
        });
      }
    }
  }

  return {
    data,
    meta: [
      { name: '__hdx_time_bucket', type: 'DateTime64(3)' },
      { name: 'le', type: 'String' },
      { name: 'value', type: 'Float64' },
    ],
    rows: data.length,
  };
}

/** A PromQL chart's rows, in the shape its display type draws. */
export function toPromqlChartResult(
  config: {
    displayType?: DisplayType;
    legendTemplate?: string;
    heatmap?: { mode?: string };
  },
  expressions: PromqlExpressionSamples[],
): PromqlChartRows {
  // Rows keyed by the series' `le` bucket, so that alias and legend templates
  // don't interfere with the le label.
  if (config.heatmap?.mode === 'histogram') {
    return toPromqlHistogramRows(expressions);
  }
  return config.displayType === DisplayType.Table
    ? toPromqlTableRows(expressions)
    : toPromqlChartRows(
        expressions,
        config.legendTemplate?.trim() || undefined,
      );
}

/**
 * Aggregate samples for each series according to the specified reducer. A series
 * that reduces to nothing is dropped, reading as no value rather than a zero.
 */
export function reducePromqlChartRows(
  result: Pick<PromqlChartRows, 'data'>,
  reducer: PromqlReducer | undefined,
): PromqlChartRows {
  const samplesBySeries = new Map<string, number[]>();
  for (const row of result.data) {
    const name = String(row.series_name ?? '');
    const seriesSamples = samplesBySeries.get(name);
    if (seriesSamples) {
      seriesSamples.push(Number(row.value));
    } else {
      samplesBySeries.set(name, [Number(row.value)]);
    }
  }

  const data: Record<string, string | number>[] = [];
  for (const [seriesName, seriesSamples] of samplesBySeries) {
    const value = reducePromqlSamples(seriesSamples, reducer);
    if (value != null) data.push({ series_name: seriesName, value });
  }

  return {
    data,
    meta: [
      { name: 'series_name', type: 'String' },
      { name: 'value', type: 'Float64' },
    ],
    rows: data.length,
  };
}
