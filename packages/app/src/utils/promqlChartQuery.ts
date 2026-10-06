import {
  displayTypeSupportsInstantQuery,
  getQueriedPromqlSeries,
  promqlSeriesQueryType,
  promqlStep,
  reducePromqlSamples,
} from '@hyperdx/common-utils/dist/core/promql';
import { renderPromqlSeriesNames } from '@hyperdx/common-utils/dist/core/seriesNameTemplate';
import { substitutePromqlChartConfigTemplates } from '@hyperdx/common-utils/dist/macros';
import {
  DateRange,
  DisplayType,
  PrometheusMatrixResult,
  PromqlChartConfig,
  PromqlReducer,
  PromqlSeries,
} from '@hyperdx/common-utils/dist/types';

import { prometheusApi, PrometheusInstantQueryResponse } from '@/api';
import { MAX_TABLE_ROWS } from '@/HDXMultiSeriesTableChart';
import { ChartQueryResult } from '@/types';

/** One series of a result: its labels, and its `[unix seconds, value]` samples. */
type SampledSeries = {
  metric: Record<string, string>;
  values: [number, number][];
};

/** One expression's query result, normalized across the two endpoints. */
type ExpressionResult = PromqlSeries & {
  /** Whether the result is bucketed by time. */
  isBucketed: boolean;
  result: SampledSeries[];
};

/** An instant query's response, normalized across response types (scalar, vector, matrix). */
function normalizeInstantResult(response: PrometheusInstantQueryResponse): {
  isBucketed: boolean;
  result: SampledSeries[];
} {
  if (response.status !== 'success' || !response.data) {
    throw new Error(response.error ?? 'PromQL query failed');
  }

  const { data } = response;
  switch (data.resultType) {
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
    case 'matrix':
      return { isBucketed: true, result: toSampledSeries(data.result) };
    default:
      throw new Error(
        'A PromQL chart needs numeric samples; this expression returned a string.',
      );
  }
}

/** A matrix result's series, with their samples parsed. */
const toSampledSeries = (result: PrometheusMatrixResult[]): SampledSeries[] =>
  result.map(({ metric, values }) => ({
    metric,
    values: values.map(([ts, value]) => [ts, parseFloat(value)]),
  }));

/** Evaluate one expression at `evalTime`, at the instant endpoint. */
async function fetchInstantExpression(
  config: PromqlChartConfig,
  series: PromqlSeries,
  evalTime: Date,
  signal: AbortSignal,
): Promise<ExpressionResult> {
  const response = await prometheusApi.query({
    query: series.expression,
    time: evalTime.getTime() / 1000,
    connectionId: config.connection,
    // A vector is one sample per series, so capping series caps a table's
    // rows exactly. Range queries go uncapped: series can be sparse, so no
    // series count bounds their samples without dropping rows that would fit.
    limit:
      config.displayType === DisplayType.Table ? MAX_TABLE_ROWS : undefined,
    database: config.from?.databaseName,
    table: config.from?.tableName,
    signal,
  });

  return {
    ...series,
    ...normalizeInstantResult(response),
  };
}

/** Evaluate one expression over the whole window, at the range endpoint. */
async function fetchRangeExpression(
  config: PromqlChartConfig & Pick<DateRange, 'minGranularitySeconds'>,
  series: PromqlSeries,
  dateRange: [Date, Date],
  signal: AbortSignal,
): Promise<ExpressionResult> {
  const [startDate, endDate] = dateRange;
  const response = await prometheusApi.queryRange({
    query: series.expression,
    start: startDate.getTime() / 1000,
    end: endDate.getTime() / 1000,
    step: promqlStep(
      config.granularity,
      dateRange,
      config.minGranularitySeconds,
    ),
    connectionId: config.connection,
    database: config.from?.databaseName,
    table: config.from?.tableName,
    signal,
  });

  if (response.status !== 'success' || !response.data) {
    throw new Error(response.error ?? 'PromQL query failed');
  }

  // The range endpoint only ever answers with a matrix.
  return {
    ...series,
    isBucketed: true,
    result: toSampledSeries(response.data.result),
  };
}

