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
    const found =
      data?.data
        ?.map((d: any) => d.value)
        .filter(Boolean)
        .sort() || [];
    return [{ value: '', label: allLabel }, ...found];
  }, [data, allLabel]);

  // Mantine does not clear the select if the value disappears from data
  // (e.g. the searched window changed and the value is no longer in it).
  const selected = values.some(d =>
    typeof d === 'string' ? d === value : d.value === value,
  );

  return (
    <Select
      {...props}
      data={values}
      value={selected ? value : null}
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
