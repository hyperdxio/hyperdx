import {
  chSqlToAliasMap,
  ClickHouseQueryError,
  parameterizedQueryToSql,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isMetricChartConfig,
  isUsingGranularity,
  renderChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import {
  BuilderChartConfigWithOptDateRange,
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  QuerySettings,
} from '@hyperdx/common-utils/dist/types';
import {
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import { prometheusApi } from '@/api';
import { toStartOfInterval } from '@/ChartUtils';
import { useClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { useSource } from '@/source';
import { generateTimeWindowsDescending } from '@/utils/searchWindows';

import { useMVOptimizationExplanation } from './useMVOptimizationExplanation';

interface AdditionalUseQueriedChartConfigOptions {
  onError?: (error: Error | ClickHouseQueryError) => void;
  /**
   * Queries with large date ranges can be split into multiple smaller queries to
   * avoid overloading the ClickHouse server and running into timeouts. In some cases, such
   * as when data is being sampled across the entire range, this chunking is not desirable
   * and should be disabled.
   */
  enableQueryChunking?: boolean;
  enableParallelQueries?: boolean;
}

type TimeWindow = {
  dateRange: [Date, Date];
  dateRangeEndInclusive?: boolean;
};

type TQueryFnData = Pick<ResponseJSON<any>, 'data' | 'meta' | 'rows'> & {
  isComplete: boolean;
};

type TChunk = {
  chunk: ResponseJSON<Record<string, string | number>>;
  isComplete: boolean;
};

const shouldUseChunking = (
  config: ChartConfigWithOptDateRange,
): config is ChartConfigWithDateRange & {
  granularity: string;
} => {
  // Avoid chunking for raw SQL charts since they can include arbitrary window functions, etc.
  if (isRawSqlChartConfig(config) || isPromqlChartConfig(config)) return false;

  // Granularity is required for chunking, otherwise we could break other group-bys.
  if (!isUsingGranularity(config)) return false;

  // Date range is required for chunking, otherwise we'd have infinite chunks, or some unbounded chunk(s).
  if (!config.dateRange) return false;

  // TODO: enable chunking for metric charts when we're confident chunking will not break
  // complex metric queries.
  if (isMetricChartConfig(config)) return false;

  return true;
};

export const getGranularityAlignedTimeWindows = (
  config: ChartConfigWithDateRange & { granularity: string },
  windowDurationsSeconds?: number[],
): TimeWindow[] => {
  const [startDate, endDate] = config.dateRange;
  const windowsUnaligned = generateTimeWindowsDescending(
    startDate,
    endDate,
    windowDurationsSeconds,
  );

  const granularity =
    config.granularity === 'auto'
      ? convertDateRangeToGranularityString(config.dateRange)
      : config.granularity;

  const windows = [];
  for (const [index, window] of windowsUnaligned.entries()) {
    // Align windows to chart buckets
    const alignedStart =
      index === windowsUnaligned.length - 1
        ? window.startTime
        : toStartOfInterval(window.startTime, granularity);
    const alignedEnd =
      index === 0 ? endDate : toStartOfInterval(window.endTime, granularity);

    // Skip windows that are covered by the previous window after it was aligned
    if (
      !windows.length ||
      alignedStart < windows[windows.length - 1].dateRange[0]
    ) {
      windows.push({
        dateRange: [alignedStart, alignedEnd] as [Date, Date],
        // Ensure that windows don't overlap by making all but the first (most recent) exclusive
        dateRangeEndInclusive:
          index === 0 ? config.dateRangeEndInclusive : false,
      });
    }
  }

  return windows;
};

async function* fetchDataInChunks({
  config,
  clickhouseClient,
  signal,
  enableQueryChunking = false,
  enableParallelQueries = false,
  metadata,
  querySettings,
}: {
  config: ChartConfigWithOptDateRange;
  clickhouseClient: ClickhouseClient;
  signal: AbortSignal;
  enableQueryChunking?: boolean;
  enableParallelQueries?: boolean;
  metadata: Metadata;
  querySettings: QuerySettings | undefined;
}) {
  const windows =
    enableQueryChunking && shouldUseChunking(config)
      ? getGranularityAlignedTimeWindows(config)
      : [undefined];

  // Every chunk must rank the __hdx_series_limit CTE over the same fixed
  // range, or each window keeps its own top-N and the union across chunks
  // exceeds seriesLimit. The newest window is used (rather than the full
  // chart range) to bound the ranking scan; the trade-off is that series
  // are picked by recent activity, so groups with no events in the newest
  // window are dropped from the chart.
  const rankingDateRange = windows[0]?.dateRange;
  const seriesLimit = isBuilderChartConfig(config)
    ? config.seriesLimit
    : undefined;
  const windowedConfigFor = (w: (typeof windows)[number]) => ({
    ...config,
    ...(w ?? {}),
    ...(w != null && seriesLimit != null && rankingDateRange != null
      ? { seriesLimitDateRange: rankingDateRange }
      : {}),
  });

  if (IS_MTVIEWS_ENABLED && isBuilderChartConfig(config)) {
    const { dataTableDDL, mtViewDDL, renderMTViewConfig } =
      await buildMTViewSelectQuery(config, metadata, querySettings);
    // TODO: show the DDLs in the UI so users can run commands manually
    // eslint-disable-next-line no-console
    console.log('dataTableDDL:', dataTableDDL);
    // eslint-disable-next-line no-console
    console.log('mtViewDDL:', mtViewDDL);
    await renderMTViewConfig();
  }

  // Readonly = 2 means the query is readonly but can still specify query settings.
  const clickHouseSettings = isRawSqlChartConfig(config)
    ? { readonly: '2' }
    : {};

  if (enableParallelQueries) {
    // fetch in parallel
    const promises = windows.map(async (w, index) => {
      const windowedConfig = windowedConfigFor(w);
      return {
        index,
        queryResult: await clickhouseClient.queryChartConfig({
          config: windowedConfig,
          metadata,
          opts: {
            abort_signal: signal,
            clickhouse_settings: clickHouseSettings,
          },
          querySettings,
        }),
      };
    });
    const remainingPromises = [...promises];
    const bufferedChunks = new Array(windows.length);
    let flushed = 0;
    for (let i = 0; i < promises.length; i++) {
      // receive any promise in the array that resolves
      const { index, queryResult } = await Promise.race(remainingPromises);
      // add to an ordered buffer array, keeping in mind the flushed count thus far
      bufferedChunks[index - flushed] = queryResult;
      // use promises array (doesn't change in size) to find the index in the ever-changing remainingPromises array
      const resolvedPromiseIdx = remainingPromises.indexOf(promises[index]);
      // use found index to remove entry from remainingPromises
      remainingPromises.splice(resolvedPromiseIdx, 1);
      // while bufferedChunks has in-ordered data, flush it
      while (bufferedChunks.length > 0 && bufferedChunks[0] !== undefined) {
        // remove data from front so that it always arrives in order
        const chunk = bufferedChunks.shift();
        yield { chunk, isComplete: bufferedChunks.length === 0 };
        flushed += 1;
      }
    }
    return;
  }

  // fetch in series
  for (let i = 0; i < windows.length; i++) {
    const windowedConfig = windowedConfigFor(windows[i]);

    const result = await clickhouseClient.queryChartConfig({
      config: windowedConfig,
      metadata,
      opts: {
        abort_signal: signal,
      },
      querySettings,
    });

    yield { chunk: result, isComplete: i === windows.length - 1 };
  }
}

/** Append the given chunk to the given accumulated result */
function appendChunk(
  accumulated: TQueryFnData,
  { chunk, isComplete }: TChunk,
): TQueryFnData {
  return {
    data: [...(chunk.data || []), ...(accumulated?.data || [])],
    meta: chunk.meta,
    rows: (accumulated?.rows || 0) + (chunk.rows || 0),
    isComplete,
  };
}

/**
 * A hook providing data queried based on the provided chart config.
 *
 * If all of the following are true, the query will be chunked into multiple smaller queries:
 * - The config includes a dateRange, granularity, and timestampValueExpression
 * - `options.enableQueryChunking` is true
 *
 * For chunked queries, note the following:
 * - `config.limit`, if provided, is applied to each chunk, so the total number
 *    of rows returned may be up to `limit * number_of_chunks`.
 * - The returned data will be ordered within each chunk, and chunks will
 *    be ordered oldest-first, by the `timestampValueExpression`.
 * - `isPending` is true until the first chunk is fetched. Once the first chunk
 *    is available, `isPending` will be false and `isSuccess` will be true.
 *    `isFetching` will be true until all chunks have been fetched.
 * - `data.isComplete` indicates whether all chunks have been fetched.
 */
export function useQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<TQueryFnData>> &
    AdditionalUseQueriedChartConfigOptions,
) {
  const { enabled = true } = options ?? {};
  const clickhouseClient = useClickhouseClient();
  const queryClient = useQueryClient();
  const metadata = useMetadataWithSettings();

  const builderConfig = isBuilderChartConfig(config) ? config : undefined;
  const { data: mvOptimizationData, isLoading: isLoadingMVOptimization } =
    useMVOptimizationExplanation(builderConfig, {
      enabled: !!enabled && !!builderConfig,
      placeholderData: undefined,
    });

  const { data: source, isLoading: isSourceLoading } = useSource({
    id: config.source,
  });

  const query = useQuery<TQueryFnData, ClickHouseQueryError | Error>({
    // Include enableQueryChunking in the query key to ensure that queries with the
    // same config but different enableQueryChunking values do not share a query
    queryKey: [
      config,
      options?.enableQueryChunking ?? false,
      options?.enableParallelQueries ?? false,
    ],
    // TODO: Replace this with `streamedQuery` when it is no longer experimental. Use 'replace' refetch mode.
    // https://tanstack.com/query/latest/docs/reference/streamedQuery
    queryFn: async context => {
      // PromQL queries go through the Prometheus API route, not ClickHouse proxy
      if (isPromqlChartConfig(config) && config.dateRange) {
        const [startDate, endDate] = config.dateRange;
        const startSec = startDate.getTime() / 1000;
        const endSec = endDate.getTime() / 1000;

        // Convert HyperDX granularity ("5 minute") to Prometheus step ("300s")
        let stepStr = '60s';
        if (config.granularity && config.granularity !== 'auto') {
          const granToSec: Record<string, number> = {
            '15 second': 15,
            '30 second': 30,
            '1 minute': 60,
            '5 minute': 300,
            '10 minute': 600,
            '15 minute': 900,
            '30 minute': 1800,
            '1 hour': 3600,
            '2 hour': 7200,
            '6 hour': 21600,
            '12 hour': 43200,
            '1 day': 86400,
          };
          stepStr = `${granToSec[config.granularity] ?? 60}s`;
        }

        const resp = await prometheusApi.queryRange({
          query: config.promqlExpression,
          start: startSec,
          end: endSec,
          step: stepStr,
          connectionId: config.connection,
          database: config.from?.databaseName ?? 'default',
          table: config.from?.tableName ?? 'otel_metrics_ts',
        });

        if (resp.status !== 'success' || !resp.data) {
          throw new Error(resp.error ?? 'PromQL query failed');
        }

        // Transform Prometheus matrix response into chart-compatible format.
        // Use Grafana-style legends: only show labels that differ across series.
        const allSeries = resp.data.result;

        // Find labels that have more than one distinct value across all series
        const labelValueSets = new Map<string, Set<string>>();
        for (const s of allSeries) {
          for (const [k, v] of Object.entries(s.metric)) {
            if (k === '__name__') continue;
            if (!labelValueSets.has(k)) labelValueSets.set(k, new Set());
            labelValueSets.get(k)!.add(v);
          }
        }
        const distinguishingKeys = new Set<string>();
        for (const [k, vs] of labelValueSets) {
          if (vs.size > 1) distinguishingKeys.add(k);
        }

        const data: Record<string, string | number>[] = [];
        for (const series of allSeries) {
          const metricName = series.metric.__name__ ?? '';
          const labels = Object.entries(series.metric)
            .filter(([k]) => k !== '__name__' && distinguishingKeys.has(k))
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
          const seriesName = labels ? `${metricName}{${labels}}` : metricName;

          for (const [ts, val] of series.values) {
            data.push({
              __hdx_time_bucket: new Date(ts * 1000).toISOString(),
              value: parseFloat(val),
              series_name: seriesName,
            });
          }
        }

        return {
          data,
          meta: [
            { name: '__hdx_time_bucket', type: 'DateTime64(3)' },
            { name: 'value', type: 'Float64' },
            { name: 'series_name', type: 'String' },
          ],
          rows: data.length,
          isComplete: true,
        };
      }

      const optimizedConfig = mvOptimizationData?.optimizedConfig ?? config;
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: context.queryKey, exact: true });
      const isRefetch = !!query && query.state.data !== undefined;

      const emptyValue: TQueryFnData = {
        data: [],
        meta: [],
        rows: 0,
        isComplete: false,
      };

      const chunks = fetchDataInChunks({
        config: optimizedConfig,
        clickhouseClient,
        signal: context.signal,
        enableQueryChunking: options?.enableQueryChunking,
        enableParallelQueries: options?.enableParallelQueries,
        metadata,
        querySettings: source?.querySettings,
      });

      let accumulatedChunks: TQueryFnData = emptyValue;
      for await (const chunk of chunks) {
        if (context.signal.aborted) {
          break;
        }

        accumulatedChunks = appendChunk(accumulatedChunks, chunk);

        // When refetching, the cache is not updated until all chunks are fetched.
        if (!isRefetch) {
          queryClient.setQueryData<TQueryFnData>(
            context.queryKey,
            accumulatedChunks,
          );
        }
      }

      if (isRefetch && !context.signal.aborted) {
        queryClient.setQueryData<TQueryFnData>(
          context.queryKey,
          accumulatedChunks,
        );
      }

      return queryClient.getQueryData(context.queryKey)!;
    },
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
    enabled: enabled && !isLoadingMVOptimization && !isSourceLoading,
  });

  if (query.isError && options?.onError) {
    options.onError(query.error);
  }
  return {
    ...query,
    isLoading: query.isLoading || isLoadingMVOptimization,
  };
}

