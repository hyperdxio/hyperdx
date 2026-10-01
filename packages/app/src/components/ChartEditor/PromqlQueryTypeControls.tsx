import { Control, useController } from 'react-hook-form';
import {
  DEFAULT_PROMQL_QUERY_TYPE,
  DEFAULT_PROMQL_REDUCER,
} from '@hyperdx/common-utils/dist/core/promql';
import { PromqlReducer } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Collapse,
  Group,
  SegmentedControl,
  Select,
  Text,
} from '@mantine/core';

import { ChartEditorFormState } from './types';

const REDUCER_OPTIONS: { value: PromqlReducer; label: string }[] = [
  { value: PromqlReducer.LastNotNull, label: 'Last' },
  { value: PromqlReducer.Min, label: 'Min' },
  { value: PromqlReducer.Max, label: 'Max' },
  { value: PromqlReducer.Mean, label: 'Mean' },
  { value: PromqlReducer.Sum, label: 'Sum' },
  { value: PromqlReducer.Count, label: 'Count' },
];

export default function PromqlQueryTypeControls({
  control,
  index,
  isReducerSupported,
  isOpen,
  onToggle,
  onSubmit,
}: {
  control: Control<ChartEditorFormState>;
  index: number;
  isReducerSupported: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSubmit: (suppressErrorNotification?: boolean) => void;
}) {
  const { field: queryType } = useController({
    control,
    name: `promqlExpressions.${index}.queryType`,
  });
  const { field: reducer } = useController({
    control,
    name: `promqlExpressions.${index}.reducer`,
  });
  const queryTypeValue = queryType.value ?? DEFAULT_PROMQL_QUERY_TYPE;
  const isRange = queryTypeValue === 'range';
  const showReducer = isRange && isReducerSupported;
  const reducerValue = reducer.value ?? DEFAULT_PROMQL_REDUCER;
  const reducerLabel = REDUCER_OPTIONS.find(
    o => o.value === reducerValue,
  )?.label;
  const summary = isRange
    ? `Settings: Range${showReducer ? ` / ${reducerLabel}` : ''}`
    : 'Settings: Instant';

  return (
    <>
      <Collapse expanded={isOpen}>
        <Group gap="xs" wrap="nowrap" align="center" mt={4}>
          <SegmentedControl
            size="xs"
            data={[
              { value: 'instant', label: 'Instant' },
              { value: 'range', label: 'Range' },
            ]}
            value={queryTypeValue}
            onChange={next => {
              queryType.onChange(next);
              onSubmit();
            }}
            data-testid={`promql-query-type-input-${index}`}
          />
          {showReducer && (
            <>
              <Text size="xxs" c="dimmed">
                Reduced to
              </Text>
              <Select
                size="xs"
                w={110}
                data={REDUCER_OPTIONS}
                value={reducerValue}
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
                aria-label="PromQL range reducer"
                onChange={next => {
                  if (next == null) return;
                  reducer.onChange(next);
                  onSubmit();
                }}
              />
            </>
          )}
        </Group>
      </Collapse>
      <Anchor
        component="button"
        type="button"
        size="xxs"
        onClick={onToggle}
        mt={4}
        display="block"
        data-testid={`promql-query-type-control-${index}`}
      >
        {isOpen ? 'Hide' : summary}
      </Anchor>
    </>
  );
}
