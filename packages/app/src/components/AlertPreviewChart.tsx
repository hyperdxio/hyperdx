import React from 'react';
import {
  AlertInterval,
  SearchCondition,
  SearchConditionLanguage,
} from '@hyperdx/common-utils/dist/types';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Paper } from '@mantine/core';

import { DBTimeChart } from '@/components/DBTimeChart';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import { getTimestampValueExpression } from '@/source';
import { intervalToDateRange, intervalToGranularity } from '@/utils/alerts';

import { getAlertReferenceLines } from './Alerts';

export type AlertPreviewChartProps = {
  source: TSource;
  where?: SearchCondition | null;
  whereLanguage?: SearchConditionLanguage | null;
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
  interval,
  groupBy,
  threshold,
  thresholdType,
  select,
}: AlertPreviewChartProps) => {
  const { data: aliasMap } = useAliasMapFromChartConfig({
    select: select || '',
    where: where || '',
    connection: source.connection,
    from: source.from,
    whereLanguage: whereLanguage || undefined,
  });

  const aliasWith = Object.entries(aliasMap ?? {}).map(([key, value]) => ({
    name: key,
    sql: {
      sql: value,
      params: {},
    },
    isSubquery: false,
  }));

  return (
    <Paper w="100%" h={200}>
      <DBTimeChart
        sourceId={source.id}
        showDisplaySwitcher={false}
        referenceLines={getAlertReferenceLines({ threshold, thresholdType })}
        config={{
          where: where || '',
          whereLanguage: whereLanguage || undefined,
          dateRange: intervalToDateRange(interval),
          granularity: intervalToGranularity(interval),
          implicitColumnExpression: source.implicitColumnExpression,
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
          timestampValueExpression: getTimestampValueExpression(source),
          from: source.from,
          connection: source.connection,
        }}
      />
    </Paper>
  );
};
