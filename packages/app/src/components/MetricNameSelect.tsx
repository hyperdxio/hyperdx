import { useMemo, useState } from 'react';
import {
  DateRange,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import { useMetricNames } from '@/hooks/useMetricNames';
import {
  metricKindLabel,
  QUERYABLE_KINDS,
  type QueryableMetricKind,
} from '@/utils/metricKinds';

const SEPARATOR = ':::::::';
const SEARCH_DEBOUNCE_MS = 300;

const metricOptionValue = (metricName: string, metricType: MetricsDataType) =>
  `${metricName}${SEPARATOR}${metricType}`;

export function getMetricOptions(
  namesByKind: Record<QueryableMetricKind, string[] | undefined>,
  metricName: string | null | undefined,
  metricType: MetricsDataType,
) {
  const metricsFromQuery = QUERYABLE_KINDS.flatMap(
    kind =>
      namesByKind[kind]?.map(metric => ({
        value: metricOptionValue(metric, kind),
        label: `${metric} (${metricKindLabel(kind)})`,
      })) ?? [],
  );
  // if saved metric does not exist in the available options, assume it exists
  // and add it to options
  if (
    metricName &&
    !metricsFromQuery.find(
      metric => metric.value === metricOptionValue(metricName, metricType),
    )
  ) {
    metricsFromQuery.push({
      value: metricOptionValue(metricName, metricType),
      label: `${metricName} (${metricKindLabel(metricType)})`,
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
  // open to an empty list. Built from the same label helper as the options, so
  // the two always agree; compared case-insensitively as a cheap guard against
  // that drifting again.
  const selectedLabel = metricName
    ? `${metricName} (${metricKindLabel(metricType)})`
    : '';
  const trimmedSearch = searchValue.trim();
  const activeSearch =
    trimmedSearch.toLowerCase() === selectedLabel.toLowerCase()
      ? ''
      : trimmedSearch;

  const [debouncedSearch] = useDebouncedValue(activeSearch, SEARCH_DEBOUNCE_MS);
  // The debounce has not fired yet, so the options on screen answer the
  // previous text and no query is in flight for the current one.
  const isSearchPending = activeSearch !== debouncedSearch;

  const {
    namesByKind,
    isTruncated,
    hasError,
    hasNoMatches,
    isFetching: isSearching,
  } = useMetricNames(metricSource, dateRange, debouncedSearch);

  const options = useMemo(() => {
    const metricOptions = getMetricOptions(namesByKind, metricName, metricType);
    // A name missing from the picker is not necessarily missing from the data:
    // the catalog query covers only the most recent 3 days of the chart's range,
    // and a kind with no table configured is never queried. Offer the searched
    // name so a pasted metric is not stranded — the select has no other way to
    // commit a value that is not already an option. Built from the debounced
    // search, so an offer appears only once the query behind it has answered,
    // and the name is embedded in the label because Mantine filters options by
    // substring against the label and would otherwise drop these.
    //
    // One offer per kind, because the kind decides which table the series is
    // read from and a pasted name carries no kind. Filing it under whatever the
    // last selection happened to use would query the wrong table and chart
    // nothing, with no way to correct it.
    if (debouncedSearch && hasNoMatches) {
      for (const kind of QUERYABLE_KINDS) {
        // A kind with no table is not queryable on this source, so committing
        // the name under it could never resolve.
        if (!metricSource.metricTables?.[kind]) {
          continue;
        }
        const value = metricOptionValue(debouncedSearch, kind);
        // Committing an offer puts the name in `metricName`, which
        // `getMetricOptions` then synthesizes its own option for while the
        // debounced search still holds the same name — and Mantine throws on a
        // duplicate option value, taking the editor down with it.
        if (metricOptions.some(option => option.value === value)) {
          continue;
        }
        metricOptions.push({
          value,
          label: `${debouncedSearch} (${metricKindLabel(kind)}, no recent data)`,
        });
      }
    }
    return metricOptions;
  }, [
    namesByKind,
    metricName,
    metricType,
    debouncedSearch,
    hasNoMatches,
    metricSource,
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
        isSearchPending || isSearching
          ? 'Searching…'
          : hasError
            ? 'Some metrics failed to load'
            : activeSearch
              ? 'No matching metrics'
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
