import { useMemo, useState } from 'react';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { RawLogTable } from '@/components/DBRowTable';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';
import { Pattern, useGroupedPatterns } from '@/hooks/usePatterns';

import PatternSidePanel from './PatternSidePanel';

const emptyMap = new Map();

export default function PatternTable({
  config,
  totalCountConfig,
  totalCountQueryKeyPrefix,
  bodyValueExpression,
  source,
}: {
  config: ChartConfigWithDateRange;
  totalCountConfig: ChartConfigWithDateRange;
  bodyValueExpression: string;
  totalCountQueryKeyPrefix: string;
  source?: TSource;
}) {
  const SAMPLES = 10_000;

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

  const {
    totalCount,
    isLoading: isTotalCountLoading,
    isTotalCountComplete,
  } = useSearchTotalCount(totalCountConfig, totalCountQueryKeyPrefix);

  const {
    data: groupedResults,
    isLoading: isGroupedPatternsLoading,
    patternQueryConfig,
  } = useGroupedPatterns({
    config,
    samples: SAMPLES,
    bodyValueExpression,
    severityTextExpression: source?.severityTextExpression ?? '',
    statusCodeExpression: source?.statusCodeExpression ?? '',
    totalCount,
  });

  const isLoading =
    isTotalCountLoading || !isTotalCountComplete || isGroupedPatternsLoading;

  const sortedGroupedResults = useMemo(() => {
    return Object.values(groupedResults).sort(
      (a, b) => b.count - a.count,
    ) as Pattern[];
  }, [groupedResults]);

  return (
    <>
      <RawLogTable
        isLive={false}
        wrapLines={true}
        isLoading={isLoading}
        rows={sortedGroupedResults ?? []}
        displayedColumns={[
          '__hdx_pattern_trend',
          'countStr',
          'severityText',
          'pattern',
        ]}
        onRowDetailsClick={row => setSelectedPattern(row as Pattern)}
        hasNextPage={false}
        fetchNextPage={() => {}}
        highlightedLineId={''}
        columnTypeMap={emptyMap}
        generateRowId={row => ({ where: row.id, aliasWith: [] })}
        columnNameMap={{
          __hdx_pattern_trend: 'Trend',
          countStr: 'Count',
          pattern: 'Pattern',
          severityText: 'Level',
        }}
        config={patternQueryConfig}
        showExpandButton={false}
      />
      {selectedPattern && source && (
        <PatternSidePanel
          isOpen
          source={source}
          pattern={selectedPattern}
          bodyValueExpression={bodyValueExpression}
          onClose={() => setSelectedPattern(null)}
        />
      )}
    </>
  );
}
