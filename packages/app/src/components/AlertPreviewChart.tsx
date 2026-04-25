import React from 'react';
import {
  ALERT_COUNT_DEFAULT_SELECT,
  buildSearchChartConfig,
} from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import {
  AlertInterval,
  AlertThresholdType,
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  isLogSource,
  isTraceSource,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Paper } from '@mantine/core';

import { DBTimeChart } from '@/components/DBTimeChart';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import { intervalToDateRange, intervalToGranularity } from '@/utils/alerts';

import { getAlertReferenceLines } from './Alerts';

type AlertPreviewChartProps = {
  source: TSource;
  where?: SearchCondition | null;
  whereLanguage?: SearchConditionLanguage | null;
  filters?: Filter[] | null;
  interval: AlertInterval;
  groupBy?: string;
  thresholdType: AlertThresholdType;
  threshold: number;
  thresholdMax?: number;
  select?: string | null;
};

export const AlertPreviewChart = ({
  source,
  where,
  whereLanguage,
  filters,
  interval,
  groupBy,
  threshold,
  thresholdMax,
  thresholdType,
  select,
}: AlertPreviewChartProps) => {
  const resolvedSelect =
    (select && select.trim().length > 0
      ? select
      : isLogSource(source) || isTraceSource(source)
        ? source.defaultTableSelectExpression
        : undefined) ?? '';

  const { data: aliasMap } = useAliasMapFromChartConfig({
    select: resolvedSelect,
    where: where || '',
    connection: source.connection,
    from: source.from,
    whereLanguage: whereLanguage || undefined,
  });
  const aliasWith = aliasMapToWithClauses(aliasMap);

  // Delegate to the shared builder so this preview sees the same filters /
  // sample weights / implicit columns as the scheduled alert task and the
  // main app search page. The preview chart is rendered as a time series
  // (DBTimeChart) so it overrides displayType to Line and supplies a count()
  // default SELECT.
  //
  // Cast to ChartConfigWithDateRange because `dateRange` is always set in
  // this code path (we pass `intervalToDateRange(interval)` below). The
  // builder's return type widens `dateRange` to optional to support callers
  // that omit it, so we narrow here at the consumption point.
  const chartConfig = buildSearchChartConfig(source, {
    where,
    whereLanguage,
    filters,
    groupBy,
    displayType: DisplayType.Line,
    dateRange: intervalToDateRange(interval),
    granularity: intervalToGranularity(interval),
    defaultSelect: ALERT_COUNT_DEFAULT_SELECT,
  }) as ChartConfigWithDateRange;

  return (
    <Paper w="100%" h={200}>
      <DBTimeChart
        sourceId={source.id}
        showDisplaySwitcher={false}
        showMVOptimizationIndicator={false}
        showDateRangeIndicator={false}
        referenceLines={getAlertReferenceLines({
          threshold,
          thresholdMax,
          thresholdType,
        })}
        config={{
          ...chartConfig,
          with: aliasWith,
        }}
      />
    </Paper>
  );
};
