import { useMemo } from 'react';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Select, SelectProps } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';

/**
 * Dropdown over the distinct values of one LLM span expression in the
 * searched range — the shape both dashboard-wide scope filters (session,
 * user) share.
 *
 * Plain value/onChange: the dashboard keeps these scopes in the URL rather
 * than in the search form, so they can also be set programmatically (e.g. the
 * session drawer's "Filter dashboard") without two-way form sync.
 */
export function DistinctValueSelect({
  source,
  valueExpression,
  gateExpression,
  queryKey,
  allLabel,
  value,
  onChange,
  dateRange,
  ...props
}: {
  source: TTraceSource | undefined;
  /** Expression whose distinct values populate the dropdown. */
  valueExpression: string | undefined;
  /** Scope predicate, ANDed with the LLM-span filter (e.g. hasUserId). */
  gateExpression: string | undefined;
  /** Distinguishes this select's cached query from its siblings'. */
  queryKey: string;
  /** Label for the "no filter" option, e.g. 'All users'. */
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  dateRange: [Date, Date];
} & Omit<SelectProps, 'data' | 'value' | 'onChange'>) {
  const enabled =
    source?.kind === SourceKind.Trace && !!valueExpression && !!gateExpression;

  const queriedConfig = {
    source: source?.id,
    timestampValueExpression: source?.timestampValueExpression || '',
    from: {
      databaseName: source?.from.databaseName || '',
      tableName: source?.from.tableName || '',
    },
    connection: source?.connection || '',
    select: [
      { alias: 'value', valueExpression: `distinct(${valueExpression})` },
    ],
    where: gateExpression || '',
    whereLanguage: 'sql' as const,
    limit: { limit: 10000 },
    dateRange,
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: [queryKey, queriedConfig],
    enabled,
  });

  const values = useMemo(() => {
    const found: string[] =
      data?.data
        ?.map((d: any) => d.value)
        .filter(Boolean)
        .sort() || [];
    // Keep the applied value selectable even when it is not in `found`, so the
    // control can never read "all" while the charts are still filtered. It is
    // missing in three cases, only one of which is staleness: the query has
    // not resolved yet (deep link into a filtered URL), the value fell off the
    // end of the row limit, or the searched window no longer contains it.
    //
    // Clearing the parent instead would silently discard a filter in the first
    // two, and would mean writing to the URL from a render driven by fetch
    // timing — which is what keeping these selects out of the search form is
    // meant to avoid.
    const applied = value && !found.includes(value) ? [value] : [];
    return [{ value: '', label: allLabel }, ...applied, ...found];
  }, [data, allLabel, value]);

  return (
    <Select
      {...props}
      data={values}
      value={value || null}
      onChange={v => onChange(v ?? '')}
      disabled={isLoading || isError}
      comboboxProps={{ withinPortal: false }}
      searchable
      clearable
      placeholder={allLabel}
      maxDropdownHeight={280}
      nothingFoundMessage={isLoading ? 'Loading more...' : 'No matches found'}
    />
  );
}
