import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import { ChartConfigWithOptTimestamp } from '@hyperdx/common-utils/dist/types';
import { Flex } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToCategoricalChartConfig,
  formatResponseForCategoricalChart,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSingleSeriesNumberFormat, useSource } from '@/source';
import type { NumberFormat } from '@/types';
import { formatNumber, getColorProps } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

const MAX_BAR_LABEL_LENGTH = 14;
const BAR_LABEL_AXIS_HEIGHT = 80; // increased height to accommodate rotated + truncated labels

const truncateBarLabel = (value: string) =>
  value.length > MAX_BAR_LABEL_LENGTH
    ? `${value.slice(0, MAX_BAR_LABEL_LENGTH - 1)}…`
    : value;

const BarChartTooltip = memo(
  ({
    active,
    payload,
    numberFormat,
  }: {
    active?: boolean;
    payload?: {
      value: number;
      payload: { label: string; color: string };
    }[];
    numberFormat?: NumberFormat;
  }) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    return (
      <ChartTooltipContainer>
        <ChartTooltipItem
          color={entry.payload.color}
          name={entry.payload.label}
          value={entry.value}
          numberFormat={numberFormat}
          indicator="none"
        />
      </ChartTooltipContainer>
    );
  },
);

export const DBBarChart = ({
  config,
  title,
  enabled = true,
  queryKeyPrefix,
  showMVOptimizationIndicator = true,
  toolbarPrefix,
  toolbarSuffix,
  errorVariant,
}: {
  config: ChartConfigWithOptTimestamp;
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

  const queriedConfig = useMemo(() => {
    return isBuilderChartConfig(config)
      ? convertToCategoricalChartConfig(config)
      : config;
  }, [config]);

  const resolvedNumberFormat = useSingleSeriesNumberFormat(queriedConfig);

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
          key="db-bar-chart-mv-indicator"
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

  const [barChartData, responseFormatError] = useMemo(() => {
    if (!data) return [[], null];
    try {
      return [formatResponseForCategoricalChart(data, getColorProps), null];
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
          data-testid="bar-chart-container"
          align="center"
          justify="center"
          h="100%"
          style={{ flexGrow: 1, overflow: 'hidden' }}
        >
          <ResponsiveContainer
            height="100%"
            width="100%"
            className={isLoading ? 'effect-pulse' : ''}
          >
            <BarChart data={barChartData}>
              <XAxis
                dataKey="label"
                interval={0}
                angle={-45}
                textAnchor="end"
                height={BAR_LABEL_AXIS_HEIGHT}
                tickFormatter={truncateBarLabel}
                tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
              />
              <YAxis
                width={40}
                minTickGap={25}
                tickFormatter={(value: number) =>
                  resolvedNumberFormat
                    ? formatNumber(value, resolvedNumberFormat)
                    : new Intl.NumberFormat('en-US', {
                        notation: 'compact',
                        compactDisplay: 'short',
                      }).format(value)
                }
                tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
              />
              <Bar dataKey="value">
                {barChartData.map(entry => (
                  <Cell key={entry.label} fill={entry.color} stroke="none" />
                ))}
              </Bar>
              <Tooltip
                content={
                  <BarChartTooltip numberFormat={resolvedNumberFormat} />
                }
                cursor={{ fill: 'transparent' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </Flex>
      )}
    </ChartContainer>
  );
};
