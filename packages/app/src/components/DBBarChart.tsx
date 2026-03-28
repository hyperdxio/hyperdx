import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithOptTimestamp,
  RawSqlConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { Flex } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToBarChartConfig,
  formatResponseForPieChart,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import type { NumberFormat } from '@/types';
import { formatNumber, getColorProps, truncateMiddle } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

const BarChartTooltip = memo(
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
          indicator="square"
        />
      </ChartTooltipContainer>
    );
  },
);

const BarXAxisTick = ({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
}) => {
  const label = payload?.value ?? '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="end"
        fill="#888"
        fontSize={11}
        transform="rotate(-35)"
      >
        {truncateMiddle(label, 20)}
      </text>
    </g>
  );
};

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

  const queriedConfig = useMemo(() => {
    return isBuilderChartConfig(config)
      ? convertToBarChartConfig(config)
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
      return [formatResponseForPieChart(data, getColorProps), null];
    } catch (err) {
      return [[], err instanceof Error ? err : new Error(String(err))];
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
          style={{ flexGrow: 1 }}
        >
          <ResponsiveContainer
            height="100%"
            width="100%"
            className={isLoading ? 'effect-pulse' : ''}
          >
            <BarChart
              data={barChartData}
              margin={{ top: 8, right: 16, left: 8, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
              <XAxis
                dataKey="label"
                tick={<BarXAxisTick />}
                interval={0}
              />
              <YAxis
                tickFormatter={v =>
                  config.numberFormat
                    ? formatNumber(v, config.numberFormat)
                    : String(v)
                }
                tick={{ fontSize: 11, fill: '#888' }}
                width={60}
              />
              <Tooltip
                content={
                  <BarChartTooltip numberFormat={config.numberFormat} />
                }
              />
              <Bar dataKey="value" name="value" radius={[2, 2, 0, 0]}>
                {barChartData.map(entry => (
                  <Cell key={entry.label} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Flex>
      )}
    </ChartContainer>
  );
};
