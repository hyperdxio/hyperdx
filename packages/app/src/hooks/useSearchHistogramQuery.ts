import { useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { keepPreviousData } from '@tanstack/react-query';

import api from '@/api';
import { convertToTimeChartConfig } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

export type SearchHistogramQueryOptions = {
  disableQueryChunking?: boolean;
  enableParallelQueries?: boolean;
};

/**
 * The single source of truth for the search page's histogram query.
 *
 * The histogram (DBTimeChart), the total result count, and the severity legend
 * all need the same grouped-by-severity time series. Rather than each issuing
 * its own query, they all resolve from one React Query cache entry — which only
 * works while their query keys hash identically. Building that key in more than
 * one place has already proven easy to get subtly wrong (an explicit
 * `disableQueryChunking: false` hashes differently from an absent one, because
 * `JSON.stringify` drops undefined object values), so every search-page
 * consumer must go through this hook instead of assembling a key by hand.
 *
 * The key/option shape here must stay in sync with DBTimeChart's. That
 * invariant is covered by `__tests__/DBSearchPageQueryKey.test.tsx`.
 */
export function useSearchHistogramQuery(
  config: BuilderChartConfigWithDateRange,
  queryKeyPrefix: string,
  {
    disableQueryChunking,
    enableParallelQueries,
  }: SearchHistogramQueryOptions = {},
) {
  const { data: me, isLoading: isLoadingMe } = api.useMe();

  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(config),
    [config],
  );

  return useQueriedChartConfig(queriedConfig, {
    queryKey: [
      queryKeyPrefix,
      queriedConfig,
      'chunked',
      {
        disableQueryChunking,
        enableParallelQueries,
        parallelizeWhenPossible: me?.team?.parallelizeWhenPossible,
      },
    ],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData, // no need to flash loading state when in live tail
    enableQueryChunking: true,
    enabled: !isLoadingMe,
  });
}

export function inferCountColumn(
  meta: ResponseJSON['meta'] | undefined,
): string {
  if (!meta) return 'count()';
  if (meta.find(col => col.name === 'count()')) {
    return 'count()';
  }

  // The column may be named differently, particularly when using Materialized Views.
  return (
    filterColumnMetaByType(meta, [JSDataType.Number])?.[0]?.name ?? 'count()'
  );
}
