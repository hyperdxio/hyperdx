import React from 'react';
import {
  AlertInterval,
  SearchCondition,
  SearchConditionLanguage,
} from '@hyperdx/common-utils/dist/types';
import { Paper } from '@mantine/core';

import { DBTimeChart } from '@/components/DBTimeChart';
import { useSource } from '@/source';
import { intervalToDateRange, intervalToGranularity } from '@/utils/alerts';

import { getAlertReferenceLines } from './Alerts';

export type AlertPreviewChartProps = {
  sourceId?: string | null;
  where?: SearchCondition | null;
  whereLanguage?: SearchConditionLanguage | null;
  interval: AlertInterval;
  groupBy?: string;
  thresholdType: 'above' | 'below';
  threshold: number;
};

export const AlertPreviewChart = ({
  sourceId,
  where,
  whereLanguage,
  interval,
  groupBy,
  threshold,
  thresholdType,
}: AlertPreviewChartProps) => {
  const { data: source } = useSource({ id: sourceId });

  if (!sourceId || !source) {
    return null;
  }

  return (
    <Paper w="100%" h={200}>
      <DBTimeChart
        sourceId={sourceId}
        showDisplaySwitcher={false}
        referenceLines={getAlertReferenceLines({ threshold, thresholdType })}
        config={{
          where: where || '',
          whereLanguage: whereLanguage || undefined,
          dateRange: intervalToDateRange(interval),
          granularity: intervalToGranularity(interval),
          implicitColumnExpression: source.implicitColumnExpression,
          groupBy,
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
