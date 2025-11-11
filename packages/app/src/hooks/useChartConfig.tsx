import { omit } from 'lodash';
import {
  chSqlToAliasMap,
  ClickHouseQueryError,
  parameterizedQueryToSql,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import {
  DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS,
  isMetricChartConfig,
  isUsingGranularity,
  renderChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
} from '@hyperdx/common-utils/dist/types';
import {
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import {
  convertDateRangeToGranularityString,
  toStartOfInterval,
} from '@/ChartUtils';
import { useClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { getMetadata } from '@/metadata';
import { generateTimeWindowsDescending } from '@/utils/searchWindows';

interface AdditionalUseQueriedChartConfigOptions {
  onError?: (error: Error | ClickHouseQueryError) => void;
  /**
   * Queries with large date ranges can be split into multiple smaller queries to
   * avoid overloading the ClickHouse server and running into timeouts. In some cases, such
   * as when data is being sampled across the entire range, this chunking is not desirable
   * and should be disabled.
   */
  enableQueryChunking?: boolean;
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
      ? convertDateRangeToGranularityString(
          config.dateRange,
          DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS,
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
}: {
  config: ChartConfigWithOptDateRange;
  clickhouseClient: ClickhouseClient;
  signal: AbortSignal;
  enableQueryChunking?: boolean;
}) {
  const windows =
    enableQueryChunking && shouldUseChunking(config)
      ? getGranularityAlignedTimeWindows(config)
      : [undefined];

  if (IS_MTVIEWS_ENABLED) {
    const { dataTableDDL, mtViewDDL, renderMTViewConfig } =
      await buildMTViewSelectQuery(config);
    // TODO: show the DDLs in the UI so users can run commands manually
    // eslint-disable-next-line no-console
    console.log('dataTableDDL:', dataTableDDL);
    // eslint-disable-next-line no-console
    console.log('mtViewDDL:', mtViewDDL);
    await renderMTViewConfig();
  }

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];

    const windowedConfig = {
      ...config,
      ...(window ?? {}),
    };

    const result = await clickhouseClient.queryChartConfig({
      config: windowedConfig,
      metadata: getMetadata(),
      opts: {
        abort_signal: signal,
      },
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
  const clickhouseClient = useClickhouseClient();
  const queryClient = useQueryClient();

  const query = useQuery<TQueryFnData, ClickHouseQueryError | Error>({
    // Include enableQueryChunking in the query key to ensure that queries with the
    // same config but different enableQueryChunking values do not share a query
    queryKey: [config, options?.enableQueryChunking ?? false],
    // TODO: Replace this with `streamedQuery` when it is no longer experimental. Use 'replace' refetch mode.
    // https://tanstack.com/query/latest/docs/reference/streamedQuery
    queryFn: async context => {
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
        config,
        clickhouseClient,
        signal: context.signal,
        enableQueryChunking: options?.enableQueryChunking,
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
  });
  if (query.isError && options?.onError) {
    options.onError(query.error);
  }
  return query;
}

export function useRenderedSqlChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: UseQueryOptions<string>,
) {
  return useQuery<string>({
    queryKey: ['renderedSql', config],
    queryFn: async () => {
      const query = await renderChartConfig(config, getMetadata());
      return format(parameterizedQueryToSql(query));
    },
    ...options,
  });
}

export function useAliasMapFromChartConfig(
  config: ChartConfigWithOptDateRange | undefined,
  options?: UseQueryOptions<Record<string, string>>,
) {
  return useQuery<Record<string, string>>({
    // Omit properties that don't affect SELECT aliases (time filters, result modifiers)
    // to prevent unnecessary refetches during live tail when only dateRange changes.
    // Everything else (select, from, with, groupBy, selectGroupBy, granularity, etc.) is kept.
    queryKey: [
      'aliasMap',
      omit(config, [
        'dateRange',
        'dateRangeEndInclusive',
        'where',
        'orderBy',
        'limit',
        'timestampValueExpression',
      ]),
    ],
    queryFn: async () => {
      if (config == null) {
        return {};
      }

      const query = await renderChartConfig(config, getMetadata());

      const aliasMap = chSqlToAliasMap(query);

      return aliasMap;
    },
    enabled: config != null,
    ...options,
  });
}
