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
  // copied from DBTimeChart
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
    queryKey: [queryKeyPrefix, queriedConfig],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData, // no need to flash loading state when in live tail
  });

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
    <Text size="xs" c="gray.4" mb={4} data-testid="search-total-count">
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
