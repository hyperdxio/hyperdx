import type { QueryAttribution } from '@hyperdx/common-utils/dist/clickhouse';
import {
  getPromqlChartQueries,
  PromqlExpressionSamples,
  PromqlQuery,
  reducePromqlChartRows,
  toPromqlChartResult,
  toPromqlSamples,
} from '@hyperdx/common-utils/dist/core/promqlChart';
import {
  DateRange,
  PromqlChartConfig,
  PromqlReducer,
  PromqlSeries,
} from '@hyperdx/common-utils/dist/types';

import { prometheusApi } from '@/api';
import { ChartQueryResult } from '@/types';

/** Evaluate one expression's query at the instant or range endpoint. */
async function fetchExpression(
  config: PromqlChartConfig,
  { query, ...series }: PromqlSeries & { query: PromqlQuery },
  signal: AbortSignal,
  attribution: QueryAttribution,
): Promise<PromqlExpressionSamples> {
  const response =
    query.kind === 'instant'
      ? await prometheusApi.query({
          query: query.expr,
          time: query.timeSec,
          sourceId: config.source,
          limit: query.limit,
          signal,
          attribution,
        })
      : await prometheusApi.queryRange({
          query: query.expr,
          start: query.startSec,
          end: query.endSec,
          step: `${query.stepSec}s`,
          sourceId: config.source,
          signal,
          attribution,
        });

  if (response.status !== 'success' || !response.data) {
    throw new Error(response.error ?? 'PromQL query failed');
  }
  return { ...series, ...toPromqlSamples(response.data) };
}

/**
 * Run a PromQL tile's expressions and shape the result like a ClickHouse
 * response, so the chart formatters treat it like every other source.
 */
export async function queryPromqlChartConfig(
  config: PromqlChartConfig & Pick<DateRange, 'minGranularitySeconds'>,
  dateRange: [Date, Date],
  signal: AbortSignal,
  // Required so a new caller can't forget it and leave its queries untagged.
  attribution: QueryAttribution,
): Promise<ChartQueryResult> {
  const results = await Promise.all(
    getPromqlChartQueries(config, dateRange).map(query =>
      fetchExpression(config, query, signal, attribution),
    ),
  );
  return { ...toPromqlChartResult(config, results), isComplete: true };
}

/**
 * Aggregate samples for each series according to the specified reducer. A series
 * that reduces to nothing is dropped, reading as no value rather than a zero.
 */
export function reduceBucketRows(
  result: ChartQueryResult,
  reducer: PromqlReducer | undefined,
): ChartQueryResult {
  return {
    ...reducePromqlChartRows(result, reducer),
    isComplete: result.isComplete,
  };
}
