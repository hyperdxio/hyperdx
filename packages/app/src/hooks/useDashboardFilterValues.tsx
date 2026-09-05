import { useMemo } from 'react';
import { FilterSelection } from '@hyperdx/common-utils/dist/dashboardFilterValues';
import {
  isPrometheusLabelFilter,
  isQueryExpressionFilter,
  isStaticListFilter,
} from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
} from '@hyperdx/common-utils/dist/types';

import { usePromqlLabelFilterValues } from './usePromqlLabelFilterValues';
import { useQueriedDashboardFilterValues } from './useQueriedDashboardFilterValues';
import { useStaticDashboardFilterValues } from './useStaticDashboardFilterValues';

export type DashboardFilterValuesResult = {
  /** Dropdown values keyed by `filter.id` */
  data: ReadonlyMap<string, { values: string[]; isLoading: boolean }>;
  /** Filter IDs whose values lookup failed, or never resolved. */
  erroredFilterIds: ReadonlySet<string>;
  /** Error messages, when known, for filters in `erroredFilterIds`. */
  filterErrorMessages: ReadonlyMap<string, string>;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
};

/** Dropdown values for a dashboard's filters. */
export function useDashboardFilterValues({
  filters,
  dateRange,
  selectionByFilterId,
  variables,
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
  /** Each filter's current selection, keyed by `filter.id`. */
  selectionByFilterId?: ReadonlyMap<string, FilterSelection>;
  /** The dashboard's variables and their current selections, if any */
  variables?: ChartVariable[];
}): DashboardFilterValuesResult {
  const [queriedFilters, staticFilters, promqlLabelFilters] = useMemo(
    () => [
      filters.filter(isQueryExpressionFilter),
      filters.filter(isStaticListFilter),
      filters.filter(isPrometheusLabelFilter),
    ],
    [filters],
  );

  const queriedValues = useQueriedDashboardFilterValues({
    filters: queriedFilters,
    dateRange,
    selectionByFilterId,
    variables,
  });

  const staticValues = useStaticDashboardFilterValues({
    filters: staticFilters,
  });

  const promqlLabelValues = usePromqlLabelFilterValues({
    filters: promqlLabelFilters,
    dateRange,
    variables,
  });

  const data = useMemo(
    () =>
      new Map([
        ...queriedValues.data,
        ...staticValues.data,
        ...promqlLabelValues.data,
      ]),
    [queriedValues.data, staticValues.data, promqlLabelValues.data],
  );

  // The queried hook reports isLoading/isFetching true while sources load even
  // when it was handed no filters at all; only let it speak for itself when it
  // actually has filters to resolve.
  const hasQueriedFilters = queriedFilters.length > 0;
  const hasPromqlLabelFilters = promqlLabelFilters.length > 0;

  const erroredFilterIds = useMemo(
    () =>
      new Set([
        ...queriedValues.erroredFilterIds,
        ...promqlLabelValues.erroredFilterIds,
      ]),
    [queriedValues.erroredFilterIds, promqlLabelValues.erroredFilterIds],
  );

  const filterErrorMessages = useMemo(
    () =>
      new Map([
        ...queriedValues.filterErrorMessages,
        ...promqlLabelValues.filterErrorMessages,
      ]),
    [queriedValues.filterErrorMessages, promqlLabelValues.filterErrorMessages],
  );

  return {
    data,
    erroredFilterIds,
    filterErrorMessages,
    isLoading:
      (hasQueriedFilters && queriedValues.isLoading) ||
      (hasPromqlLabelFilters && promqlLabelValues.isLoading),
    isFetching:
      (hasQueriedFilters && queriedValues.isFetching) ||
      (hasPromqlLabelFilters && promqlLabelValues.isFetching),
    isError: queriedValues.isError || promqlLabelValues.isError,
  };
}
