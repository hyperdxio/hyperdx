import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { SelectProps } from '@mantine/core';

import { LLMExpressions } from '@/llm/lib/expressions';

import { DistinctValueSelect } from './DistinctValueSelect';

/**
 * End-user filter dropdown: distinct users seen on LLM spans in the searched
 * range, resolved via the cross-dialect user expression (user.email,
 * enduser.id, user.id, ai.telemetry.metadata.userId).
 *
 * Values come from the same expression the "Top Users" chart groups by, so a
 * selection always matches the rows that produced it.
 */
export function UserSelect({
  source,
  expressions,
  ...props
}: {
  /** Trace source: users are resolved from LLM spans. */
  source: TTraceSource | undefined;
  expressions: LLMExpressions | undefined;
  dateRange: [Date, Date];
  value: string;
  onChange: (userId: string) => void;
} & Omit<SelectProps, 'data' | 'value' | 'onChange'>) {
  return (
    <DistinctValueSelect
      {...props}
      source={source}
      valueExpression={expressions?.userId}
      gateExpression={
        expressions && `${expressions.isLLMSpan} AND ${expressions.hasUserId}`
      }
      queryKey="llm-user-select"
      allLabel="All users"
    />
  );
}
