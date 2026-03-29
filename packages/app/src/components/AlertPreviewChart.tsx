import React from 'react';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import {
  AlertInterval,
  Filter,
  getSampleWeightExpression,
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
  thresholdType: 'above' | 'below';
  threshold: number;
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

  return (
    <Paper w="100%" h={200}>
      <DBTimeChart
        sourceId={source.id}
        showDisplaySwitcher={false}
        showMVOptimizationIndicator={false}
        showDateRangeIndicator={false}
        referenceLines={getAlertReferenceLines({ threshold, thresholdType })}
        config={{
          where: where || '',
          whereLanguage: whereLanguage || undefined,
          dateRange: intervalToDateRange(interval),
          granularity: intervalToGranularity(interval),
          filters: filters || undefined,
          implicitColumnExpression:
            isLogSource(source) || isTraceSource(source)
              ? source.implicitColumnExpression
              : undefined,
          sampleWeightExpression: getSampleWeightExpression(source),
          groupBy,
          with: aliasWith,
          select: [
            {
              aggFn: 'count' as const,
              aggCondition: '',
              aggConditionLanguage: 'sql',
              valueExpression: '',
            },
          ],
          timestampValueExpression: source.timestampValueExpression,
          from: source.from,
          connection: source.connection,
        }}
      />
    </Paper>
  );
};
