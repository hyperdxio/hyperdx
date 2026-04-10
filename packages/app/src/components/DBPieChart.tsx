import { memo, useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithOptTimestamp,
  RawSqlConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { Flex } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToPieChartConfig,
  formatResponseForPieChart,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useResolvedNumberFormat, useSource } from '@/source';
import type { NumberFormat } from '@/types';
import { getColorProps } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

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
  errorVariant,
}: {
  config: BuilderChartConfigWithOptTimestamp | RawSqlConfigWithDateRange;
  title?: React.ReactNode;
  enabled?: boolean;
  queryKeyPrefix?: string;
  showMVOptimizationIndicator?: boolean;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  errorVariant?: ChartErrorStateVariant;
}) => {
  const { data: source } = useSource({
    id: config.source,
  });

  const resolvedNumberFormat = useResolvedNumberFormat(config);

  const queriedConfig = useMemo(() => {
    return isBuilderChartConfig(config)
      ? convertToPieChartConfig(config)
      : config;
  }, [config]);

  const builderQueriedConfig = isBuilderChartConfig(queriedConfig)
    ? queriedConfig
    : undefined;
  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(builderQueriedConfig);

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

    if (source && showMVOptimizationIndicator && builderQueriedConfig) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-table-chart-mv-indicator"
          config={builderQueriedConfig}
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
    builderQueriedConfig,
  ]);

  const [pieChartData, responseFormatError] = useMemo(() => {
    if (!data) return [[], null];
    try {
      return [formatResponseForPieChart(data, getColorProps), null];
    } catch (error) {
      return [[], error instanceof Error ? error : new Error(String(error))];
    }
  }, [data]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : responseFormatError ? (
        <ChartErrorState error={responseFormatError} variant={errorVariant} />
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
                content={
                  <PieChartTooltip numberFormat={resolvedNumberFormat} />
                }
              />
            </PieChart>
          </ResponsiveContainer>
        </Flex>
      )}
    </ChartContainer>
  );
};
