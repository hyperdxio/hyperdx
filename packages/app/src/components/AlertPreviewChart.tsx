import React, { useMemo } from 'react';
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
  const aliasWith = useMemo(() => aliasMapToWithClauses(aliasMap), [aliasMap]);

  // Delegate to the shared builder so this preview sees the same filters,
  // sample weights, and implicit columns as the scheduled alert task and
  // the app search page. Overrides `displayType` to Line and supplies a
  // count() default SELECT because the preview always renders the alert's
  // count-over-time threshold view, regardless of the saved search's
  // display columns.
  //
  // The `select` prop is intentionally NOT forwarded to the builder — it's
  // only used above (for `useAliasMapFromChartConfig`) so alias-WITH
  // clauses match the saved search's display select.
  //
  // Cast to ChartConfigWithDateRange because the builder widens `dateRange`
  // to optional, but it's always set here via `intervalToDateRange`.
  const config = useMemo<ChartConfigWithDateRange>(() => {
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
    return { ...chartConfig, with: aliasWith };
  }, [source, where, whereLanguage, filters, groupBy, interval, aliasWith]);

  const referenceLines = useMemo(
    () =>
      getAlertReferenceLines({
        threshold,
        thresholdMax,
        thresholdType,
      }),
    [threshold, thresholdMax, thresholdType],
  );

  return (
    <Paper w="100%" h={200}>
      <DBTimeChart
        sourceId={source.id}
        showDisplaySwitcher={false}
        showMVOptimizationIndicator={false}
        showDateRangeIndicator={false}
        referenceLines={referenceLines}
        config={config}
      />
    </Paper>
  );
};
