import { useMemo } from 'react';
import { hasNonEmptyOrderBy } from '@hyperdx/common-utils/dist/core/utils';
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
  /**
   * Caps the number of rows the underlying query returns (see
   * useQueriedChartConfig). Used by dashboard tiles to guard against runaway
   * high-cardinality queries. When set and the cap is exceeded, an overflow
   * banner is rendered below the chart header.
   */
  maxResultRows?: number;
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
  maxResultRows,
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

  const { data, isLoading, isError, error, isPlaceholderData } =
    useQueriedChartConfig(queriedConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
      maxResultRows,
    });

  // Whether the query exceeded the row cap. Gated on completion (no mid-stream
  // flap) AND freshness (!isPlaceholderData) so a stale "Result truncated"
  // banner from a prior query doesn't linger while a narrowed query is in
  // flight. See the matching gate in DBTimeChart.
  const didOverflow =
    !isPlaceholderData && data?.isComplete
      ? (data?.didOverflow ?? false)
      : false;

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
      const hasOrderBy =
        isBuilderChartConfig(queriedConfig) &&
        hasNonEmptyOrderBy(queriedConfig.orderBy);

      return [
        formatResponseForCategoricalChart(data, getColorProps, !hasOrderBy),
        null,
      ];
    } catch (error) {
      return [[], error instanceof Error ? error : new Error(String(error))];
    }
  }, [data, queriedConfig]);

  return {
    resolvedNumberFormat,
    toolbarItems,
    data,
    isLoading,
    isError,
    error,
    chartData,
    responseFormatError,
    didOverflow,
    maxResultRows,
    // Row count and category (series) count of the (capped) result, surfaced so
    // the overflow banner can report concrete sizes. For a categorical chart the
    // number of slices/bars is the series count.
    rows: data?.rows,
    series: chartData.length,
  };
}
