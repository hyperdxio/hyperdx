import { useMemo } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { sortLowCardinalityFirst } from '@/components/DBSearchPageFilters/utils';
import {
  useAllFields,
  useJsonColumns,
  useMapColumns,
} from '@/hooks/useMetadata';

import { toGroupByField } from './searchGroupBy';

/**
 * Group-by key options for a search source. Mirrors the filter sidebar's keys
 * query (`useFacets`) with the same arguments, so both share one cached result.
 */
export function useGroupByKeyOptions({
  source,
  dateRange,
  enabled,
}: {
  source?: TSource;
  dateRange: [Date, Date];
  enabled: boolean;
}) {
  const tableConnection = useMemo(() => tcFromSource(source), [source]);
  const { data: jsonColumns } = useJsonColumns(tableConnection);
  const { data: mapColumns } = useMapColumns(tableConnection);

  const { data: fields } = useAllFields(tableConnection, {
    dateRange,
    timestampValueExpression: source?.timestampValueExpression,
    enabled: enabled && source != null,
  });

  const options = useMemo(
    () =>
      Array.from(
        new Set(
          sortLowCardinalityFirst(fields ?? [])
            // The histogram only treats string-typed columns as group keys; a
            // numeric one would be plotted as a value series instead.
            .filter(({ jsType }) => jsType === 'string')
            .map(({ path }) =>
              toGroupByField(path, jsonColumns ?? [], mapColumns ?? []),
            ),
        ),
      ),
    [fields, jsonColumns, mapColumns],
  );

  return { options, tableConnection };
}
