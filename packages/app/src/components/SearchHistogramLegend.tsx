import { useMemo } from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Group, Popover, Text, UnstyledButton } from '@mantine/core';

import { formatResponseForSeriesTotals } from '@/ChartUtils';
import {
  decodeSeriesGroupFilters,
  type SeriesGroupFilter,
} from '@/components/DBTimeChart';
import {
  type SearchHistogramQueryOptions,
  useSearchHistogramQuery,
} from '@/hooks/useSearchHistogramQuery';
import { useSource } from '@/source';
import { getLogLevelClass } from '@/utils';

/**
 * Inline items before overflowing into a "+N more" popover. The search legend
 * spans the full width under the histogram, so it fits more than the chart
 * tile's own legend (which is boxed into a dashboard tile), but it still has to
 * stay one row so it doesn't push the results table down.
 */
const MAX_INLINE_ITEMS = 6;

const LOG_LEVEL_RANK: Record<string, number> = { error: 3, warn: 2, info: 1 };

export type SeriesTotalItem = {
  dataKey: string;
  label: string;
  color: string;
  total: number;
  /** Column/value pairs to filter on when this item is clicked. */
  groupFilters: SeriesGroupFilter[];
};

/**
 * How severe a series looks, based on its group values rather than on which
 * column was grouped — the histogram groups by whatever the source designates,
 * and the values may or may not be log levels.
 */
function getSeverityRank(groupFilters: SeriesGroupFilter[]): number {
  let rank = 0;
  for (const { value } of groupFilters) {
    const logLevelClass = getLogLevelClass(value);
    if (logLevelClass != null) {
      rank = Math.max(rank, LOG_LEVEL_RANK[logLevelClass] ?? 0);
    }
  }
  return rank;
}

export function useSearchSeriesTotals(
  config: BuilderChartConfigWithDateRange,
  queryKeyPrefix: string,
  {
    sourceId,
    ...queryOptions
  }: SearchHistogramQueryOptions & { sourceId?: string } = {},
) {
  // Resolves from the histogram's React Query cache entry, so the legend adds
  // no query of its own.
  const { data, isLoading } = useSearchHistogramQuery(
    config,
    queryKeyPrefix,
    queryOptions,
  );

  // The same source the chart resolves, so severity/status groupings get the
  // same semantic colors the bars are drawn with.
  const { data: source } = useSource({ id: sourceId || config.source });

  const items = useMemo<SeriesTotalItem[]>(() => {
    if (data?.meta == null || data.data == null) return [];

    let seriesTotals;
    let groupColumns: string[];
    let isSingleValueColumn: boolean;
    try {
      ({ seriesTotals, groupColumns, isSingleValueColumn } =
        formatResponseForSeriesTotals({ response: data, source }));
    } catch (e) {
      // Mirror the chart's handling of an unusable response shape: degrade to
      // no legend rather than taking the search page down.
      console.error(e);
      return [];
    }

    // Without a group-by there is a single series whose total is already shown
    // as the result count above the histogram, so a legend would just repeat it.
    if (groupColumns.length === 0) return [];

    return seriesTotals
      .map(series => ({
        dataKey: series.dataKey,
        label: series.displayName,
        color: series.color,
        total: series.total,
        groupFilters: decodeSeriesGroupFilters({
          seriesKey: series.dataKey,
          groupColumns,
          isSingleValueColumn,
        }),
      }))
      .filter(item => item.total > 0 && item.groupFilters.length > 0)
      .sort(
        (a, b) =>
          // Most important first. Severity-looking series lead with the most
          // severe (matching how the chart's own legend lists the top of the
          // stack first); anything else falls back to the biggest contributor,
          // which also makes the "+N more" cutoff meaningful.
          getSeverityRank(b.groupFilters) - getSeverityRank(a.groupFilters) ||
          b.total - a.total ||
          a.label.localeCompare(b.label),
      );
  }, [data, source]);

  return { items, isLoading };
}

function LegendItem({
  item,
  onFocusSeries,
}: {
  item: SeriesTotalItem;
  onFocusSeries?: (filters: SeriesGroupFilter[]) => void;
}) {
  return (
    <UnstyledButton
      onClick={() => onFocusSeries?.(item.groupFilters)}
      aria-label={`Filter by ${item.label}`}
      title={`${item.label}: ${item.total.toLocaleString()}`}
    >
      <Group gap={4} align="center" wrap="nowrap">
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            backgroundColor: item.color,
            flexShrink: 0,
          }}
        />
        <Text size="xs" c="dimmed" maw={180} truncate="end">
          {item.label}
        </Text>
        <Text size="xs" fw={500}>
          {item.total.toLocaleString()}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

/**
 * Totals per histogram series across the whole selected time range, so a
 * breakdown (e.g. "how many errors in the last 45 minutes") reads as one number
 * instead of bars to sum by eye. Clicking an item narrows the search to it.
 *
 * Driven entirely by the groups the query returned: severity-like values are
 * colored semantically and ordered most-severe-first, while any other grouping
 * gets the chart's palette colors and is ordered by total.
 */
export default function SearchHistogramLegend({
  config,
  queryKeyPrefix,
  sourceId,
  disableQueryChunking,
  enableParallelQueries,
  onFocusSeries,
}: {
  config: BuilderChartConfigWithDateRange;
  queryKeyPrefix: string;
  sourceId?: string;
  disableQueryChunking?: boolean;
  enableParallelQueries?: boolean;
  onFocusSeries?: (filters: SeriesGroupFilter[]) => void;
}) {
  const { items } = useSearchSeriesTotals(config, queryKeyPrefix, {
    sourceId,
    disableQueryChunking,
    enableParallelQueries,
  });

  if (items.length === 0) {
    return null;
  }

  const inlineItems = items.slice(0, MAX_INLINE_ITEMS);
  const overflowItems = items.slice(MAX_INLINE_ITEMS);

  return (
    <Group
      gap="sm"
      px="sm"
      pb={4}
      wrap="nowrap"
      data-testid="search-histogram-legend"
    >
      {inlineItems.map(item => (
        <LegendItem
          key={item.dataKey}
          item={item}
          onFocusSeries={onFocusSeries}
        />
      ))}
      {overflowItems.length > 0 && (
        <Popover withinPortal withArrow closeOnEscape closeOnClickOutside>
          <Popover.Target>
            <UnstyledButton aria-label="Show remaining series">
              <Text size="xs" c="dimmed">
                +{overflowItems.length} more
              </Text>
            </UnstyledButton>
          </Popover.Target>
          <Popover.Dropdown p="xs">
            <Group gap={6} maw={320} style={{ flexDirection: 'column' }}>
              {overflowItems.map(item => (
                <LegendItem
                  key={item.dataKey}
                  item={item}
                  onFocusSeries={onFocusSeries}
                />
              ))}
            </Group>
          </Popover.Dropdown>
        </Popover>
      )}
    </Group>
  );
}
