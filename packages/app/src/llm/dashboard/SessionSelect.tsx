import { useMemo } from 'react';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Select, SelectProps } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { LLMExpressions } from '@/llm/lib/expressions';

/**
 * Session filter dropdown: distinct session/conversation ids seen on LLM
 * spans in the searched range, resolved via the cross-dialect session
 * expression (gen_ai.conversation.id, session.id,
 * ai.telemetry.metadata.sessionId). Plain value/onChange — the dashboard
 * keeps the selected session in the URL, not in the search form.
 */
export function SessionSelect({
  source,
  expressions,
  dateRange,
  value,
  onChange,
  ...props
}: {
  /** Trace source: session ids are resolved from LLM spans. */
  source: TTraceSource | undefined;
  expressions: LLMExpressions | undefined;
  dateRange: [Date, Date];
  value: string;
  onChange: (sessionId: string) => void;
} & Omit<SelectProps, 'data' | 'value' | 'onChange'>) {
  const queriedConfig = {
    source: source?.id,
    timestampValueExpression: source?.timestampValueExpression || '',
    from: {
      databaseName: source?.from.databaseName || '',
      tableName: source?.from.tableName || '',
    },
    connection: source?.connection || '',
    select: [
      {
        alias: 'session',
        valueExpression: `distinct(${expressions?.sessionId})`,
      },
    ],
    where: `${expressions?.isLLMSpan} AND ${expressions?.hasSessionId}`,
    whereLanguage: 'sql' as const,
    limit: { limit: 10000 },
    dateRange,
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: ['llm-session-select', queriedConfig],
    enabled: source?.kind === SourceKind.Trace && !!expressions,
  });

  const values = useMemo(() => {
    const sessions =
      data?.data
        ?.map((d: any) => d.session)
        .filter(Boolean)
        .sort() || [];
    return [{ value: '', label: 'All sessions' }, ...sessions];
  }, [data]);

  // Mantine does not clear the select if the value disappears from data
  // (e.g. the searched window changed and the session is no longer in it).
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
      placeholder="All sessions"
      maxDropdownHeight={280}
      nothingFoundMessage={isLoading ? 'Loading more...' : 'No matches found'}
    />
  );
}
