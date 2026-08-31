import { useCallback, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { isFormulaSourceKind } from '@hyperdx/common-utils/dist/core/utils';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import { IconCirclePlus, IconMathFunction } from '@tabler/icons-react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { ChartSeriesEditor } from '@/components/DBEditTimeChartForm/ChartSeriesEditor';
import {
  ExploreFormulaCard,
  useFormulaLetterInsert,
} from '@/components/Explore/ExploreFormulaCard';
import {
  canAddExploreFormula,
  createEmptyExploreFormula,
  exploreViewSupportsFormulas,
} from '@/components/Search/exploreFormulas';
import {
  canAddExploreSeries,
  createEmptyExploreSeries,
  DEFAULT_AGG_LIMIT,
  type SearchAggConfig,
} from '@/components/Search/SearchAggControls';
import type { SearchView } from '@/components/Search/searchViews';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

export function ExploreSeriesList({
  view,
  config,
  onChange,
  onSubmit,
  defaultGroupBy,
  tableSource,
  dateRange,
}: {
  view: SearchView;
  config: SearchAggConfig;
  onChange: (patch: Partial<SearchAggConfig>) => void;
  onSubmit: () => void;
  defaultGroupBy?: string;
  tableSource?: TSource;
  dateRange?: [Date, Date];
}) {
  const formValues = useMemo(
    () => ({
      series: config.series,
      groupBy: config.groupBy,
      formulas: config.formulas,
      showOperandSeries: config.showOperandSeries,
    }),
    [config.series, config.groupBy, config.formulas, config.showOperandSeries],
  );

  const { control, setValue, getValues, clearErrors, formState } =
    useForm<ChartEditorFormState>({
      values: formValues,
    });

  const { fields, append, remove, insert, swap } = useFieldArray({
    control,
    name: 'series',
  });

  const {
    fields: formulaFields,
    append: appendFormula,
    remove: removeFormula,
  } = useFieldArray({
    control,
    name: 'formulas',
  });

  const commit = useCallback(() => {
    const values = getValues();
    const formulas = values.formulas ?? [];
    onChange({
      series: values.series,
      groupBy: typeof values.groupBy === 'string' ? values.groupBy : '',
      formulas,
      showOperandSeries:
        formulas.length === 0 ? true : (values.showOperandSeries ?? true),
    });
    onSubmit();
  }, [getValues, onChange, onSubmit]);

  const duplicateSeries = useCallback(
    (index: number) => {
      insert(index + 1, {
        ...structuredClone(getValues(`series.${index}`)),
        alias: '',
      });
      queueMicrotask(commit);
    },
    [insert, getValues, commit],
  );

  const removeSeries = useCallback(
    (index: number) => {
      remove(index);
      queueMicrotask(commit);
    },
    [remove, commit],
  );

  const swapSeries = useCallback(
    (from: number, to: number) => {
      swap(from, to);
      queueMicrotask(commit);
    },
    [swap, commit],
  );

  const handleAddSeries = useCallback(() => {
    append(createEmptyExploreSeries());
    queueMicrotask(commit);
  }, [append, commit]);

  const handleAddFormula = useCallback(() => {
    appendFormula(createEmptyExploreFormula());
    queueMicrotask(commit);
  }, [appendFormula, commit]);

  const handleRemoveFormula = useCallback(
    (index: number) => {
      removeFormula(index);
      queueMicrotask(commit);
    },
    [removeFormula, commit],
  );

  const {
    insertIntoFormula,
    handleInsertSeriesRef,
    registerInput,
    onExpressionFocus,
  } = useFormulaLetterInsert({
    getValues,
    setValue,
    commit,
    formulaCount: formulaFields.length,
  });

  const tableConnection = useMemo(
    () => tcFromSource(tableSource),
    [tableSource],
  );
  const databaseName = tableSource?.from.databaseName ?? '';
  const tableName = tableSource?.from.tableName ?? '';

  const hasFormulas = formulaFields.length > 0;
  const canAdd = canAddExploreSeries(view, fields.length, hasFormulas);
  const canAddFormula = canAddExploreFormula(
    view,
    formulaFields.length,
    tableSource?.kind,
  );
  const showSeriesRef =
    exploreViewSupportsFormulas(view) && isFormulaSourceKind(tableSource?.kind);
  const showGroupByOnCard = fields.length === 1 && view !== 'number';
  const showSharedGroupBy = fields.length > 1 && view !== 'number';
  const showLimit =
    view === 'table' || view === 'bar' || view === 'pie' || view === 'treemap';
  const showColor = view === 'table';

  return (
    <Stack gap="xs" w="100%" data-testid="search-agg-controls">
      {fields.map((field, index) => (
        <ChartSeriesEditor
          key={field.id}
          control={control}
          databaseName={databaseName}
          dateRange={dateRange}
          index={index}
          namePrefix={`series.${index}.`}
          onRemoveSeries={removeSeries}
          length={fields.length}
          onSwapSeries={swapSeries}
          onDuplicateSeries={duplicateSeries}
          onSubmit={commit}
          setValue={setValue}
          connectionId={tableSource?.connection}
          showGroupBy={showGroupByOnCard}
          showHaving={false}
          showDuplicate={canAdd}
          showColor={showColor}
          tableName={tableName}
          tableSource={tableSource}
          errors={
            formState.errors.series && Array.isArray(formState.errors.series)
              ? formState.errors.series[index]
              : undefined
          }
          clearErrors={clearErrors}
          eagerSubmit
          groupByPlaceholder={defaultGroupBy || 'SQL columns'}
          showSeriesRef={showSeriesRef}
          onInsertSeriesRef={showSeriesRef ? handleInsertSeriesRef : undefined}
        />
      ))}
      {exploreViewSupportsFormulas(view) &&
        formulaFields.map((field, index) => (
          <ExploreFormulaCard
            key={field.id}
            control={control}
            index={index}
            namePrefix={`formulas.${index}.`}
            seriesCount={fields.length}
            formulaCount={formulaFields.length}
            onRemoveFormula={handleRemoveFormula}
            onSubmit={commit}
            onInsertSeriesRef={letter => insertIntoFormula(index, letter)}
            registerInput={el => registerInput(index, el)}
            onExpressionFocus={() => onExpressionFocus(index)}
            showSeriesToggle={index === 0 && view !== 'number'}
            showOperandSeries={config.showOperandSeries}
            onShowOperandSeriesChange={value => {
              setValue('showOperandSeries', value);
              queueMicrotask(commit);
            }}
          />
        ))}
      {showSharedGroupBy && (
        <Group gap="xs" wrap="nowrap" align="center">
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            Group by
          </Text>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SQLInlineEditorControlled
              tableConnection={tableConnection}
              control={control}
              name="groupBy"
              placeholder={defaultGroupBy || 'SQL columns'}
              disableKeywordAutocomplete
              onSubmit={commit}
            />
          </div>
        </Group>
      )}
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Group gap="xs">
          {canAdd && (
            <Button variant="subtle" size="sm" onClick={handleAddSeries}>
              <IconCirclePlus size={14} className="me-2" />
              Add series
            </Button>
          )}
          {canAddFormula && (
            <Button
              variant="subtle"
              size="sm"
              onClick={handleAddFormula}
              data-testid="add-formula-button"
            >
              <IconMathFunction size={14} className="me-2" />
              Add formula
            </Button>
          )}
        </Group>
        {showLimit && (
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed">
              Top
            </Text>
            <NumberInput
              size="xs"
              w={90}
              min={1}
              max={1000}
              value={config.limit}
              onChange={value => {
                onChange({
                  limit: typeof value === 'number' ? value : DEFAULT_AGG_LIMIT,
                });
                onSubmit();
              }}
            />
          </Group>
        )}
      </Group>
    </Stack>
  );
}
