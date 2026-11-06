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
  /** Why the key suggestions failed, shown after the generic error. */
  keysErrorMessage?: string;
  /** Suggestions for the key last reported by `onKeyChange`. */
  valueOptions: string[];
  isLoadingValues?: boolean;
  isValuesError?: boolean;
  /** Why the value suggestions failed, shown after the generic error. */
  valuesErrorMessage?: string;
  /**
   * The key to fetch values for: a suggested key once typing pauses, or any key
   * once committed (Enter, picking it, or leaving the input). Empty while
   * another key is being typed.
   */
  onKeyChange?: (key: string) => void;
  keyLabel?: string;
  keyPlaceholder?: string;
  onSubmit: (condition: FilterCondition<TOperator>) => void;
  'data-testid'?: string;
};

const KEY_DEBOUNCE_MS = 300;
const SUGGESTIONS_ERROR = "Couldn't load suggestions";

// Database errors can run to several lines; the first says what went wrong.
const suggestionsError = (message: string | undefined) => {
  const firstLine = message?.trim().split('\n')[0];
  return firstLine ? `${SUGGESTIONS_ERROR}: ${firstLine}` : SUGGESTIONS_ERROR;
};

/** Pick a key, an operator, and a value. Free text is accepted for both inputs. */
export function FilterConditionEditor<TOperator extends string = string>({
  operators,
  initial,
  keyOptions,
  isLoadingKeys,
  isKeysError,
  keysErrorMessage,
  valueOptions,
  isLoadingValues,
  isValuesError,
  valuesErrorMessage,
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
  const [committedKey, setCommittedKey] = useState(trimmedKey);
  const commitKey = (next: string) => setCommittedKey(next.trim());
  // A partial key names no column, so looking it up would only fail.
  const lookupKey =
    trimmedKey === committedKey ||
    (trimmedKey === debouncedKey && keyOptions.includes(trimmedKey))
      ? trimmedKey
      : '';
  useEffect(() => {
    onKeyChange?.(lookupKey);
  }, [lookupKey, onKeyChange]);

  const isValueLoading = !!lookupKey && !!isLoadingValues;
  const isValuesErrorShown = !!lookupKey && !isValueLoading && !!isValuesError;
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
        error={
          !isLoadingKeys && isKeysError
            ? suggestionsError(keysErrorMessage)
            : undefined
        }
        value={key}
        onChange={setKey}
        onOptionSubmit={commitKey}
        onBlur={() => commitKey(key)}
        // Enter moves on to the value instead of applying an empty-value filter.
        onSubmit={() => {
          commitKey(key);
          valueInputRef.current?.focus();
        }}
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
        error={
          isValuesErrorShown ? suggestionsError(valuesErrorMessage) : undefined
        }
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
