import { useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';
import { keepPreviousData } from '@tanstack/react-query';

import api from '@/api';
import { convertToTimeChartConfig } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

function inferCountColumn(meta: ResponseJSON['meta'] | undefined): string {
  if (!meta) return 'count()';
  if (meta.find(col => col.name === 'count()')) {
    return 'count()';
  }

  // The column may be named differently, particularly when using Materialized Views.
  return (
    filterColumnMetaByType(meta, [JSDataType.Number])?.[0].name ?? 'count()'
  );
}

export function useSearchTotalCount(
  config: ChartConfigWithDateRange,
  queryKeyPrefix: string,
  {
    disableQueryChunking,
    enableParallelQueries,
  }: {
    disableQueryChunking?: boolean;
    enableParallelQueries?: boolean;
  } = {},
) {
  // queriedConfig, queryKey, and enableQueryChunking match DBTimeChart so that react query can de-dupe these queries.
  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(config),
    [config],
  );

  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const {
    data: totalCountData,
    isLoading,
    isError,
  } = useQueriedChartConfig(queriedConfig, {
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
    isTotalCountComplete,
  };
}

export default function SearchTotalCountChart({
  config,
  queryKeyPrefix,
  disableQueryChunking,
  enableParallelQueries,
}: {
  config: ChartConfigWithDateRange;
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
    <Text size="xs" mb={4}>
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
