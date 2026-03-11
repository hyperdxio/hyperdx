import { useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  isBuilderChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
  RawSqlConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { Flex, Text } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToNumberChartConfig,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { formatNumber } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

export default function DBNumberChart({
  config,
  enabled = true,
  queryKeyPrefix,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  errorVariant,
}: {
  config: BuilderChartConfigWithDateRange | RawSqlConfigWithDateRange;
  queryKeyPrefix?: string;
  enabled?: boolean;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
  errorVariant?: ChartErrorStateVariant;
}) {
  const queriedConfig = useMemo(
    () =>
      isBuilderChartConfig(config)
        ? convertToNumberChartConfig(config)
        : config,
    [config],
  );

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

  // The value is the first numeric value in the first row of the result
  const valueColumn = data?.meta
    ? filterColumnMetaByType(data?.meta, [JSDataType.Number])?.[0]
    : undefined;
  const resultError =
    data && !valueColumn && isRawSqlChartConfig(queriedConfig)
      ? new Error(
          `No numeric columns found in result column metadata. Make sure a numeric column exists in the result set.\n\nResult Metadata: ${JSON.stringify(data.meta)}`,
        )
      : error;

  const value = valueColumn
    ? data?.data?.[0]?.[valueColumn.name]
    : (Object.values(data?.data?.[0] ?? {})?.[0] ?? Number.NaN);
  const formattedValue = formatNumber(value as number, config.numberFormat);

  const { data: source } = useSource({
    id: isBuilderChartConfig(config) ? config.source : undefined,
  });

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator && builderQueriedConfig) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-number-chart-mv-indicator"
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

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : resultError ? (
        <ChartErrorState error={resultError} variant={errorVariant} />
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Flex align="center" justify="center" h="100%" style={{ flexGrow: 1 }}>
          <Text size="4rem">{formattedValue ?? 'N/A'}</Text>
        </Flex>
      )}
    </ChartContainer>
  );
}
