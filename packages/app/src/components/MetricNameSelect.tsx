import { useMemo, useState } from 'react';
import { addDays, differenceInDays, subDays } from 'date-fns';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import { useGetMetricNames } from '@/hooks/useMetadata';
import { capitalizeFirstLetter } from '@/utils';

const SEPARATOR = ':::::::';
const SEARCH_DEBOUNCE_MS = 300;

const metricNamesQueryArgs = ({
  dateRange,
  metricSource,
  metricType,
}: {
  dateRange?: DateRange['dateRange'];
  metricSource: TMetricSource;
  metricType: MetricsDataType;
}) => {
  // eslint-disable-next-line no-restricted-syntax
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
    databaseName: metricSource.from.databaseName,
    // Empty when this source has no table for the kind, which disables the query
    // rather than emitting `FROM db.``` and failing on every render.
    tableName: metricSource.metricTables?.[metricType] ?? '',
    connectionId: metricSource.connection,
    timestampValueExpression: metricSource.timestampValueExpression ?? '',
    dateRange: _dateRange,
  };
};

function useMetricNames(
  metricSource: TMetricSource,
  dateRange?: DateRange['dateRange'],
  namePattern?: string,
) {
  const { gaugeArgs, histogramArgs, sumArgs, exponentialHistogramArgs } =
    useMemo(
      () => ({
        gaugeArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.Gauge,
        }),
        histogramArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.Histogram,
        }),
        sumArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.Sum,
        }),
        exponentialHistogramArgs: metricNamesQueryArgs({
          dateRange,
          metricSource,
          metricType: MetricsDataType.ExponentialHistogram,
        }),
      }),
      [metricSource, dateRange],
    );

  const gauge = useGetMetricNames({ ...gaugeArgs, namePattern });
  const histogram = useGetMetricNames({ ...histogramArgs, namePattern });
  const sum = useGetMetricNames({ ...sumArgs, namePattern });
  const exponentialHistogram = useGetMetricNames({
    ...exponentialHistogramArgs,
    namePattern,
  });

  return {
    gaugeMetrics: gauge.data?.names,
    histogramMetrics: histogram.data?.names,
    sumMetrics: sum.data?.names,
    exponentialHistogramMetrics: exponentialHistogram.data?.names,
    isTruncated: [gauge, histogram, sum, exponentialHistogram].some(
      query => query.data?.truncated,
    ),
    // Surfaced because a failed kind otherwise just vanishes from the list: the
    // query is not retried, so a transient error or a query too slow to finish
    // would silently omit those metrics from an apparently healthy dropdown.
    hasError: [gauge, histogram, sum, exponentialHistogram].some(
      query => query.isError,
    ),
  };
}

export function getMetricOptions(
  gaugeMetrics: string[] | undefined,
  histogramMetrics: string[] | undefined,
  sumMetrics: string[] | undefined,
  exponentialHistogramMetrics: string[] | undefined,
  metricName: string | null | undefined,
  metricType: MetricsDataType,
) {
  const metricsFromQuery = [
    ...(gaugeMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}${MetricsDataType.Gauge}`,
      label: `${metric} (Gauge)`,
    })) ?? []),
    ...(histogramMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}${MetricsDataType.Histogram}`,
      label: `${metric} (Histogram)`,
    })) ?? []),
    ...(sumMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}${MetricsDataType.Sum}`,
      label: `${metric} (Sum)`,
    })) ?? []),
    ...(exponentialHistogramMetrics?.map(metric => ({
      value: `${metric}${SEPARATOR}${MetricsDataType.ExponentialHistogram}`,
      label: `${metric} (Exponential Histogram)`,
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
  metricType,
  metricName,
  setMetricType,
  setMetricName,
  isLoading,
  isError,
  metricSource,
  dateRange,
  error,
  onFocus,
  'data-testid': dataTestId,
}: {
  metricType: MetricsDataType;
  metricName: string | undefined | null;
  setMetricType: (metricType: MetricsDataType) => void;
  setMetricName: (metricName: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  metricSource: TMetricSource;
  dateRange?: DateRange['dateRange'];
  error?: string;
  onFocus?: () => void;
  'data-testid'?: string;
}) {
  const [searchValue, setSearchValue] = useState('');

  // Mantine mirrors the selected option's *label* into a searchable Select's
  // input when the selection changes, and reports it through `onSearchChange`
  // exactly like typed text. Passing that on would search ClickHouse for
  // "up (Gauge)", which matches nothing, so an already-configured chart would
  // open to an empty list. Compared case-insensitively because the label for a
  // saved exponential-histogram metric differs only in case from the one built
  // for a discovered metric.
  const selectedLabel = metricName
    ? `${metricName} (${capitalizeFirstLetter(metricType)})`
    : '';
  const trimmedSearch = searchValue.trim();
  const activeSearch =
    trimmedSearch.toLowerCase() === selectedLabel.toLowerCase()
      ? ''
      : trimmedSearch;

  const [debouncedSearch] = useDebouncedValue(activeSearch, SEARCH_DEBOUNCE_MS);

  const {
    gaugeMetrics,
    histogramMetrics,
    sumMetrics,
    exponentialHistogramMetrics,
    isTruncated,
    hasError,
  } = useMetricNames(metricSource, dateRange, debouncedSearch);

  const options = useMemo(() => {
    return getMetricOptions(
      gaugeMetrics,
      histogramMetrics,
      sumMetrics,
      exponentialHistogramMetrics,
      metricName,
      metricType,
    );
  }, [
    gaugeMetrics,
    histogramMetrics,
    sumMetrics,
    exponentialHistogramMetrics,
    metricName,
    metricType,
  ]);

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
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      // Start each browse from an empty input so the full list is offered and the
      // mirrored label cannot be partially deleted and searched for; restore it
      // on close so a collapsed control still shows its selection.
      onDropdownOpen={() => setSearchValue('')}
      onDropdownClose={() => setSearchValue(selectedLabel)}
      // Reported in the description rather than the `error` slot, which belongs
      // to form validation for this field.
      description={
        hasError
          ? 'Some metrics could not be loaded'
          : isTruncated
            ? 'Too many metrics to list — type to search'
            : undefined
      }
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
