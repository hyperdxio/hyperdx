import { useMemo } from 'react';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { RawLogTable } from '@/components/DBRowTable';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';
import { useGroupedPatterns } from '@/hooks/usePatterns';

const emptyMap = new Map();
export default function PatternTable({
  config,
  totalCountConfig,
  totalCountQueryKeyPrefix,
  bodyValueExpression,
}: {
  config: ChartConfigWithDateRange;
  totalCountConfig: ChartConfigWithDateRange;
  bodyValueExpression: string;
  totalCountQueryKeyPrefix: string;
}) {
  const SAMPLES = 10_000;

  const {
    totalCount,
    isLoading: isTotalCountLoading,
    isError: isTotalCountError,
  } = useSearchTotalCount(totalCountConfig, totalCountQueryKeyPrefix);

  const { data: groupedResults, isLoading: isGroupedPatternsLoading } =
    useGroupedPatterns({
      config,
      samples: SAMPLES,
      bodyValueExpression,
      totalCount,
    });

  const isLoading = isTotalCountLoading || isGroupedPatternsLoading;

  const sortedGroupedResults = useMemo(() => {
    return Object.values(groupedResults).sort((a, b) => b.count - a.count);
  }, [groupedResults]);

  // TODO: Add side panel support for example logs
  return (
    <RawLogTable
      isLive={false}
      wrapLines={true}
      isLoading={isLoading}
      rows={sortedGroupedResults ?? []}
      displayedColumns={['__hdx_pattern_trend', 'countStr', 'pattern']}
      onRowExpandClick={() => {}}
      hasNextPage={false}
      fetchNextPage={() => {}}
      highlightedLineId={''}
      columnTypeMap={emptyMap}
      generateRowId={row => row.__hdx_patternId}
      columnNameMap={{
        __hdx_pattern_trend: 'Trend',
        countStr: 'Count',
        pattern: 'Pattern',
      }}
    />
  );
}