export function useRenderedSqlChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: UseQueryOptions<string>,
) {
  const { enabled = true } = options ?? {};

  const metadata = useMetadataWithSettings();

  const builderConfig = isBuilderChartConfig(config) ? config : undefined;
  const { data: mvOptimizationData, isLoading: isLoadingMVOptimization } =
    useMVOptimizationExplanation(builderConfig, {
      enabled: !!enabled && !!builderConfig,
      placeholderData: undefined,
    });

  const { data: source, isLoading: isSourceLoading } = useSource({
    id: config.source,
  });

  const query = useQuery({
    queryKey: ['renderedSql', config],
    queryFn: async () => {
      const optimizedConfig = mvOptimizationData?.optimizedConfig ?? config;
      const query = await renderChartConfig(
        optimizedConfig,
        metadata,
        source?.querySettings,
      );
      const sql = parameterizedQueryToSql(query);
      // sql-formatter can't handle prometheusQuery() / CTE syntax in PromQL queries
      if (isPromqlChartConfig(config)) {
        return sql;
      }
      return format(sql);
    },
    ...options,
    enabled:
      enabled &&
      !isLoadingMVOptimization &&
      !isSourceLoading &&
      !isPromqlChartConfig(config),
  });

  return {
    ...query,
    isLoading: query.isLoading || isLoadingMVOptimization,
  };
}

