import {
  displayTypeSupportsInstantQuery,
  displayTypeSupportsReducer,
  getQueriedPromqlSeries,
  isRangeQuery,
  promqlSeriesQueryType,
  promqlStep,
  reducePromqlSamples,
} from '@hyperdx/common-utils/dist/core/promql';
import { renderPromqlSeriesNames } from '@hyperdx/common-utils/dist/core/seriesNameTemplate';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  getAlignedDateRange,
} from '@hyperdx/common-utils/dist/core/utils';
import { substitutePromqlChartConfigTemplates } from '@hyperdx/common-utils/dist/macros';
import type {
  ChartVariable,
  PromqlSavedChartConfig,
  PromqlSeries,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';

import {
  PromqlQuery,
  PromqlQueryData,
  PromQLQueryError,
  resolvePromqlQueryBackend,
  resolvePromqlTarget,
  runPromqlQuery,
} from '@/controllers/promql';

/** The tile fields that decide what a PromQL tile queries and how its result is shaped. */
type PromqlTileConfig = Pick<
  PromqlSavedChartConfig,
  | 'promqlExpression'
  | 'displayType'
  | 'granularity'
  | 'alignDateRangeToGranularity'
  | 'legendTemplate'
>;

/** The bucket count the app's time charts size an `auto` granularity for. */
const AUTO_GRANULARITY_MAX_BUCKETS = 80;

/**
 * The queries a PromQL tile sends, one per expression its display type plots.
 * Granularity, alignment and query type follow the app's chart converters, so
 * the tile returns the same samples it shows on the dashboard.
 */
export function buildPromqlTileQueries({
  config,
  dateRange,
  minGranularitySeconds,
  variables,
}: {
  config: PromqlTileConfig;
  dateRange: [Date, Date];
  minGranularitySeconds?: number;
  variables?: ChartVariable[];
}): (PromqlSeries & { query: PromqlQuery })[] {
  const granularity: SQLInterval =
    !config.granularity || config.granularity === 'auto'
      ? convertDateRangeToGranularityString(
          dateRange,
          AUTO_GRANULARITY_MAX_BUCKETS,
          minGranularitySeconds,
        )
      : config.granularity;

  const allowsInstant = displayTypeSupportsInstantQuery(config);

  const alignedRange =
    (!allowsInstant || isRangeQuery(config)) &&
    config.alignDateRangeToGranularity !== false
      ? getAlignedDateRange(dateRange, granularity)
      : dateRange;

  const substituted = substitutePromqlChartConfigTemplates({
    ...config,
    granularity,
    dateRange: alignedRange,
    minGranularitySeconds,
    variables,
  });

  const [startSec, endSec] = alignedRange.map(date => date.getTime() / 1000);

  // promqlStep answers a Prometheus duration such as "60s".
  const stepSec = Number.parseFloat(
    promqlStep(granularity, alignedRange, minGranularitySeconds),
  );

  return getQueriedPromqlSeries(substituted).map(series => ({
    ...series,
    query:
      allowsInstant && promqlSeriesQueryType(series) === 'instant'
        ? { kind: 'instant', expr: series.expression, timeSec: endSec }
        : {
            kind: 'range',
            expr: series.expression,
            startSec,
            endSec,
            stepSec,
          },
  }));
}

type SampledSeries = {
  metric: Record<string, string>;
  values: [number, number][];
};

/** One expression's result, with its samples parsed. */
type PromqlExpressionSamples = PromqlSeries & {
  /** Whether the result is bucketed by time. */
  isBucketed: boolean;
  result: SampledSeries[];
};

function toSamples(
  data: PromqlQueryData,
): Pick<PromqlExpressionSamples, 'isBucketed' | 'result'> {
  switch (data.resultType) {
    case 'matrix':
      return {
        isBucketed: true,
        result: data.result.map(({ metric, values }) => ({
          metric,
          values: values.map(([ts, value]) => [ts, Number.parseFloat(value)]),
        })),
      };
    case 'vector':
      return {
        isBucketed: false,
        result: data.result.map(({ metric, value }) => ({
          metric,
          values: [[value[0], Number.parseFloat(value[1])]],
        })),
      };
    case 'scalar':
      return {
        isBucketed: false,
        result: [
          {
            metric: {},
            values: [[data.result[0], Number.parseFloat(data.result[1])]],
          },
        ],
      };
    case 'string':
      throw new PromQLQueryError(
        'A PromQL chart needs numeric samples; this expression returned a string.',
        'user',
      );
  }
}

/**
 * A PromQL tile's result as chart rows, named like the dashboard names its
 * series. Number, pie and bar tiles reduce each series to one value. Each
 * series' labels are listed once in `seriesLabels` rather than on every row.
 */
export function toPromqlTileResult(
  config: PromqlTileConfig,
  expressions: PromqlExpressionSamples[],
) {
  const names = renderPromqlSeriesNames(
    expressions,
    config.legendTemplate?.trim() || undefined,
  );
  const reduces = displayTypeSupportsReducer(config);
  const reducer = getQueriedPromqlSeries(config)[0]?.reducer;

  const isBucketed = !reduces && expressions.some(e => e.isBucketed);

  const data: Record<string, string | number>[] = [];

  const seriesLabels = new Map<string, Record<string, string>>();

  // Names come back grouped by expression in series order, so they line up
  // with the series once both are flattened.
  const seriesNames = names.flat();
  expressions
    .flatMap(({ result }) => result)
    .forEach(({ metric, values }, i) => {
      const series_name = seriesNames.at(i) ?? '';
      if (reduces) {
        const value = reducePromqlSamples(
          values.map(([, sample]) => sample),
          reducer,
        );
        // A series with no usable sample reads as no value, not zero.
        if (value == null) return;
        seriesLabels.set(series_name, metric);
        data.push({ series_name, value });
        return;
      }
      seriesLabels.set(series_name, metric);
      for (const [ts, value] of values) {
        data.push(
          isBucketed
            ? {
                __hdx_time_bucket: new Date(ts * 1000).toISOString(),
                series_name,
                value,
              }
            : { series_name, value },
        );
      }
    });

  return {
    data,
    meta: [
      ...(isBucketed
        ? [{ name: '__hdx_time_bucket', type: 'DateTime64(3)' }]
        : []),
      { name: 'series_name', type: 'String' },
      { name: 'value', type: 'Float64' },
    ],
    rows: data.length,
    seriesLabels: Object.fromEntries(seriesLabels),
  };
}

/**
 * Runs a PromQL tile and returns its rows. Throws PromQLQueryError for a
 * missing source or a rejected or failed query, and ClickHouse errors from the
 * table-function backend.
 */
export async function runPromqlTile({
  teamId,
  config,
  dateRange,
  variables,
  signal,
}: {
  teamId: string;
  config: PromqlTileConfig & Pick<PromqlSavedChartConfig, 'source'>;
  dateRange: [Date, Date];
  variables?: ChartVariable[];
  signal?: AbortSignal;
}) {
  const target = await resolvePromqlTarget(teamId, config.source, {
    selectPassword: true,
  });
  if ('error' in target) {
    throw new PromQLQueryError(
      `${target.error}: ${config.source}. Call clickstack_list_sources to discover available source IDs.`,
      'user',
    );
  }

  const queries = buildPromqlTileQueries({
    config,
    dateRange,
    minGranularitySeconds: target.minAutoGranularity
      ? convertGranularityToSeconds(target.minAutoGranularity as SQLInterval)
      : undefined,
    variables,
  });

  // One backend for every expression: resolving a ClickHouse backend probes
  // the server for its Prometheus HTTP API.
  const backend = await resolvePromqlQueryBackend(target);
  const expressions = await Promise.all(
    queries.map(async ({ query, ...series }) => ({
      ...series,
      ...toSamples(await runPromqlQuery(backend, query, signal)),
    })),
  );
  return toPromqlTileResult(config, expressions);
}
