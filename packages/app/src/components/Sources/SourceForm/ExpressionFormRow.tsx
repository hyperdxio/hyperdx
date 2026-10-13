import { useMemo } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import {
  SourceKind,
  SourceLike,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import {
  inferSourceFieldCandidates,
  SourceFieldKind,
} from '@/utils/sourceFieldSuggestions';

import { ExpressionValidationStatus } from './ExpressionValidationStatus';
import { FormRow } from './FormRow';
import { SourceFieldCandidateHint } from './SourceFieldCandidateHint';

export function ExpressionFormRow({
  control,
  setValue,
  name,
  label,
  placeholder,
  helpText,
  columns,
  sourceKind,
  source,
}: {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
  name: SourceFieldKind;
  label: string;
  placeholder?: string;
  helpText?: string;
  columns?: ColumnMetaType[];
  sourceKind: SourceKind;
  source: SourceLike;
}) {
  const currentValue = useWatch({ control, name });
  const value = typeof currentValue === 'string' ? currentValue : '';

  const candidates = useMemo(
    () =>
      columns
        ? inferSourceFieldCandidates(columns, name, sourceKind)
        : undefined,
    [columns, name, sourceKind],
  );

  return (
    <FormRow label={label} helpText={helpText}>
      <SQLInlineEditorControlled
        source={source}
        control={control}
        name={name}
        placeholder={placeholder}
      />
      {value.trim() ? (
        <ExpressionValidationStatus expression={value} source={source} />
      ) : (
        <SourceFieldCandidateHint
          candidates={candidates}
          onApply={applied => {
            setValue(name, applied, { shouldDirty: true });
          }}
        />
      )}
    </FormRow>
  );
}
