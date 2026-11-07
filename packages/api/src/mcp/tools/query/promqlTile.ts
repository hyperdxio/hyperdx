import {
  displayTypeSupportsReducer,
  getQueriedPromqlSeries,
} from '@hyperdx/common-utils/dist/core/promql';
import {
  getPromqlChartQueries,
  getPromqlChartRange,
  PromqlExpressionSamples,
  PromqlQuery,
  reducePromqlChartRows,
  toPromqlChartResult,
  toPromqlSamples,
} from '@hyperdx/common-utils/dist/core/promqlChart';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import type {
  ChartVariable,
  PromqlSavedChartConfig,
  PromqlSeries,
} from '@hyperdx/common-utils/dist/types';

import {
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
  | 'heatmap'
>;

/**
 * The queries a PromQL tile sends, one per expression its display type plots.
 * Granularity, alignment and query type are the dashboard's, so the tile
 * returns the same samples it shows there.
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
  const range = getPromqlChartRange({
    ...config,
    dateRange,
    minGranularitySeconds,
  });
  return getPromqlChartQueries(
    {
      ...config,
      granularity: range.granularity,
      minGranularitySeconds,
      variables,
    },
    range.dateRange,
  );
}

/**
 * A PromQL tile's result in the rows the dashboard draws. Number, pie and bar
 * tiles reduce each series to one value. Each series' labels are listed once
 * in `seriesLabels` rather than on every row.
 */
export function toPromqlTileResult(
  config: PromqlTileConfig,
  expressions: PromqlExpressionSamples[],
) {
  const { promqlSeriesLabels, ...rows } = toPromqlChartResult(
    config,
    expressions,
  );
  if (!displayTypeSupportsReducer(config)) {
    // Table and histogram rows carry no per-series labels; leave the key out.
    return {
      ...rows,
      ...(promqlSeriesLabels ? { seriesLabels: promqlSeriesLabels } : {}),
    };
  }
  const reduced = reducePromqlChartRows(
    rows,
    getQueriedPromqlSeries(config)[0]?.reducer,
  );
  const labelsByName = new Map(Object.entries(promqlSeriesLabels ?? {}));
  return {
    ...reduced,
    seriesLabels: Object.fromEntries(
      reduced.data.flatMap(({ series_name }) => {
        const labels = labelsByName.get(String(series_name));
        return labels ? [[series_name, labels]] : [];
      }),
    ),
  };
}

/**
 * Runs a PromQL tile and returns its rows. Throws PromQLQueryError for a
 * missing source or a rejected or failed query, PromqlChartError for a result
 * the tile can't draw, and ClickHouse errors from the table-function backend.
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
      ? convertGranularityToSeconds(target.minAutoGranularity)
      : undefined,
    variables,
  });

  // One backend for every expression: resolving a ClickHouse backend probes
  // the server for its Prometheus HTTP API.
  const backend = await resolvePromqlQueryBackend(target);
  const expressions = await Promise.all(
    queries.map(async ({ query, ...series }) => ({
      ...series,
      ...toPromqlSamples(await runPromqlQuery(backend, query, signal)),
    })),
  );
  return toPromqlTileResult(config, expressions);
}
