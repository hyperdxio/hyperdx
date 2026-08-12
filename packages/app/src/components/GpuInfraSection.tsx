import { useMemo, useState } from 'react';
import { add, min, sub } from 'date-fns';
import {
  convertDateRangeToGranularityString,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import { TMetricSource } from '@hyperdx/common-utils/dist/types';
import { Card, Group, SegmentedControl, SimpleGrid } from '@mantine/core';

import { convertV1ChartConfigToV2 } from '@/ChartUtils';
import {
  GPU_METRIC_NAMES,
  useGpuMetricsAvailability,
} from '@/hooks/useGpuMetricsAvailability';
import { NumberFormat } from '@/types';

import { DBTimeChart } from './DBTimeChart';

const GPU_UTILIZATION_NUMBER_FORMAT: NumberFormat = {
  output: 'percent',
  mantissa: 1,
};

type GpuChartDef = {
  title: string;
  cardTestId: string;
  metricName: string;
  numberFormat: NumberFormat;
  where?: string;
};

const GPU_CHARTS: GpuChartDef[] = [
  {
    title: 'GPU utilization',
    cardTestId: 'gpu-utilization-card',
    metricName: GPU_METRIC_NAMES.utilization,
    numberFormat: GPU_UTILIZATION_NUMBER_FORMAT,
    where: 'hw.gpu.task:"general" OR NOT _exists_:hw.gpu.task',
  },
  {
    title: 'GPU memory utilization',
    cardTestId: 'gpu-memory-utilization-card',
    metricName: GPU_METRIC_NAMES.memoryUtilization,
    numberFormat: GPU_UTILIZATION_NUMBER_FORMAT,
  },
];

function isChartAvailable(
  chart: GpuChartDef,
  availability: { hasUtilization: boolean; hasMemoryUtilization: boolean },
): boolean {
  if (chart.metricName === GPU_METRIC_NAMES.utilization) {
    return availability.hasUtilization;
  }
  if (chart.metricName === GPU_METRIC_NAMES.memoryUtilization) {
    return availability.hasMemoryUtilization;
  }
  return false;
}

export function GpuInfraSection({
  metricSource,
  where,
  timestamp,
}: {
  metricSource: TMetricSource;
  where: string;
  timestamp: number;
}) {
  const [range, setRange] = useState<'30m' | '1h' | '1d'>('30m');
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('sm');

  const dateRange = useMemo<[Date, Date]>(() => {
    const duration = {
      '30m': { minutes: 15 },
      '1h': { minutes: 30 },
      '1d': { hours: 12 },
    }[range];
    return [
      sub(new Date(timestamp), duration),
      // eslint-disable-next-line no-restricted-syntax
      min([add(new Date(timestamp), duration), new Date()]),
    ];
  }, [timestamp, range]);

  const availability = useGpuMetricsAvailability({
    metricSource,
    where,
    dateRange,
  });

  const { cols, height } = useMemo(() => {
    switch (size) {
      case 'sm':
        return { cols: 3, height: 200 };
      case 'md':
        return { cols: 2, height: 250 };
      case 'lg':
        return { cols: 1, height: 320 };
    }
  }, [size]);

  const granularity = useMemo<Granularity>(() => {
    return convertDateRangeToGranularityString(dateRange);
  }, [dateRange]);

  const visibleCharts = useMemo(
    () => GPU_CHARTS.filter(chart => isChartAvailable(chart, availability)),
    [availability],
  );

  if (availability.isLoading || !availability.hasAny) {
    return null;
  }

  return (
    <div data-testid="infra-subpanel-gpu">
      <Group justify="space-between" align="center">
        <Group align="center">
          <h4 className="fs-6 m-0">GPU</h4>
          <SegmentedControl
            size="xs"
            data={[
              { label: '30m', value: '30m' },
              { label: '1h', value: '1h' },
              { label: '1d', value: '1d' },
            ]}
            value={range}
            onChange={value => setRange(value as any)}
          />
        </Group>
        <Group align="center">
          <SegmentedControl
            size="xs"
            data={[
              { label: 'SM', value: 'sm' },
              { label: 'MD', value: 'md' },
              { label: 'LG', value: 'lg' },
            ]}
            value={size}
            onChange={value => setSize(value as any)}
          />
        </Group>
      </Group>
      <SimpleGrid mt="md" cols={cols}>
        {visibleCharts.map(chart => (
          <Card key={chart.cardTestId} data-testid={chart.cardTestId}>
            <Card.Section py={8} px={8} h={height}>
              <DBTimeChart
                title={chart.title}
                config={convertV1ChartConfigToV2(
                  {
                    dateRange,
                    granularity,
                    seriesReturnType: 'column',
                    series: [
                      {
                        type: 'time',
                        where: chart.where
                          ? `(${where}) AND (${chart.where})`
                          : where,
                        groupBy: [`Attributes['hw.id']`],
                        aggFn: 'avg',
                        field: `${chart.metricName} - Gauge`,
                        table: 'metrics',
                        numberFormat: chart.numberFormat,
                      },
                    ],
                  },
                  {
                    metric: metricSource,
                  },
                )}
                showDisplaySwitcher={false}
                logReferenceTimestamp={timestamp / 1000}
              />
            </Card.Section>
          </Card>
        ))}
      </SimpleGrid>
    </div>
  );
}
