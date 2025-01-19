import React from 'react';
import { Label, ReferenceArea, ReferenceLine } from 'recharts';
import { Paper } from '@mantine/core';

import { SavedSearch } from '@/commonTypes';
import { DBTimeChart } from '@/components/DBTimeChart';
import { useSource } from '@/source';
import { AlertInterval } from '@/types';
import { intervalToDateRange, intervalToGranularity } from '@/utils/alerts';

export type AlertPreviewChartProps = {
  savedSearch?: SavedSearch;
  interval: AlertInterval;
  groupBy?: string;
  thresholdType: 'above' | 'below';
  threshold: number;
};

export const AlertPreviewChart = ({
  savedSearch,
  interval,
  groupBy,
  threshold,
  thresholdType,
}: AlertPreviewChartProps) => {
  const { data: source } = useSource({ id: savedSearch?.source });

  if (!savedSearch || !source) {
    return null;
  }

  return (
    <Paper w="100%" h={200}>
      <DBTimeChart
        sourceId={savedSearch.source}
        showDisplaySwitcher={false}
        referenceLines={
          <>
            {threshold != null && thresholdType === 'below' && (
              <ReferenceArea
                y1={0}
                y2={threshold}
                ifOverflow="extendDomain"
                strokeWidth={0}
                fillOpacity={0.15}
              />
            )}
            {threshold != null && thresholdType === 'above' && (
              <ReferenceArea
                y1={threshold}
                ifOverflow="extendDomain"
                strokeWidth={0}
                fillOpacity={0.15}
              />
            )}
            {threshold != null && (
              <ReferenceLine
                y={threshold}
                label={<Label value="Alert Threshold" fill={'white'} />}
                stroke="red"
                strokeDasharray="3 3"
              />
            )}
          </>
        }
        config={{
          where: savedSearch.where || '',
          whereLanguage: savedSearch.whereLanguage,
          dateRange: intervalToDateRange(interval),
          granularity: intervalToGranularity(interval),
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
