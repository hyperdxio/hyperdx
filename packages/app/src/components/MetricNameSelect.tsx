import { useMemo } from 'react';
import {
  DateRange,
  MetricsDataType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';

import { useGetKeyValues } from '@/hooks/useMetadata';

const MAX_METRIC_NAME_OPTIONS = 3000;
const DEFAULT_ONE_DAY_FROM_NOW_RANGE = [
  new Date(Date.now() - 1000 * 60 * 60 * 24),
  new Date(),
] as DateRange['dateRange'];
const DEFAULT_ONE_WEEK_FROM_NOW_RANGE = [
  new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
  new Date(),
] as DateRange['dateRange'];

const chartConfigByMetricType = ({
  dateRange,
  metricSource,
  metricType,
}: {
  dateRange?: DateRange['dateRange'];
  metricSource: TSource;
  metricType: MetricsDataType;
}) => {
  let _dateRange = dateRange ? dateRange : DEFAULT_ONE_DAY_FROM_NOW_RANGE;
  const period = _dateRange[1].getTime() - _dateRange[0].getTime();
  if (period < 1000 * 60 * 60 * 24) {
    _dateRange = DEFAULT_ONE_DAY_FROM_NOW_RANGE;
  } else if (period > 1000 * 60 * 60 * 24 * 7) {
    _dateRange = DEFAULT_ONE_WEEK_FROM_NOW_RANGE;
  }

  return {
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
    dateRange: _dateRange,
  };
};

function useMetricNames(
  metricSource: TSource,
  dateRange?: DateRange['dateRange'],
) {
  const { gaugeConfig, histogramConfig, sumConfig } = useMemo(() => {
    return {
      gaugeConfig: chartConfigByMetricType({
        dateRange,
        metricSource,
        metricType: MetricsDataType.Gauge,
      }),
      histogramConfig: chartConfigByMetricType({
        dateRange,
        metricSource,
        metricType: MetricsDataType.Histogram,
      }),
      sumConfig: chartConfigByMetricType({
        dateRange,
        metricSource,
        metricType: MetricsDataType.Sum,
      }),
    };
  }, [metricSource]);

  const { data: gaugeMetrics } = useGetKeyValues({
    chartConfigs: gaugeConfig,
    keys: ['MetricName'],
    limit: MAX_METRIC_NAME_OPTIONS,
    disableRowLimit: true,
  });
  // const { data: histogramMetrics } = useGetKeyValues({
  //   chartConfigs: histogramConfig,
  //   keys: ['MetricName'],
  //   limit: MAX_METRIC_NAME_OPTIONS,
  //   disableRowLimit: true,
  // });
  const { data: sumMetrics } = useGetKeyValues({
    chartConfigs: sumConfig,
    keys: ['MetricName'],
    limit: MAX_METRIC_NAME_OPTIONS,
    disableRowLimit: true,
  });

  return {
    gaugeMetrics: gaugeMetrics?.[0].value,
    // histogramMetrics: histogramMetrics?.[0].value,
    sumMetrics: sumMetrics?.[0].value,
  };
}

export function MetricNameSelect({
  dateRange,
  metricType,
  metricName,
  setMetricType,
  setMetricName,
  isLoading,
  isError,
  metricSource,
}: {
  dateRange?: DateRange['dateRange'];
  metricType: MetricsDataType;
  metricName: string | undefined | null;
  setMetricType: (metricType: MetricsDataType) => void;
  setMetricName: (metricName: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  metricSource: TSource;
}) {
  const SEPARATOR = ':::::::';

  const {
    gaugeMetrics,
    // , histogramMetrics
    sumMetrics,
  } = useMetricNames(metricSource, dateRange);

  const options = useMemo(() => {
    return [
      ...(gaugeMetrics?.map(metric => ({
        value: `${metric}${SEPARATOR}gauge`,
        label: `${metric} (Gauge)`,
      })) ?? []),
      // ...(histogramMetrics?.map(metric => ({
      //   value: `${metric}${SEPARATOR}histogram`,
      //   label: `${metric} (Histogram)`,
      // })) ?? []),
      ...(sumMetrics?.map(metric => ({
        value: `${metric}${SEPARATOR}sum`,
        label: `${metric} (Sum)`,
      })) ?? []),
    ];
  }, [
    gaugeMetrics,
    // histogramMetrics,
    sumMetrics,
  ]);

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
        const [_metricName, _metricType] = value?.split(SEPARATOR) ?? [];
        setMetricName(_metricName ?? '');
        if (_metricType) {
          setMetricType(_metricType.toLowerCase() as MetricsDataType);
        }
      }}
    />
  );
}
