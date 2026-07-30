import { useMemo } from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Group, Text, UnstyledButton } from '@mantine/core';

import {
  inferCountColumn,
  inferGroupColumn,
  type SearchHistogramQueryOptions,
  useSearchHistogramQuery,
} from '@/hooks/useSearchHistogramQuery';
import {
  getChartColorError,
  getChartColorInfo,
  getChartColorWarning,
  getLogLevelClass,
} from '@/utils';

type LogLevelClass = 'info' | 'warn' | 'error';

type SeverityCount = {
  label: string;
  class: LogLevelClass;
  color: string;
  count: number;
  /**
   * Every raw column value that rolled up into this class (e.g. "ERR" and
   * "fatal" both land under Error), so clicking the item can filter on all of
   * them rather than just the one we happened to label it with.
   */
  rawValues: string[];
};

// Rendered bottom-to-top to match the histogram's stacking order.
const CLASS_DISPLAY_ORDER: { class: LogLevelClass; label: string }[] = [
  { class: 'info', label: 'Info' },
  { class: 'warn', label: 'Warn' },
  { class: 'error', label: 'Error' },
];

const CLASS_COLORS: Record<LogLevelClass, () => string> = {
  info: getChartColorInfo,
  warn: getChartColorWarning,
  error: getChartColorError,
};

export function useSearchSeverityCounts(
  config: BuilderChartConfigWithDateRange,
  queryKeyPrefix: string,
  options: SearchHistogramQueryOptions = {},
) {
  // Shares the histogram's React Query cache entry, so this adds no extra
  // query — we just re-aggregate the same rows over the whole date range.
  const { data, isLoading } = useSearchHistogramQuery(
    config,
    queryKeyPrefix,
    options,
  );

  const severityCounts = useMemo<SeverityCount[]>(() => {
    if (!data?.data || !data.meta) return [];

    const countColumn = inferCountColumn(data.meta);
    const groupColumn = inferGroupColumn(data.meta);
    if (!groupColumn) return [];

    const totals = new Map<
      LogLevelClass,
      { count: number; rawValues: Set<string> }
    >();

    for (const row of data.data) {
      const rawValue = String(row[groupColumn] ?? '');
      const count = Number(row[countColumn] ?? 0);
      if (!Number.isFinite(count)) continue;

      // Unrecognized severities are colored as info in the chart, so they must
      // be counted as info here or the legend totals won't sum to the result count.
      const logLevelClass = getLogLevelClass(rawValue) ?? 'info';

      const total = totals.get(logLevelClass) ?? {
        count: 0,
        rawValues: new Set<string>(),
      };
      total.count += count;
      total.rawValues.add(rawValue);
      totals.set(logLevelClass, total);
    }

    return CLASS_DISPLAY_ORDER.flatMap(({ class: logLevelClass, label }) => {
      const total = totals.get(logLevelClass);
      if (total == null || total.count === 0) return [];
      return [
        {
          label,
          class: logLevelClass,
          color: CLASS_COLORS[logLevelClass](),
          count: total.count,
          rawValues: [...total.rawValues],
        },
      ];
    });
  }, [data]);

  return { severityCounts, isLoading };
}

export default function SearchHistogramLegend({
  config,
  queryKeyPrefix,
  disableQueryChunking,
  enableParallelQueries,
  onSeverityClick,
}: {
  config: BuilderChartConfigWithDateRange;
  queryKeyPrefix: string;
  disableQueryChunking?: boolean;
  enableParallelQueries?: boolean;
  /** Called with every raw column value belonging to the clicked severity class. */
  onSeverityClick?: (rawValues: string[]) => void;
}) {
  const { severityCounts } = useSearchSeverityCounts(config, queryKeyPrefix, {
    disableQueryChunking,
    enableParallelQueries,
  });

  if (severityCounts.length === 0) {
    return null;
  }

  return (
    <Group gap="sm" px="sm" pb={4} data-testid="search-histogram-legend">
      {severityCounts.map(item => (
        <UnstyledButton
          key={item.class}
          onClick={() => onSeverityClick?.(item.rawValues)}
          aria-label={`Filter by ${item.label}`}
        >
          <Group gap={4} align="center">
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: item.color,
                flexShrink: 0,
              }}
            />
            <Text size="xs" c="dimmed">
              {item.label}
            </Text>
            <Text size="xs" fw={500}>
              {item.count.toLocaleString()}
            </Text>
          </Group>
        </UnstyledButton>
      ))}
    </Group>
  );
}
