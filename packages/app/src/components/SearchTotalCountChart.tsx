import { useMemo } from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';

import {
  inferCountColumn,
  type SearchHistogramQueryOptions,
  useSearchHistogramQuery,
} from '@/hooks/useSearchHistogramQuery';

export function useSearchTotalCount(
  config: BuilderChartConfigWithDateRange,
  queryKeyPrefix: string,
  options: SearchHistogramQueryOptions = {},
) {
  // Shares the histogram's React Query cache entry, so this adds no extra query.
  const {
    data: totalCountData,
    isLoading,
    isError,
    error,
  } = useSearchHistogramQuery(config, queryKeyPrefix, options);

  const isTotalCountComplete = !!totalCountData?.isComplete;

  const totalCount = useMemo(() => {
    const countColumn = inferCountColumn(totalCountData?.meta);
    return totalCountData?.data?.reduce(
      (p: number, v: any) => p + Number.parseInt(v[countColumn]),
      0,
    );
  }, [totalCountData]);

  return {
    totalCount,
    isLoading,
    isError,
    error,
    isTotalCountComplete,
  };
}

export default function SearchTotalCountChart({
  config,
  queryKeyPrefix,
  disableQueryChunking,
  enableParallelQueries,
}: {
  config: BuilderChartConfigWithDateRange;
  queryKeyPrefix: string;
  disableQueryChunking?: boolean;
  enableParallelQueries?: boolean;
}) {
  const { totalCount, isLoading, isError } = useSearchTotalCount(
    config,
    queryKeyPrefix,
    {
      disableQueryChunking,
      enableParallelQueries,
    },
  );

  return (
    <Text data-testid="search-total-count" size="xs" lh="normal">
      {isLoading ? (
        <span className="effect-pulse">&middot;&middot;&middot; Results</span>
      ) : totalCount !== null && !isError ? (
        `${totalCount?.toLocaleString()} Results`
      ) : (
        '0 Results'
      )}
    </Text>
  );
}
