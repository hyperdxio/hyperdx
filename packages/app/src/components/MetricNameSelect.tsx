import { useMemo } from 'react';
import { addDays, differenceInDays, subDays } from 'date-fns';
import {
  DateRange,
  MetricsDataType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';

import { useGetKeyValues } from '@/hooks/useMetadata';
import { capitalizeFirstLetter } from '@/utils';

const MAX_METRIC_NAME_OPTIONS = 3000;
const SEPARATOR = ':::::::';

const chartConfigByMetricType = ({
  dateRange,
  metricSource,
  metricType,
}: {
  dateRange?: DateRange['dateRange'];
  metricSource: TSource;
  metricType: MetricsDataType;
}) => {
  const now = new Date();
  let _dateRange: DateRange['dateRange'] = dateRange
    ? dateRange
    : [subDays(now, 1), now];
  const diffInDays = differenceInDays(_dateRange[1], _dateRange[0]);

  if (diffInDays < 1) {
    const nextDay = addDays(_dateRange[0], 1);
    if (nextDay > now) {
      _dateRange = [subDays(_dateRange[1], 1), _dateRange[1]];
    } else {
      _dateRange = [_dateRange[0], nextDay];
    }
  } else if (diffInDays > 3) {
    // most recent 3 days
    _dateRange = [subDays(_dateRange[1], 3), _dateRange[1]];
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
  }, [metricSource, dateRange]);

  const { data: gaugeMetrics } = useGetKeyValues({
    chartConfig: gaugeConfig,
    keys: ['MetricName'],
    limit: MAX_METRIC_NAME_OPTIONS,
    disableRowLimit: true,
  });
  const { data: histogramMetrics } = useGetKeyValues({
    chartConfig: histogramConfig,
    keys: ['MetricName'],
    limit: MAX_METRIC_NAME_OPTIONS,
    disableRowLimit: true,
  });
  const { data: sumMetrics } = useGetKeyValues({
    chartConfig: sumConfig,
    keys: ['MetricName'],
    limit: MAX_METRIC_NAME_OPTIONS,
    disableRowLimit: true,
  });

  return {
    gaugeMetrics: gaugeMetrics?.[0].value,
    histogramMetrics: histogramMetrics?.[0].value,
    sumMetrics: sumMetrics?.[0].value,
  };
}

export function getMetricOptions(
  gaugeMetrics: string[] | undefined,
  histogramMetrics: string[] | undefined,
  sumMetrics: string[] | undefined,
  metricName: string | null | undefined,
  metricType: MetricsDataType,
) {
  const metricsFromQuery = [
    ...(gaugeMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}gauge`,
      label: `${metric} (Gauge)`,
    })) ?? []),
    ...(histogramMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}histogram`,
      label: `${metric} (Histogram)`,
    })) ?? []),
    ...(sumMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}sum`,
      label: `${metric} (Sum)`,
    })) ?? []),
  ];
  // if saved metric does not exist in the available options, assume it exists
  // and add it to options
  if (
    metricName &&
    !metricsFromQuery.find(
      metric => metric.value === `${metricName}${SEPARATOR}${metricType}`,
    )
  ) {
    metricsFromQuery.push({
      value: `${metricName}${SEPARATOR}${metricType}`,
      label: `${metricName} (${capitalizeFirstLetter(metricType)})`,
    });
  }
  return metricsFromQuery;
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
  error,
  onFocus,
  'data-testid': dataTestId,
}: {
  dateRange?: DateRange['dateRange'];
  metricType: MetricsDataType;
  metricName: string | undefined | null;
  setMetricType: (metricType: MetricsDataType) => void;
  setMetricName: (metricName: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  metricSource: TSource;
  error?: string;
  onFocus?: () => void;
  'data-testid'?: string;
}) {
  const { gaugeMetrics, histogramMetrics, sumMetrics } =
    useMetricNames(metricSource);

  const options = useMemo(() => {
    return getMetricOptions(
      gaugeMetrics,
      histogramMetrics,
      sumMetrics,
      metricName,
      metricType,
    );
  }, [gaugeMetrics, histogramMetrics, sumMetrics, metricName, metricType]);

  const currentValue =
    metricName && metricType ? `${metricName}${SEPARATOR}${metricType}` : null;

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
      value={currentValue}
      searchable
      clearable
      onChange={value => {
        const [_metricName, _metricType] = value?.split(SEPARATOR) ?? [];
        setMetricName(_metricName ?? '');
        if (_metricType) {
          setMetricType(_metricType.toLowerCase() as MetricsDataType);
        }
      }}
      onFocus={onFocus}
      error={error}
      data-testid={dataTestId}
    />
  );
}
