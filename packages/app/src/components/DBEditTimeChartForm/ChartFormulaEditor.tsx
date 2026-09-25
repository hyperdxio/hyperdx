import { useMemo } from 'react';
import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { validateFormula } from '@hyperdx/common-utils/dist/core/formula';
import { Badge, TextInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { ChartSeriesControls } from '@/components/ChartEditor/ChartSeriesControls';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import SeriesNumberFormatDrawer from '@/components/SeriesNumberFormatDrawer';
import { isImeCompositionKey } from '@/utils/ime';

type ChartFormulaEditorProps = {
  control: Control<ChartEditorFormState>;
  index: number;
  namePrefix: `formulas.${number}.`;
  onRemoveFormula: (index: number) => void;
  onSubmit: () => void;
  setValue: UseFormSetValue<ChartEditorFormState>;
};

/**
 * Editor row for one metric formula (HDX-5080): a derived series computed
 * from the chart's `select` entries via a letter-ref arithmetic expression
 * (`A` = series 1, `B` = series 2, ...). See `core/formula.ts` in
 * common-utils for the grammar; expressions are validated inline with the
 * same structured validator the query renderer uses, so errors surface here
 * before they can reach ClickHouse.
 */
export function ChartFormulaEditor({
  control,
  index,
  namePrefix,
  onRemoveFormula,
  onSubmit,
  setValue,
}: ChartFormulaEditorProps) {
  const series = useWatch({ control, name: 'series' });
  const seriesCount = Array.isArray(series) ? series.length : 0;

  const expression = useWatch({
    control,
    name: `${namePrefix}expression`,
  });

  // Live structured validation (unknown refs, malformed expressions, ...).
  // An empty expression is not flagged red while the user is still composing
  // the row — the save-time validation in validateChartForm catches it.
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

  const numberFormat = useWatch({
    control,
    name: `${namePrefix}numberFormat`,
  });

  const [
    isNumberFormatOpen,
    { open: openNumberFormat, close: closeNumberFormat },
  ] = useDisclosure(false);

  return (
    <>
      <ChartSeriesControls
        control={control}
        aliasName={`${namePrefix}alias`}
        aliasPlaceholder="Formula alias"
        index={index}
        numberFormat={numberFormat}
        onSubmit={onSubmit}
        onRemove={onRemoveFormula}
        onOpenNumberFormat={openNumberFormat}
        leadingSection={
          <Badge size="sm" radius="sm" variant="light" color="teal">
            Formula
          </Badge>
        }
      />
      <Controller
        control={control}
        name={`${namePrefix}expression`}
        render={({ field, fieldState: { error } }) => (
          <TextInput
            {...field}
            value={field.value ?? ''}
            size="sm"
            placeholder="A / (A + B) * 100"
            error={validationError ?? error?.message}
            description={
              validationError == null && !error
                ? 'Arithmetic over series letters (A = series 1, B = series 2, ...)'
                : undefined
            }
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            styles={{
              input: { fontFamily: 'var(--mantine-font-family-monospace)' },
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !isImeCompositionKey(e)) {
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
      <SeriesNumberFormatDrawer
        opened={isNumberFormatOpen}
        numberFormat={numberFormat}
        onChange={format => {
          setValue(`${namePrefix}numberFormat`, format.numberFormat);
          onSubmit();
        }}
        onClose={closeNumberFormat}
      />
    </>
  );
}
