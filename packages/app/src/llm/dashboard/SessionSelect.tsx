import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { SelectProps } from '@mantine/core';

import { LLMExpressions } from '@/llm/lib/expressions';

import { DistinctValueSelect } from './DistinctValueSelect';

/**
 * Session filter dropdown: distinct session/conversation ids seen on LLM
 * spans in the searched range, resolved via the cross-dialect session
 * expression (gen_ai.conversation.id, session.id,
 * ai.telemetry.metadata.sessionId).
 */
export function SessionSelect({
  source,
  expressions,
  ...props
}: {
  /** Trace source: session ids are resolved from LLM spans. */
  source: TTraceSource | undefined;
  expressions: LLMExpressions | undefined;
  dateRange: [Date, Date];
  value: string;
  onChange: (sessionId: string) => void;
} & Omit<SelectProps, 'data' | 'value' | 'onChange'>) {
  return (
    <DistinctValueSelect
      {...props}
      source={source}
      valueExpression={expressions?.sessionId}
      gateExpression={
        expressions &&
        `${expressions.isLLMSpan} AND ${expressions.hasSessionId}`
      }
      queryKey="llm-session-select"
      allLabel="All sessions"
    />
  );
}
