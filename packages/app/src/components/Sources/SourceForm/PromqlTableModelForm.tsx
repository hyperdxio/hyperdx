import { useEffect } from 'react';

import { TableModelProps } from './types';

export function PromqlTableModelForm({
  control: _control,
  setValue,
}: TableModelProps) {
  useEffect(() => {
    setValue('timestampValueExpression' as any, 'timestamp');
  }, [setValue]);

  // PromQL sources use the standard database + table fields from BaseSourceSchema.
  // No additional fields needed; the table should point to the TimeSeries engine table.
  return null;
}
