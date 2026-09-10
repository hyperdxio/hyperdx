import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';

import { QueryProgressIndicator } from '@/components/QueryProgressIndicator';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';

/**
 * Live progress for the search page's histogram query, shown beside "Scanned
 * Rows" and "Elapsed Time" while the chart is still loading.
 *
 * Reads the same query as the histogram chart and the results counter — the
 * three share a query key, so react-query serves all of them from one
 * ClickHouse request and this adds none of its own.
 */
export function HistogramQueryProgress({
  config,
  queryKeyPrefix,
  enableParallelQueries,
}: {
  config: BuilderChartConfigWithDateRange;
  queryKeyPrefix: string;
  enableParallelQueries?: boolean;
}) {
  const { progress } = useSearchTotalCount(config, queryKeyPrefix, {
    enableParallelQueries,
    reportProgress: true,
  });

  if (progress == null) {
    return null;
  }

  return (
    <>
      <Text size="xs" c="dimmed">
        |
      </Text>
      <QueryProgressIndicator progress={progress} variant="inline" />
    </>
  );
}
