import { useMemo } from 'react';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import { ChartConfigWithOptTimestamp } from '@hyperdx/common-utils/dist/types';

import {
  buildMVDateRangeIndicator,
  convertToCategoricalChartConfig,
  formatResponseForCategoricalChart,
} from '@/ChartUtils';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSingleSeriesNumberFormat, useSource } from '@/source';
import { getColorProps } from '@/utils';

import { ChartErrorStateVariant } from './ChartErrorState';

/** Props shared by every categorical (pie/bar) chart */
export interface CategoricalChartProps {
  config: ChartConfigWithOptTimestamp;
  title?: React.ReactNode;
  enabled?: boolean;
  queryKeyPrefix?: string;
  showMVOptimizationIndicator?: boolean;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  errorVariant?: ChartErrorStateVariant;
}

/**
 * Runs the categorical chart query and derives everything both pie and bar
 * charts need.
 */
export function useCategoricalChart({
  config,
  enabled = true,
  queryKeyPrefix,
  showMVOptimizationIndicator = true,
  toolbarPrefix,
  toolbarSuffix,
}: CategoricalChartProps) {
  const { data: source } = useSource({ id: config.source });

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

  const toolbarItems = useMemo(() => {
    const allToolbarItems: React.ReactNode[] = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator && builderQueriedConfig) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-categorical-chart-mv-indicator"
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

  const [chartData, responseFormatError] = useMemo<
    [ReturnType<typeof formatResponseForCategoricalChart>, Error | null]
  >(() => {
    if (!data) return [[], null];
    try {
      return [formatResponseForCategoricalChart(data, getColorProps), null];
    } catch (error) {
      return [[], error instanceof Error ? error : new Error(String(error))];
    }
  }, [data]);

  return {
    resolvedNumberFormat,
    toolbarItems,
    data,
    isLoading,
    isError,
    error,
    chartData,
    responseFormatError,
  };
}
