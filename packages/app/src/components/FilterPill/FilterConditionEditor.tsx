import { useEffect, useRef, useState } from 'react';
import { Button, Group, Select, Stack } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import { FilterAutocomplete } from './FilterAutocomplete';

export type FilterOperatorOption<TOperator extends string = string> = {
  value: TOperator;
  /** Shown in the operator select and on the pill, e.g. `regex` for `=~`. */
  label: string;
  /** Conditions using this operator get the pill's excluded accent. */
  negated?: boolean;
  valueLabel?: string;
  valuePlaceholder?: string;
};

export type FilterCondition<TOperator extends string = string> = {
  key: string;
  operator: TOperator;
  value: string;
};

export type FilterConditionEditorProps<TOperator extends string = string> = {
  operators: FilterOperatorOption<TOperator>[];
  /** The condition being edited; unset when adding one. */
  initial?: FilterCondition<TOperator>;
  keyOptions: string[];
  isLoadingKeys?: boolean;
  isKeysError?: boolean;
  /** Suggestions for the key last reported by `onKeyChange`. */
  valueOptions: string[];
  isLoadingValues?: boolean;
  isValuesError?: boolean;
  /** The trimmed key, once typing pauses, so the caller can fetch its values. */
  onKeyChange?: (key: string) => void;
  keyLabel?: string;
  keyPlaceholder?: string;
  onSubmit: (condition: FilterCondition<TOperator>) => void;
  'data-testid'?: string;
};

const KEY_DEBOUNCE_MS = 300;
const SUGGESTIONS_ERROR = "Couldn't load suggestions";

/** Pick a key, an operator, and a value. Free text is accepted for both inputs. */
export function FilterConditionEditor<TOperator extends string = string>({
  operators,
  initial,
  keyOptions,
  isLoadingKeys,
  isKeysError,
  valueOptions,
  isLoadingValues,
  isValuesError,
  onKeyChange,
  keyLabel = 'Key',
  keyPlaceholder = 'Select a key',
  onSubmit,
  'data-testid': testId = 'filter-condition-editor',
}: FilterConditionEditorProps<TOperator>) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [operator, setOperator] = useState<TOperator | undefined>(
    initial?.operator ?? operators[0]?.value,
  );
  const [value, setValue] = useState(initial?.value ?? '');
  const valueInputRef = useRef<HTMLInputElement>(null);

  const trimmedKey = key.trim();
  const [debouncedKey] = useDebouncedValue(trimmedKey, KEY_DEBOUNCE_MS);
  useEffect(() => {
    onKeyChange?.(debouncedKey);
  }, [debouncedKey, onKeyChange]);

  // Values shown while the key is still settling belong to the previous key.
  const isValueLoading =
    !!trimmedKey && (!!isLoadingValues || debouncedKey !== trimmedKey);
  const isValuesErrorShown = !!trimmedKey && !isValueLoading && !!isValuesError;
  const selectedOperator = operators.find(op => op.value === operator);
  const canSubmit = !!trimmedKey && operator != null;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ key: trimmedKey, operator, value });
  };

  return (
    <Stack gap="xs" w={320} data-testid={testId}>
      <FilterAutocomplete
        label={keyLabel}
        placeholder={keyPlaceholder}
        options={keyOptions}
        isLoading={isLoadingKeys}
        error={!isLoadingKeys && isKeysError ? SUGGESTIONS_ERROR : undefined}
        value={key}
        onChange={setKey}
        // Enter moves on to the value instead of applying an empty-value filter.
        onSubmit={() => valueInputRef.current?.focus()}
        data-testid={`${testId}-key`}
      />
      <Select<TOperator>
        size="xs"
        label="Operator"
        data={operators.map(op => ({ value: op.value, label: op.label }))}
        value={operator ?? null}
        onChange={next => next != null && setOperator(next)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: false }}
        data-testid={`${testId}-operator`}
      />
      <FilterAutocomplete
        label={selectedOperator?.valueLabel ?? 'Value'}
        placeholder={selectedOperator?.valuePlaceholder ?? 'Select a value'}
        options={valueOptions}
        isLoading={isValueLoading}
        error={isValuesErrorShown ? SUGGESTIONS_ERROR : undefined}
        value={value}
        onChange={setValue}
        onSubmit={submit}
        ref={valueInputRef}
        data-testid={`${testId}-value`}
      />
      <Group justify="flex-end" gap="xs">
        <Button
          size="xs"
          variant="primary"
          onClick={submit}
          disabled={!canSubmit}
          data-testid={`${testId}-apply`}
        >
          Apply
        </Button>
      </Group>
    </Stack>
  );
}
