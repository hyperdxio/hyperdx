import { useMemo } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Flex, Text } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToNumberChartConfig,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { formatNumber } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import { SQLPreview } from './ChartSQLPreview';

export default function DBNumberChart({
  config,
  enabled = true,
  queryKeyPrefix,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
}: {
  config: ChartConfigWithDateRange;
  queryKeyPrefix?: string;
  enabled?: boolean;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
}) {
  const queriedConfig = useMemo(
    () => convertToNumberChartConfig(config),
    [config],
  );

  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(queriedConfig);

  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  const number = formatNumber(
    (Object.values(data?.data?.[0] ?? {})?.[0] ?? Number.NaN) as number,
    config.numberFormat,
  );

  const { data: source } = useSource({ id: config.source });

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-number-chart-mv-indicator"
          config={queriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const dateRangeIndicator = buildMVDateRangeIndicator({
      mvOptimizationData,
      originalDateRange: queriedConfig.dateRange,
    });

    if (dateRangeIndicator) {
      allToolbarItems.push(dateRangeIndicator);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    toolbarPrefix,
    toolbarSuffix,
    source,
    showMVOptimizationIndicator,
    mvOptimizationData,
    queriedConfig,
  ]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError ? (
        <div className="h-100 w-100 align-items-center justify-content-center text-muted">
          <Text ta="center" size="sm" mt="sm">
            Error loading chart, please check your query or try again later.
          </Text>
          <Box mt="sm">
            <Text my="sm" size="sm" ta="center">
              Error Message:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </Code>
            {error instanceof ClickHouseQueryError && (
              <>
                <Text my="sm" size="sm" ta="center">
                  Sent Query:
                </Text>
                <SQLPreview data={error?.query} />
              </>
            )}
          </Box>
        </div>
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Flex align="center" justify="center" h="100%" style={{ flexGrow: 1 }}>
          <Text size="4rem">{number ?? 'N/A'}</Text>
        </Flex>
      )}
    </ChartContainer>
  );
}
