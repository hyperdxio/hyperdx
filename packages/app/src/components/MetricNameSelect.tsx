import { useMemo } from 'react';
import { Control, UseControllerProps } from 'react-hook-form';
import { MetricsDataType, TSource } from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';

import { useGetKeyValues } from '@/hooks/useMetadata';

const dateRange = [new Date(Date.now() - 1000 * 60 * 60 * 24), new Date()] as [
  Date,
  Date,
];

const chartConfigByMetricType = (
  metricSource: TSource,
  metricType: MetricsDataType,
) => ({
  // metricSource,
  from: {
    databaseName: metricSource.from.databaseName,
    tableName: metricSource.metricTables?.[metricType] ?? '',
  },
  where: '',
  whereLanguage: 'sql' as const,
  select: '',
  timestampValueExpression: metricSource.timestampValueExpression ?? '',
  connection: metricSource.connection,
  // TODO: Set proper date range (optional)
  dateRange,
});

function useMetricNames(metricSource: TSource) {
  const { gaugeConfig, histogramConfig, sumConfig } = useMemo(() => {
    return {
      gaugeConfig: chartConfigByMetricType(metricSource, MetricsDataType.Gauge),
      histogramConfig: chartConfigByMetricType(
        metricSource,
        MetricsDataType.Histogram,
      ),
      sumConfig: chartConfigByMetricType(metricSource, MetricsDataType.Sum),
    };
  }, [metricSource]);

  const { data: gaugeMetrics } = useGetKeyValues({
    chartConfig: gaugeConfig,
    keys: ['MetricName'],
  });
  const { data: histogramMetrics } = useGetKeyValues({
    chartConfig: histogramConfig,
    keys: ['MetricName'],
  });
  const { data: sumMetrics } = useGetKeyValues({
    chartConfig: sumConfig,
    keys: ['MetricName'],
  });

  return {
    gaugeMetrics: gaugeMetrics?.[0].value,
    histogramMetrics: histogramMetrics?.[0].value,
    sumMetrics: sumMetrics?.[0].value,
  };
}

export function MetricNameSelect({
  metricType,
  metricName,
  setMetricType,
  setMetricName,
  isLoading,
  isError,
  metricSource,
}: {
  metricType: MetricsDataType;
  metricName: string;
  setMetricType: (metricType: MetricsDataType) => void;
  setMetricName: (metricName: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  metricSource: TSource;
}) {
  const SEPARATOR = ':::::::';

  const { gaugeMetrics, histogramMetrics, sumMetrics } =
    useMetricNames(metricSource);

  const options = useMemo(() => {
    return [
      ...(gaugeMetrics?.map(metric => ({
        value: `${metric}${SEPARATOR}Gauge`,
        label: `${metric} (Gauge)`,
      })) ?? []),
      ...(histogramMetrics?.map(metric => ({
        value: `${metric}${SEPARATOR}Histogram`,
        label: `${metric} (Histogram)`,
      })) ?? []),
      ...(sumMetrics?.map(metric => ({
        value: `${metric}${SEPARATOR}Sum`,
        label: `${metric} (Sum)`,
      })) ?? []),
    ];
  }, [gaugeMetrics, histogramMetrics, sumMetrics]);

  return (
    <Select
      disabled={isLoading || isError}
      variant="filled"
      placeholder={
        isLoading
          ? 'Loading...'
          : isError
            ? 'Unable to load metrics'
            : 'Select a metric...'
      }
      data={options}
      limit={100}
      comboboxProps={{
        position: 'bottom-start',
        width: 'auto',
        zIndex: 1111,
      }}
      value={`${metricName}${SEPARATOR}${metricType}`}
      searchable
      clearable
      onChange={value => {
        const [metricName, metricType] = value?.split(SEPARATOR) ?? [];
        setMetricName(metricName ?? '');
        setMetricType(metricType as MetricsDataType);
      }}
    />
  );
}
