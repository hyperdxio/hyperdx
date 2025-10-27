import { useMemo } from 'react';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';
import { keepPreviousData } from '@tanstack/react-query';

import { useTimeChartSettings } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

export function useSearchTotalCount(
  config: ChartConfigWithDateRange,
  queryKeyPrefix: string,
) {
  // queriedConfig, queryKey, and enableQueryChunking match DBTimeChart so that react query can de-dupe these queries.
  const { granularity } = useTimeChartSettings(config);
  const queriedConfig = {
    ...config,
    granularity,
    limit: { limit: 100000 },
  };
  const {
    data: totalCountData,
    isLoading,
    isError,
  } = useQueriedChartConfig(queriedConfig, {
    queryKey: [queryKeyPrefix, queriedConfig, 'chunked'],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData, // no need to flash loading state when in live tail
    enableQueryChunking: true,
  });

  const isTotalCountComplete = !!totalCountData?.isComplete;

  const totalCount = useMemo(() => {
    return totalCountData?.data?.reduce(
      (p: number, v: any) => p + Number.parseInt(v['count()']),
      0,
    );
  }, [totalCountData]);

  return {
    totalCount,
    isLoading,
    isError,
    isTotalCountComplete,
  };
}

export default function SearchTotalCountChart({
  config,
  queryKeyPrefix,
}: {
  config: ChartConfigWithDateRange;
  queryKeyPrefix: string;
}) {
  const { totalCount, isLoading, isError } = useSearchTotalCount(
    config,
    queryKeyPrefix,
  );

  return (
    <Text size="xs" c="gray.4" mb={4}>
      {isLoading ? (
        <span className="effect-pulse">&middot;&middot;&middot; Results</span>
      ) : totalCount !== null && !isError ? (
        `${totalCount} Results`
      ) : (
        '0 Results'
      )}
    </Text>
  );
}