export function useAliasMapFromChartConfig(
  config: BuilderChartConfigWithOptDateRange | undefined,
  options?: UseQueryOptions<Record<string, string>>,
) {
  // For granularity: 'auto', the bucket size depends on dateRange duration (not absolute times).
  // Include duration in key to detect when bucket size changes, but omit absolute times
  // to prevent refetches when the time window just slides forward (e.g., live tail).
  const dateRangeDuration =
    config?.dateRange && isUsingGranularity(config)
      ? config.dateRange[1].getTime() - config.dateRange[0].getTime()
      : undefined;

  const metadata = useMetadataWithSettings();

  return useQuery<Record<string, string>>({
    // Only include config properties that affect SELECT structure and aliases.
    // When adding new ChartConfig fields, check renderChartConfig.ts to see if they
    // affect the SELECT clause. If yes, add them here to avoid stale alias maps.
    queryKey: [
      'aliasMap',
      config?.select,
      config?.from,
      config?.connection,
      config?.with,
      config?.groupBy,
      config?.selectGroupBy,
      config?.granularity,
      config?.seriesReturnType,
      dateRangeDuration,
    ],
    queryFn: async () => {
      if (config == null) {
        return {};
      }

      // PromQL queries use prometheusQuery() which node-sql-parser can't parse.
      // Return a fixed alias map since the column names are known.
      // Check configType directly since the TS type may not include PromQL here.
      if (
        'configType' in config &&
        (config as { configType: string }).configType === 'promql'
      ) {
        return {
          __hdx_time_bucket: '__hdx_time_bucket',
          value: 'value',
          series_name: 'series_name',
        };
      }

      const query = await renderChartConfig(
        config,
        metadata,
        undefined, // no query settings for creating alias map
      );

      const aliasMap = chSqlToAliasMap(query);

      return aliasMap;
    },
    enabled: config != null,
    ...options,
  });
}
