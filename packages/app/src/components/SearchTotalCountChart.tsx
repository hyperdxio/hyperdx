import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
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
  config: BuilderChartConfigWithDateRange,
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

function isAprilFools(): boolean {
  try {
    if (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('aprilFools')
    ) {
      return true;
    }
    const now = new Date();
    return now.getMonth() === 3 && now.getDate() === 1;
  } catch {
    return false;
  }
}

let _sessionHighScore = 0;

function useHighScore(totalCount: number | undefined) {
  const [highScore, setHighScore] = useState(_sessionHighScore);
  const [celebrating, setCelebrating] = useState(false);
  const prevCountRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (totalCount == null || totalCount <= 0) return;
    if (totalCount === prevCountRef.current) return;
    prevCountRef.current = totalCount;

    if (totalCount > _sessionHighScore) {
      _sessionHighScore = totalCount;
      setHighScore(totalCount);
      if (_sessionHighScore > 0) {
        setCelebrating(true);
      }
    }
  }, [totalCount]);

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), 2000);
    return () => clearTimeout(t);
  }, [celebrating]);

  return { highScore, celebrating };
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

  const aprilFools = useMemo(() => isAprilFools(), []);
  const { highScore, celebrating } = useHighScore(
    aprilFools ? totalCount : undefined,
  );

  return (
    <Text size="xs" lh="normal">
      {isLoading ? (
        <span className="effect-pulse">&middot;&middot;&middot; Results</span>
      ) : totalCount !== null && !isError ? (
        <>
          {`${totalCount?.toLocaleString()} Results`}
          {aprilFools && highScore > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                opacity: 0.75,
                transition: 'all 0.3s ease',
                ...(celebrating
                  ? {
                      opacity: 1,
                      color: '#ffd700',
                      textShadow: '0 0 6px rgba(255, 215, 0, 0.6)',
                    }
                  : {}),
              }}
              title="Session high score"
            >
              {celebrating ? '🏆 NEW HIGH SCORE: ' : '🏆 '}
              {highScore.toLocaleString()}
            </span>
          )}
        </>
      ) : (
        '0 Results'
      )}
    </Text>
  );
}
