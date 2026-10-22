import { useMemo } from 'react';
import { StaticListDashboardFilter } from '@hyperdx/common-utils/dist/types';

/** Stable identities: static filters never error, so these never change. */
const EMPTY_ERRORED_IDS: ReadonlySet<string> = new Set();
const EMPTY_ERROR_MESSAGES: ReadonlyMap<string, string> = new Map();

export function useStaticDashboardFilterValues({
  filters,
}: {
  filters: StaticListDashboardFilter[];
}) {
  const data = useMemo(() => {
    const byId = new Map<string, { values: string[]; isLoading: boolean }>();
    for (const filter of filters) {
      byId.set(filter.id, { values: filter.options, isLoading: false });
    }
    return byId;
  }, [filters]);

  return {
    data,
    erroredFilterIds: EMPTY_ERRORED_IDS,
    filterErrorMessages: EMPTY_ERROR_MESSAGES,
    isLoading: false,
    isFetching: false,
    isError: false,
  };
}
