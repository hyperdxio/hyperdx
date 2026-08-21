import { useMemo } from 'react';
import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { validateFormula } from '@hyperdx/common-utils/dist/core/formula';
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconTrash } from '@tabler/icons-react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { TextInputControlled } from '@/components/InputControlled';
import { FORMAT_ICONS } from '@/components/NumberFormat';
import SeriesNumberFormatDrawer from '@/components/SeriesNumberFormatDrawer';

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
      <Divider
        label={
          <Group gap="xs">
            <Badge size="sm" radius="sm" variant="light" color="teal">
              Formula
            </Badge>
            <Text size="xxs">Alias</Text>
            <div style={{ width: 150 }}>
              <TextInputControlled
                name={`${namePrefix}alias`}
                control={control}
                placeholder="Formula alias"
                onChange={() => onSubmit()}
                size="xs"
                data-testid="formula-alias-input"
              />
            </div>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => onRemoveFormula(index)}
              data-testid="formula-remove-button"
            >
              <IconTrash size={14} className="me-2" />
              Remove Formula
            </Button>
            <Tooltip label="Edit formula display format">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="xs"
                onClick={openNumberFormat}
                aria-label="Edit formula display format"
              >
                {FORMAT_ICONS[numberFormat?.output ?? 'number']}
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="right"
        mb={8}
        mt="sm"
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
