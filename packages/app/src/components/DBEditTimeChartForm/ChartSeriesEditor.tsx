import { useCallback, useEffect, useMemo } from 'react';
import {
  Control,
  FieldErrors,
  UseFormClearErrors,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import {
  DateRange,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Flex, Group, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';

import { AGG_FNS } from '@/ChartUtils';
import { AggFnSelectControlled } from '@/components/AggFnSelect';
import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import {
  CheckBoxControlled,
  TextInputControlled,
} from '@/components/InputControlled';
import { MetricAttributeHelperPanel } from '@/components/MetricAttributeHelperPanel';
import { MetricNameSelect } from '@/components/MetricNameSelect';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useFetchMetricMetadata } from '@/hooks/useFetchMetricMetadata';
import {
  parseAttributeKeysFromSuggestions,
  useFetchMetricResourceAttrs,
} from '@/hooks/useFetchMetricResourceAttrs';
import { getMetricTableName } from '@/utils';

type SeriesItem = NonNullable<
  SavedChartConfigWithSelectArray['select']
>[number];

type ChartSeriesEditorProps = {
  control: Control<ChartEditorFormState>;
  databaseName: string;
  dateRange?: DateRange['dateRange'];
  connectionId?: string;
  index: number;
  namePrefix: `series.${number}.`;
  parentRef?: HTMLElement | null;
  onRemoveSeries: (index: number) => void;
  onSwapSeries: (from: number, to: number) => void;
  onSubmit: () => void;
  setValue: UseFormSetValue<ChartEditorFormState>;
  showGroupBy: boolean;
  showHaving: boolean;
  tableName: string;
  length: number;
  tableSource?: TSource;
  errors?: FieldErrors<SeriesItem>;
  clearErrors: UseFormClearErrors<ChartEditorFormState>;
};

export function ChartSeriesEditor({
  control,
  databaseName,
  dateRange,
  connectionId,
  index,
  namePrefix,
  onRemoveSeries,
  onSwapSeries,
  onSubmit,
  setValue,
  showGroupBy,
  showHaving,
  tableName: _tableName,
  parentRef,
  length,
  tableSource,
  errors,
  clearErrors,
}: ChartSeriesEditorProps) {
  const aggFn = useWatch({ control, name: `${namePrefix}aggFn` });
  const aggConditionLanguage = useWatch({
    control,
    name: `${namePrefix}aggConditionLanguage`,
    defaultValue: 'lucene',
  });

  const metricType = useWatch({ control, name: `${namePrefix}metricType` });

  // Initialize metricType to 'gauge' when switching to a metric source
  useEffect(() => {
    if (tableSource?.kind === SourceKind.Metric && !metricType) {
      setValue(`${namePrefix}metricType`, MetricsDataType.Gauge);
    }
  }, [tableSource?.kind, metricType, namePrefix, setValue]);

  const tableName =
    tableSource?.kind === SourceKind.Metric
      ? getMetricTableName(tableSource, metricType)
      : _tableName;

  const metricName = useWatch({ control, name: `${namePrefix}metricName` });
  const aggCondition = useWatch({
    control,
    name: `${namePrefix}aggCondition`,
  });
  const groupBy = useWatch({ control, name: 'groupBy' });

  const metricTableSource =
    tableSource?.kind === SourceKind.Metric ? tableSource : undefined;

  const { data: attributeSuggestions, isLoading: isLoadingAttributes } =
    useFetchMetricResourceAttrs({
      databaseName,
      metricType,
      metricName,
      tableSource: metricTableSource,
      isSql: aggConditionLanguage === 'sql',
    });

  const attributeKeys = useMemo(
    () => parseAttributeKeysFromSuggestions(attributeSuggestions ?? []),
    [attributeSuggestions],
  );

  const { data: metricMetadata } = useFetchMetricMetadata({
    databaseName,
    metricType,
    metricName,
    tableSource: metricTableSource,
  });

  const handleAddToWhere = useCallback(
    (clause: string) => {
      const currentValue = aggCondition || '';

      const newValue = currentValue ? `${currentValue} AND ${clause}` : clause;
      setValue(`${namePrefix}aggCondition`, newValue);
      onSubmit();
    },
    [aggCondition, namePrefix, setValue, onSubmit],
  );

  const handleAddToGroupBy = useCallback(
    (clause: string) => {
      const currentValue = groupBy || '';
      const newValue = currentValue ? `${currentValue}, ${clause}` : clause;
      setValue('groupBy', newValue);
      onSubmit();
    },
    [groupBy, setValue, onSubmit],
  );

  const showWhere = aggFn !== 'none';

  const tableConnection = useMemo(
    () => ({
      databaseName,
      tableName: tableName ?? '',
      connectionId: connectionId ?? '',
      metricName:
        tableSource?.kind === SourceKind.Metric ? metricName : undefined,
    }),
    [databaseName, tableName, connectionId, metricName, tableSource],
  );

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="xxs">Alias</Text>

            <div style={{ width: 150 }}>
              <TextInputControlled
                name={`${namePrefix}alias`}
                control={control}
                placeholder="Series alias"
                onChange={() => onSubmit()}
                size="xs"
                data-testid="series-alias-input"
              />
            </div>
            {(index ?? -1) > 0 && (
              <Button
                variant="subtle"
                color="gray"
                size="xxs"
                onClick={() => onSwapSeries(index, index - 1)}
                title="Move up"
              >
                <IconArrowUp size={14} />
              </Button>
            )}
            {(index ?? -1) < length - 1 && (
              <Button
                variant="subtle"
                color="gray"
                size="xxs"
                onClick={() => onSwapSeries(index, index + 1)}
                title="Move down"
              >
                <IconArrowDown size={14} />
              </Button>
            )}
            {((index ?? -1) > 0 || length > 1) && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                onClick={() => onRemoveSeries(index)}
              >
                <IconTrash size={14} className="me-2" />
                Remove Series
              </Button>
            )}
          </Group>
        }
        labelPosition="right"
        mb={8}
        mt="sm"
      />
      <Flex gap="sm" mt="xs" align="start">
        <div
          style={{
            minWidth: 200,
          }}
        >
          <AggFnSelectControlled
            aggFnName={`${namePrefix}aggFn`}
            quantileLevelName={`${namePrefix}level`}
            defaultValue={AGG_FNS[0]?.value ?? 'avg'}
            control={control}
          />
        </div>
        {tableSource?.kind === SourceKind.Metric && metricType && (
          <div style={{ minWidth: 220 }}>
            <MetricNameSelect
              metricName={metricName}
              dateRange={dateRange}
              metricType={metricType}
              setMetricName={value => {
                setValue(`${namePrefix}metricName`, value);
                setValue(`${namePrefix}valueExpression`, 'Value');
              }}
              setMetricType={value =>
                setValue(`${namePrefix}metricType`, value)
              }
              metricSource={tableSource}
              data-testid="metric-name-selector"
              error={errors?.metricName?.message}
              onFocus={() => clearErrors(`${namePrefix}metricName`)}
            />
            {metricType === 'gauge' && (
              <Flex justify="end">
                <CheckBoxControlled
                  control={control}
                  name={`${namePrefix}isDelta`}
                  label="Delta"
                  size="xs"
                  className="mt-2"
                />
              </Flex>
            )}
          </div>
        )}
        {tableSource?.kind !== SourceKind.Metric && aggFn !== 'count' && (
          <div
            style={{
              minWidth: 220,
              ...(aggFn === 'none' && { flexGrow: 2 }),
            }}
          >
            <SQLInlineEditorControlled
              tableConnection={tableConnection}
              control={control}
              name={`${namePrefix}valueExpression`}
              placeholder="SQL Column"
              onSubmit={onSubmit}
            />
          </div>
        )}
        {(showWhere || showGroupBy || showHaving) && (
          <div
            className="flex-grow-1 gap-2 align-items-center"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto 1fr',
            }}
          >
            {showWhere && (
              <>
                <Text size="sm">Where</Text>
                <div
                  style={{
                    gridColumn:
                      showHaving === showGroupBy ? 'span 3' : undefined,
                  }}
                >
                  <SearchWhereInput
                    tableConnection={tableConnection}
                    control={control}
                    name={`${namePrefix}aggCondition`}
                    onSubmit={onSubmit}
                    showLabel={false}
                    additionalSuggestions={attributeSuggestions}
                  />
                </div>
              </>
            )}
            {showGroupBy && (
              <>
                <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                  Group By
                </Text>
                <div
                  style={{
                    minWidth: 200,
                    maxWidth: '100%',
                    gridColumn:
                      !showHaving && !showWhere ? 'span 3' : undefined,
                  }}
                >
                  <SQLInlineEditorControlled
                    parentRef={parentRef}
                    tableConnection={tableConnection}
                    control={control}
                    name={`groupBy`}
                    placeholder="SQL Columns"
                    disableKeywordAutocomplete
                    onSubmit={onSubmit}
                  />
                </div>
                {showHaving && (
                  <>
                    <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                      Having
                    </Text>
                    <div style={{ minWidth: 300, maxWidth: '100%' }}>
                      <SQLInlineEditorControlled
                        tableConnection={tableConnection}
                        control={control}
                        name="having"
                        placeholder="SQL HAVING clause (ex. count() > 100)"
                        disableKeywordAutocomplete
                        onSubmit={onSubmit}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Flex>
      {tableSource?.kind === SourceKind.Metric && metricName && metricType && (
        <MetricAttributeHelperPanel
          databaseName={databaseName}
          metricType={metricType}
          metricName={metricName}
          tableSource={tableSource}
          attributeKeys={attributeKeys}
          isLoading={isLoadingAttributes}
          language={aggConditionLanguage === 'sql' ? 'sql' : 'lucene'}
          metricMetadata={metricMetadata}
          onAddToWhere={handleAddToWhere}
          onAddToGroupBy={handleAddToGroupBy}
        />
      )}
    </>
  );
}
