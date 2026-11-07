import { useMemo } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import {
  inferSourceFieldCandidates,
  SourceFieldKind,
} from '@/utils/sourceFieldSuggestions';

import { ExpressionValidationStatus } from './ExpressionValidationStatus';
import { FormRow } from './FormRow';
import { SourceFieldCandidateHint } from './SourceFieldCandidateHint';

/**
 * Fields where a hard-coded value is never right: it would make every row
 * claim the same trace or span, silently breaking correlation. The other
 * fields can legitimately be pinned to a constant — a single-service table
 * with no ServiceName column, for instance.
 */
const LITERAL_UNSAFE_FIELDS: SourceFieldKind[] = [
  'traceIdExpression',
  'spanIdExpression',
];

export function ExpressionFormRow({
  control,
  setValue,
  name,
  label,
  placeholder,
  helpText,
  columns,
  sourceKind,
  tableConnection,
}: {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
  name: SourceFieldKind;
  label: string;
  placeholder?: string;
  helpText?: string;
  columns?: ColumnMetaType[];
  sourceKind: SourceKind;
  tableConnection: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  };
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
        tableConnection={tableConnection}
        control={control}
        name={name}
        placeholder={placeholder}
      />
      {value.trim() ? (
        <ExpressionValidationStatus
          expression={value}
          tableConnection={tableConnection}
          warnOnLiteral={LITERAL_UNSAFE_FIELDS.includes(name)}
        />
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
