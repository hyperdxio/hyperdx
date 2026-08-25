import { useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import SelectControlled from '@/components/SelectControlled';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { LLMExpressions } from '@/llm/lib/expressions';

/**
 * Session filter dropdown: distinct session/conversation ids seen on LLM
 * spans in the searched range, resolved via the cross-dialect session
 * expression (gen_ai.conversation.id, session.id,
 * ai.telemetry.metadata.sessionId).
 */
export function SessionSelectControlled({
  source,
  expressions,
  dateRange,
  ...props
}: {
  /** Trace source: session ids are resolved from LLM spans. */
  source: TTraceSource | undefined;
  expressions: LLMExpressions | undefined;
  dateRange: [Date, Date];
  size?: string;
} & UseControllerProps<any>) {
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

  return (
    <SelectControlled
      {...props}
      data={values}
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
