import { useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Group, Text, UnstyledButton } from '@mantine/core';
import { keepPreviousData } from '@tanstack/react-query';

import api from '@/api';
import { convertToTimeChartConfig } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import {
  getChartColorError,
  getChartColorInfo,
  getChartColorWarning,
  getLogLevelClass,
} from '@/utils';

type SeverityCount = {
  label: string;
  class: 'error' | 'warn' | 'info';
  color: string;
  count: number;
  rawValues: string[];
};

function inferCountColumn(meta: ResponseJSON['meta'] | undefined): string {
  if (!meta) return 'count()';
  if (meta.find(col => col.name === 'count()')) {
    return 'count()';
  }
  return (
    filterColumnMetaByType(meta, [JSDataType.Number])?.[0]?.name ?? 'count()'
  );
}

function inferGroupColumn(
  meta: ResponseJSON['meta'] | undefined,
): string | undefined {
  if (!meta) return undefined;
  return filterColumnMetaByType(meta, [JSDataType.String])?.[0]?.name;
}

export function useSearchSeverityCounts(
  config: BuilderChartConfigWithDateRange | undefined,
  queryKeyPrefix: string,
  { enableParallelQueries }: { enableParallelQueries?: boolean } = {},
) {
  const { data: me, isLoading: isLoadingMe } = api.useMe();

  const queriedConfig = useMemo(
    () => (config ? convertToTimeChartConfig(config) : undefined),
    [config],
  );

  const { data, isLoading } = useQueriedChartConfig(queriedConfig!, {
    queryKey: [
      queryKeyPrefix,
      queriedConfig,
      'chunked',
      {
        disableQueryChunking: false,
        enableParallelQueries,
        parallelizeWhenPossible: me?.team?.parallelizeWhenPossible,
      },
    ],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    enableQueryChunking: true,
    enabled: !isLoadingMe && queriedConfig != null,
  });

  const severityCounts = useMemo<SeverityCount[]>(() => {
    if (!data?.data || !data.meta) return [];

    const countColumn = inferCountColumn(data.meta);
    const groupColumn = inferGroupColumn(data.meta);

    if (!groupColumn) return [];

    const classTotals: Record<
      string,
      { count: number; rawValues: Set<string> }
    > = {
      error: { count: 0, rawValues: new Set() },
      warn: { count: 0, rawValues: new Set() },
      info: { count: 0, rawValues: new Set() },
    };

    for (const row of data.data) {
      const severity = String(row[groupColumn] ?? '');
      const count = Number(row[countColumn] ?? 0);
      const cls = getLogLevelClass(severity) ?? 'info';

      classTotals[cls].count += count;
      classTotals[cls].rawValues.add(severity);
    }

    const result: SeverityCount[] = [];
    if (classTotals.info.count > 0) {
      result.push({
        label: 'Info',
        class: 'info',
        color: getChartColorInfo(),
        count: classTotals.info.count,
        rawValues: [...classTotals.info.rawValues],
      });
    }
    if (classTotals.warn.count > 0) {
      result.push({
        label: 'Warn',
        class: 'warn',
        color: getChartColorWarning(),
        count: classTotals.warn.count,
        rawValues: [...classTotals.warn.rawValues],
      });
    }
    if (classTotals.error.count > 0) {
      result.push({
        label: 'Error',
        class: 'error',
        color: getChartColorError(),
        count: classTotals.error.count,
        rawValues: [...classTotals.error.rawValues],
      });
    }

    return result;
  }, [data]);

  return { severityCounts, isLoading };
}

export default function SearchHistogramLegend({
  config,
  queryKeyPrefix,
  groupByColumn,
  enableParallelQueries,
  onSeverityClick,
}: {
  config: BuilderChartConfigWithDateRange | undefined;
  queryKeyPrefix: string;
  groupByColumn: string | undefined;
  enableParallelQueries?: boolean;
  onSeverityClick?: (rawValues: string[]) => void;
}) {
  const { severityCounts, isLoading } = useSearchSeverityCounts(
    config,
    queryKeyPrefix,
    { enableParallelQueries },
  );

  if (isLoading || severityCounts.length === 0 || !groupByColumn) {
    return null;
  }

  return (
    <Group gap="sm" px="sm" pb={4}>
      {severityCounts.map(item => (
        <UnstyledButton
          key={item.class}
          onClick={() => onSeverityClick?.(item.rawValues)}
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
