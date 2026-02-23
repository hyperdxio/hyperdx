import { memo, useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithOptTimestamp } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Flex, Text } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToPieChartConfig,
  formatResponseForPieChart,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import type { NumberFormat } from '@/types';
import { getColorProps } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import { SQLPreview } from './ChartSQLPreview';

const PieChartTooltip = memo(
  ({
    active,
    payload,
    numberFormat,
  }: {
    active?: boolean;
    payload?: { name: string; value: number; payload: { color: string } }[];
    numberFormat?: NumberFormat;
  }) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    return (
      <ChartTooltipContainer>
        <ChartTooltipItem
          color={entry.payload.color}
          name={entry.name}
          value={entry.value}
          numberFormat={numberFormat}
          indicator="none"
        />
      </ChartTooltipContainer>
    );
  },
);

export const DBPieChart = ({
  config,
  title,
  enabled = true,
  queryKeyPrefix,
  showMVOptimizationIndicator = true,
  toolbarPrefix,
  toolbarSuffix,
}: {
  config: ChartConfigWithOptTimestamp;
  title?: React.ReactNode;
  enabled?: boolean;
  queryKeyPrefix?: string;
  showMVOptimizationIndicator?: boolean;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
}) => {
  const { data: source } = useSource({ id: config.source });

  const queriedConfig = useMemo(() => {
    return convertToPieChartConfig(config);
  }, [config]);

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

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-table-chart-mv-indicator"
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

  const pieChartData = useMemo(() => {
    if (!data) return [];
    return formatResponseForPieChart(data, getColorProps);
  }, [data]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <div className="h-100 w-100 align-items-center justify-content-center text-muted overflow-scroll">
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
        <Flex
          data-testid="pie-chart-container"
          align="center"
          justify="center"
          h="100%"
          style={{ flexGrow: 1 }}
        >
          <ResponsiveContainer
            height="100%"
            width="100%"
            className={isLoading ? 'effect-pulse' : ''}
          >
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={pieChartData}
                dataKey="value"
                fill="#8884d8"
                nameKey="label"
                legendType="none"
              >
                {pieChartData.map(entry => (
                  <Cell key={entry.label} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                content={<PieChartTooltip numberFormat={config.numberFormat} />}
              />
            </PieChart>
          </ResponsiveContainer>
        </Flex>
      )}
    </ChartContainer>
  );
};