/**
 * Rows for the whole chart, shaped like a ClickHouse response.
 *
 * Rows carry a `__hdx_time_bucket` if the result of any expression spans time,
 * otherwise no `__hdx_time_bucket` is included. Samples keep the timestamps
 * Prometheus gave them.
 */
function toChartRows(
  expressions: ExpressionResult[],
  legendTemplate?: string,
): ChartQueryResult {
  const seriesNames = renderPromqlSeriesNames(expressions, legendTemplate);
  const isBucketed = expressions.some(result => result.isBucketed);

  const data: Record<string, string | number>[] = [];
  expressions.forEach(({ result: series }, expressionIndex) => {
    series.forEach(({ values }, seriesIndex) => {
      const seriesName = seriesNames[expressionIndex][seriesIndex];
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
    isComplete: true,
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
function labelColumns(expressions: ExpressionResult[]): string[] {
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
function* samples(expressions: ExpressionResult[]) {
  for (const { result } of expressions) {
    for (const { metric, values } of result) {
      for (const [ts, value] of values) yield { metric, ts, value };
    }
  }
}

/**
 * Rows for a table tile: one per sample, with a column per Prometheus label,
 * including __name__, plus Timestamp and Value column. Every row carries the
 * same keys in the same order.
 */
export function toTableRows(
  expressions: ExpressionResult[],
  maxRows: number = MAX_TABLE_ROWS,
): ChartQueryResult {
  const labels = labelColumns(expressions);
  const taken = new Set(labels);
  const timeColumn = expressions.some(({ isBucketed }) => isBucketed)
    ? uniqueColumnName('Timestamp', taken)
    : undefined;
  if (timeColumn) taken.add(timeColumn);
  const valueColumn = uniqueColumnName('Value', taken);

  // Cap the total number of rows before the rows end up in the react-query cache.
  const data: Record<string, string | number>[] = [];
  for (const { metric, ts, value } of samples(expressions)) {
    if (data.length >= maxRows) break;
    const row: [string, string | number][] = [];
    if (timeColumn) row.push([timeColumn, new Date(ts * 1000).toISOString()]);
    for (const label of labels) {
      row.push([label, Object.hasOwn(metric, label) ? metric[label] : '']);
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
    isComplete: true,
  };
}

/**
 * Run a PromQL tile's expressions and shape the result like a ClickHouse
 * response, so the chart formatters treat it like every other source.
 */
export async function queryPromqlChartConfig(
  config: PromqlChartConfig & Pick<DateRange, 'minGranularitySeconds'>,
  dateRange: [Date, Date],
  signal: AbortSignal,
): Promise<ChartQueryResult> {
  // Expand dashboard variables and macros before sending to Prometheus.
  const substituted = substitutePromqlChartConfigTemplates({
    ...config,
    dateRange,
  });

  const results = await Promise.all(
    getQueriedPromqlSeries(substituted).map(series =>
      displayTypeSupportsInstantQuery(substituted) &&
      promqlSeriesQueryType(series) === 'instant'
        ? fetchInstantExpression(substituted, series, dateRange[1], signal)
        : fetchRangeExpression(substituted, series, dateRange, signal),
    ),
  );

  return substituted.displayType === DisplayType.Table
    ? toTableRows(results)
    : toChartRows(results, substituted.legendTemplate?.trim() || undefined);
}

/**
 * Aggregate samples for each series according to the specified reducer. A series
 * that reduces to nothing is dropped, reading as no value rather than a zero.
 */
export function reduceBucketRows(
  result: ChartQueryResult,
  reducer: PromqlReducer | undefined,
): ChartQueryResult {
  const samplesBySeries = new Map<string, number[]>();
  for (const row of result.data) {
    const name = String(row.series_name ?? '');
    const samples = samplesBySeries.get(name);
    if (samples) {
      samples.push(Number(row.value));
    } else {
      samplesBySeries.set(name, [Number(row.value)]);
    }
  }

  const data: Record<string, string | number>[] = [];
  for (const [seriesName, samples] of samplesBySeries) {
    const value = reducePromqlSamples(samples, reducer);
    if (value != null) data.push({ series_name: seriesName, value });
  }

  return {
    data,
    meta: [
      { name: 'series_name', type: 'String' },
      { name: 'value', type: 'Float64' },
    ],
    rows: data.length,
    isComplete: result.isComplete,
  };
}
