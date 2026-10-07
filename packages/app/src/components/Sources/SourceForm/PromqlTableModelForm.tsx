import { useEffect } from 'react';

import { PROMQL_TIMESTAMP_EXPRESSION } from '@/source';

import { MinAutoGranularityFormRow } from './MinAutoGranularityFormRow';
import { TableModelProps } from './types';

const PROMQL_MIN_AUTO_GRANULARITY_HELP_TEXT =
  "Floor for 'auto granularity' on charts querying this source. Set this to your metrics' scrape interval to avoid sparse-looking charts on short time ranges. Doesn't affect an explicitly chosen (non-auto) granularity. $__rate_interval is also sized from it, assuming a 15 second scrape interval when no minimum is set.";

export function PromqlTableModelForm({ control, setValue }: TableModelProps) {
  useEffect(() => {
    setValue('timestampValueExpression' as any, PROMQL_TIMESTAMP_EXPRESSION);
  }, [setValue]);

  // PromQL sources use the standard database + table fields from BaseSourceSchema.
  // The table should point to the TimeSeries engine table.
  return (
    <MinAutoGranularityFormRow
      control={control}
      helpText={PROMQL_MIN_AUTO_GRANULARITY_HELP_TEXT}
    />
  );
}
