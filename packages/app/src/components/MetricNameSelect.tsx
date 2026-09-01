import { useMemo, useState } from 'react';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import { useMetricNames } from '@/hooks/useMetricNames';
import { capitalizeFirstLetter } from '@/utils';

const SEPARATOR = ':::::::';
const SEARCH_DEBOUNCE_MS = 300;

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
    hasNoMatches,
    isFetching: isSearching,
  } = useMetricNames(metricSource, dateRange, debouncedSearch);

  const options = useMemo(() => {
    const metricOptions = getMetricOptions(
      gaugeMetrics,
      histogramMetrics,
      sumMetrics,
      exponentialHistogramMetrics,
      metricName,
      metricType,
    );
    // A name missing from the picker is not necessarily missing from the data:
    // the catalog query covers only the most recent 3 days of the chart's range,
    // and a kind with no table configured is never queried. Offer the searched
    // name so a pasted metric is not stranded — the select has no other way to
    // commit a value that is not already an option. Built from the debounced
    // search, so the offer appears only once the query behind it has answered,
    // and the name is embedded in the label because Mantine filters options by
    // substring against the label and would otherwise drop this one.
    const typedValue = `${debouncedSearch}${SEPARATOR}${metricType}`;
    // Skipped when that value is already an option, or Mantine throws on the
    // duplicate and takes the whole editor down. Committing this offer puts the
    // name in `metricName`, which `getMetricOptions` then synthesizes an option
    // for, while the debounced search still holds the same name for one more
    // interval — so the collision is the normal path through here, not an edge
    // case.
    if (
      debouncedSearch &&
      hasNoMatches &&
      !metricOptions.some(option => option.value === typedValue)
    ) {
      metricOptions.push({
        value: typedValue,
        label: `Use "${debouncedSearch}" (no recent data)`,
      });
    }
    return metricOptions;
  }, [
    gaugeMetrics,
    histogramMetrics,
    sumMetrics,
    exponentialHistogramMetrics,
    metricName,
    metricType,
    debouncedSearch,
    hasNoMatches,
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
      // Without a message Mantine sets `hiddenWhenEmpty`, so a search matching
      // nothing hides the whole dropdown and the field just looks broken.
      nothingFoundMessage={
        isSearching
          ? 'Searching…'
          : hasError
            ? 'Some metrics failed to load'
            : 'No metrics reported recently'
      }
      // Reported in the description rather than the `error` slot, which belongs
      // to form validation for this field. Kept below the input: it appears
      // mid-session, and above the input it pushes the field down out of
      // alignment with the browse-metrics button beside it.
      inputWrapperOrder={['label', 'input', 'description', 'error']}
      description={
        hasError
          ? 'Some metrics failed to load'
          : isTruncated
            ? 'Type to search all metrics'
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
