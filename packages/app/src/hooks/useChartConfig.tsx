import { useCallback } from 'react';
import {
  chSqlToAliasMap,
  ClickHouseQueryError,
  parameterizedQueryToSql,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  displayTypeSupportsReducer,
  getQueriedPromqlSeries,
  isRangeQuery,
} from '@hyperdx/common-utils/dist/core/promql';
import {
  isMetricChartConfig,
  isUsingGranularity,
  renderChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  hasPositiveSeriesLimit,
} from '@hyperdx/common-utils/dist/core/utils';
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
  isMetricSource,
  QuerySettings,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import { toStartOfInterval } from '@/ChartUtils';
import { useClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { useSource } from '@/source';
import { ChartQueryResult } from '@/types';
import { stripClientSideConfigFields } from '@/utils/chartConfig';
import {
  queryPromqlChartConfig,
  reduceBucketRows,
} from '@/utils/promqlChartQuery';
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
  /**
   * Scopes the hook's own query key. Prefer this to passing `queryKey`, which
   * replaces the key the hook builds from the config.
   */
  queryKeyPrefix?: string;
  /**
   * Query settings for this query only, added after the source's own query
   * settings. A setting that the source already defines keeps its value.
   * They are added to the query key, also when the caller passes `queryKey`.
   */
  additionalQuerySettings?: QuerySettings;
}

type TimeWindow = {
  dateRange: [Date, Date];
  dateRangeEndInclusive?: boolean;
};

type TQueryFnData = ChartQueryResult;

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

/**
 * Floor for "auto" granularity resolution, from the source's own setting.
 * Exported so callers that resolve 'auto' before reaching useQueriedChartConfig
 * (DBTimeChart and siblings, via ChartUtils.tsx) can apply it themselves.
 */
export function getMinGranularitySeconds(
  source: TSource | undefined,
): number | undefined {
  if (!source || !isMetricSource(source) || !source.minAutoGranularity) {
    return undefined;
  }
  return convertGranularityToSeconds(source.minAutoGranularity);
}

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
      ? convertDateRangeToGranularityString(
          config.dateRange,
          undefined,
          config.minGranularitySeconds,
        )
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
  // Only a positive seriesLimit emits the __hdx_series_limit CTE (0 = unlimited,
  // null = default), so only then does the ranking need a pinned date range.
  const seriesLimit =
    isBuilderChartConfig(config) && hasPositiveSeriesLimit(config.seriesLimit)
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

/**
 * Adds per-query settings after the source's query settings. A setting that the
 * source already defines keeps the source's value.
 */
export function mergeQuerySettings(
  sourceSettings: QuerySettings | undefined,
  additionalSettings: QuerySettings | undefined,
): QuerySettings | undefined {
  if (!additionalSettings?.length) {
    return sourceSettings;
  }
  const sourceSettingNames = new Set(
    (sourceSettings ?? []).map(({ setting }) => setting),
  );
  return [
    ...(sourceSettings ?? []),
    ...additionalSettings.filter(
      ({ setting }) => !sourceSettingNames.has(setting),
    ),
  ];
}

/** Append the given chunk to the given accumulated result. Exported for tests. */
export function appendChunk(
  accumulated: TQueryFnData,
  { chunk, isComplete }: TChunk,
): TQueryFnData {
  const chunkData = chunk.data || [];
  const accumulatedData = accumulated?.data || [];
  // Fast path for the first/only chunk (always the case for raw SQL, which is
  // never chunked): reuse the chunk's array instead of spreading it into a new
  // one. Avoids an O(rows) copy of a potentially very large (100k+) row array.
  const data =
    accumulatedData.length === 0
      ? chunkData
      : [...chunkData, ...accumulatedData];
  return {
    data,
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
  const minGranularitySeconds = getMinGranularitySeconds(source);

  // A PromQL range query keeps every bucket in the cache and is reduced to a
  // single value per series on read.
  const reducesRangeBuckets =
    isPromqlChartConfig(config) &&
    displayTypeSupportsReducer(config) &&
    isRangeQuery(config);
  const rangeReducer = reducesRangeBuckets
    ? getQueriedPromqlSeries(config)[0]?.reducer
    : undefined;

  const selectRangeReduced = useCallback(
    (result: TQueryFnData) => reduceBucketRows(result, rangeReducer),
    [rangeReducer],
  );

  const query = useQuery<TQueryFnData, ClickHouseQueryError | Error>({
    // Include enableQueryChunking in the query key to ensure that queries with the
    // same config but different enableQueryChunking values do not share a query.
    // minGranularitySeconds too: it can change independently of `config`.
    // Strip fields that only affect the client-side processing and thus should not
    // trigger a requery when changed.
    queryKey: [
      ...(options?.queryKeyPrefix ? [options?.queryKeyPrefix] : []),
      stripClientSideConfigFields(config),
      options?.enableQueryChunking ?? false,
      options?.enableParallelQueries ?? false,
      minGranularitySeconds,
      ...(options?.additionalQuerySettings?.length
        ? [options.additionalQuerySettings]
        : []),
    ],
    // TODO: Replace this with `streamedQuery` when it is no longer experimental. Use 'replace' refetch mode.
    // https://tanstack.com/query/latest/docs/reference/streamedQuery
    queryFn: async context => {
      // PromQL queries go through the Prometheus API route, not ClickHouse proxy
      if (isPromqlChartConfig(config) && config.dateRange) {
        return queryPromqlChartConfig(config, config.dateRange, context.signal);
      }

      const optimizedConfig = {
        ...(mvOptimizationData?.optimizedConfig ?? config),
        minGranularitySeconds,
      };
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
        querySettings: mergeQuerySettings(
          source?.querySettings,
          options?.additionalQuerySettings,
        ),
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
    // PromQL reducer is applied as a client-side react-query select function
    select: reducesRangeBuckets ? selectRangeReduced : undefined,
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
    ...(options?.queryKey && options.additionalQuerySettings?.length
      ? { queryKey: [...options.queryKey, options.additionalQuerySettings] }
      : {}),
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
  options?: Partial<UseQueryOptions<string>>,
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
  const minGranularitySeconds = getMinGranularitySeconds(source);

  const query = useQuery({
    // See the analogous queryKey comment on useQueriedChartConfig above.
    queryKey: ['renderedSql', config, minGranularitySeconds],
    queryFn: async () => {
      const optimizedConfig = {
        ...(mvOptimizationData?.optimizedConfig ?? config),
        minGranularitySeconds,
      };
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
      if ('configType' in config && config.configType === 'promql') {
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
