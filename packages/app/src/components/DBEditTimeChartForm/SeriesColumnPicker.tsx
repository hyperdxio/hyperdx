import { useCallback } from 'react';
import { Control, useController } from 'react-hook-form';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { type Field } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Popover } from '@mantine/core';

import { FieldPicker, FieldPickerTarget } from '@/components/FieldPicker';

/**
 * Aggregations the renderer wraps in `toFloat64OrDefault(toString(…))`.
 *
 * Worth filtering the list down for rather than leaving to the user: that
 * wrapper turns a non-numeric column into 0 instead of failing, so offering
 * `ServiceName` under "Average" buys a chart of zeroes with nothing to say it
 * went wrong. `count_distinct` and `any` pass the column through untouched and
 * are happy with any type.
 */
const NUMERIC_ONLY_AGG_FNS = new Set([
  'sum',
  'avg',
  'min',
  'max',
  'quantile',
  'increase',
]);

const isNumeric = (field: Field) => field.jsType === JSDataType.Number;

/**
 * The column an aggregation reduces over — "99th Percentile **of Duration**".
 *
 * A list rather than the SQL box it replaces, which asked for "SQL column" and
 * left you to know both the schema and the bracket syntax for a map key. The
 * SQL tab is still there for the expressions a list cannot hold, like
 * `Duration / 1e6`.
 */
export function SeriesColumnPicker({
  control,
  name,
  aggFn,
  tableSource,
  dateRange,
  onSubmit,
}: {
  control: Control<any>;
  name: string;
  aggFn?: string;
  tableSource?: TSource;
  dateRange?: [Date, Date];
  onSubmit?: () => void;
}) {
  const {
    field: { value, onChange },
  } = useController({ control, name });

  const numericOnly = NUMERIC_ONLY_AGG_FNS.has(aggFn ?? '');

  const apply = useCallback(
    (fields: string[]) => {
      onChange(fields[0] ?? '');
      onSubmit?.();
    },
    [onChange, onSubmit],
  );

  const selected: string = value ?? '';

  return (
    <FieldPicker
      tableSource={tableSource}
      dateRange={dateRange}
      selection="single"
      selected={selected ? [selected] : []}
      onApply={apply}
      filterField={numericOnly ? isNumeric : undefined}
      emptyLabel={numericOnly ? 'No numeric fields found' : 'No fields found'}
      hint={
        numericOnly
          ? 'Numeric fields only. Use SQL for an expression.'
          : undefined
      }
      sqlPlaceholder="Column or expression"
      sqlSize="xs"
      enableVariables
      width={{ fields: 320, sql: 460 }}
      trigger={({ toggle }) => (
        <Popover.Target>
          <FieldPickerTarget
            label="of"
            tall
            value={selected || 'select field'}
            muted={!selected}
            onClick={toggle}
            aria-label={
              selected
                ? `Aggregate of ${selected}`
                : 'Select a field to aggregate'
            }
            containerTestId="series-value-expression"
            data-testid="series-value-expression-target"
          />
        </Popover.Target>
      )}
    />
  );
}
