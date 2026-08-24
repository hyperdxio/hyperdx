import { useCallback, useMemo, useRef } from 'react';
import {
  Control,
  Controller,
  UseFormGetValues,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import {
  indexToSeriesRef,
  validateFormula,
} from '@hyperdx/common-utils/dist/core/formula';
import { Badge, Group, Menu, Switch, TextInput, Tooltip } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import {
  SeriesAliasField,
  SeriesCard,
  SeriesCardMenu,
} from '@/components/ChartSeries/SeriesCard';
import { TextInputControlled } from '@/components/InputControlled';
import { getColorFromCSSToken } from '@/utils';

/** Insert a series letter at the current selection, padding with spaces. */
export function insertSeriesRefAtCursor(
  value: string,
  letter: string,
  selectionStart: number,
  selectionEnd: number,
): { next: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const padBefore = before.length > 0 && !/[\s(+\-*/]$/.test(before) ? ' ' : '';
  const padAfter = after.length > 0 && !/^[\s)+\-*/]/.test(after) ? ' ' : '';
  const insertion = `${padBefore}${letter}${padAfter}`;
  return {
    next: `${before}${insertion}${after}`,
    cursor: before.length + insertion.length,
  };
}

export function useFormulaLetterInsert({
  getValues,
  setValue,
  commit,
  formulaCount,
}: {
  getValues: UseFormGetValues<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  commit: () => void;
  formulaCount: number;
}) {
  const expressionInputsRef = useRef<Map<number, HTMLInputElement>>(new Map());
  const focusedFormulaIndexRef = useRef(0);

  const insertIntoFormula = useCallback(
    (formulaIndex: number, letter: string) => {
      const input = expressionInputsRef.current.get(formulaIndex);
      const current = getValues(`formulas.${formulaIndex}.expression`) ?? '';
      const start = input?.selectionStart ?? current.length;
      const end = input?.selectionEnd ?? start;
      const { next, cursor } = insertSeriesRefAtCursor(
        current,
        letter,
        start,
        end,
      );
      setValue(`formulas.${formulaIndex}.expression`, next);
      queueMicrotask(() => {
        commit();
        input?.focus();
        input?.setSelectionRange(cursor, cursor);
      });
    },
    [getValues, setValue, commit],
  );

  const handleInsertSeriesRef = useCallback(
    (letter: string) => {
      if (formulaCount === 0) return;
      insertIntoFormula(
        Math.min(focusedFormulaIndexRef.current, formulaCount - 1),
        letter,
      );
    },
    [formulaCount, insertIntoFormula],
  );

  const registerInput = useCallback(
    (index: number, el: HTMLInputElement | null) => {
      if (el) {
        expressionInputsRef.current.set(index, el);
      } else {
        expressionInputsRef.current.delete(index);
      }
    },
    [],
  );

  const onExpressionFocus = useCallback((index: number) => {
    focusedFormulaIndexRef.current = index;
  }, []);

  return {
    insertIntoFormula,
    handleInsertSeriesRef,
    registerInput,
    onExpressionFocus,
  };
}

export function ExploreFormulaCard({
  control,
  index,
  namePrefix,
  seriesCount,
  formulaCount,
  onRemoveFormula,
  onSubmit,
  onInsertSeriesRef,
  registerInput,
  onExpressionFocus,
  showSeriesToggle,
  showOperandSeries,
  onShowOperandSeriesChange,
}: {
  control: Control<ChartEditorFormState>;
  index: number;
  namePrefix: `formulas.${number}.`;
  seriesCount: number;
  formulaCount: number;
  onRemoveFormula: (index: number) => void;
  onSubmit: () => void;
  onInsertSeriesRef: (letter: string) => void;
  registerInput: (el: HTMLInputElement | null) => void;
  onExpressionFocus: () => void;
  showSeriesToggle: boolean;
  showOperandSeries: boolean;
  onShowOperandSeriesChange: (value: boolean) => void;
}) {
  const expression = useWatch({
    control,
    name: `${namePrefix}expression`,
  });

  const validationError = useMemo(() => {
    if (!expression || expression.trim() === '') {
      return undefined;
    }
    const result = validateFormula(expression, { seriesCount });
    if (result.ok) {
      return undefined;
    }
    return result.errors.map(e => e.message).join('; ');
  }, [expression, seriesCount]);

  const letters = Array.from({ length: Math.min(seriesCount, 26) }, (_, i) =>
    indexToSeriesRef(i),
  ).filter((letter): letter is string => letter != null);

  return (
    <SeriesCard
      index={index}
      title={formulaCount > 1 ? `Formula ${index + 1}` : 'Formula'}
      color={getColorFromCSSToken('chart-cyan')}
      testId="formula-card"
      aliasSlot={
        <SeriesAliasField>
          <div style={{ width: 140 }}>
            <TextInputControlled
              name={`${namePrefix}alias`}
              control={control}
              placeholder="Alias"
              onBlur={() => onSubmit()}
              size="xs"
              data-testid="formula-alias-input"
            />
          </div>
        </SeriesAliasField>
      }
      menu={
        <SeriesCardMenu ariaLabel="Formula actions">
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => onRemoveFormula(index)}
            data-testid="formula-remove-button"
          >
            Remove formula
          </Menu.Item>
        </SeriesCardMenu>
      }
    >
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Controller
            control={control}
            name={`${namePrefix}expression`}
            render={({ field, fieldState: { error } }) => (
              <TextInput
                {...field}
                ref={el => {
                  field.ref(el);
                  registerInput(el);
                }}
                value={field.value ?? ''}
                size="sm"
                placeholder="A / B"
                error={validationError ?? error?.message}
                styles={{
                  input: {
                    fontFamily: 'var(--mantine-font-family-monospace)',
                  },
                }}
                onFocus={() => onExpressionFocus()}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onSubmit();
                  }
                }}
                onBlur={() => {
                  field.onBlur();
                  onSubmit();
                }}
                data-testid="formula-expression-input"
              />
            )}
          />
        </div>
        {letters.length > 0 && (
          <Group gap={4} wrap="wrap" pt={4}>
            {letters.map(letter => (
              <Tooltip key={letter} label="Insert in formula">
                <Badge
                  size="sm"
                  radius="sm"
                  variant="light"
                  color="gray"
                  component="button"
                  type="button"
                  data-testid="formula-series-chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onInsertSeriesRef(letter)}
                >
                  {letter}
                </Badge>
              </Tooltip>
            ))}
          </Group>
        )}
      </Group>
      {showSeriesToggle && (
        <Switch
          mt="xs"
          label="Show series"
          size="xs"
          checked={showOperandSeries}
          onChange={event =>
            onShowOperandSeriesChange(event.currentTarget.checked)
          }
          data-testid="show-series-switch"
        />
      )}
    </SeriesCard>
  );
}
