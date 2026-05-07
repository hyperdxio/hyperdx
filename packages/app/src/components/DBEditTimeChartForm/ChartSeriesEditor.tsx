import { useMemo } from 'react';
import {
  Control,
  FieldErrors,
  UseFormClearErrors,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { DateRange, TSource } from '@berg/common-utils/dist/types';
import { Button, Divider, Flex, Group, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';

import { AGG_FNS } from '@/ChartUtils';
import { AggFnSelectControlled } from '@/components/AggFnSelect';
import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import { TextInputControlled } from '@/components/InputControlled';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

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
  connectionId,
  index,
  namePrefix,
  onRemoveSeries,
  onSwapSeries,
  onSubmit,
  setValue: _setValue,
  showGroupBy,
  showHaving,
  tableName: _tableName,
  parentRef,
  length,
  tableSource: _tableSource,
  errors: _errors,
  clearErrors: _clearErrors,
}: ChartSeriesEditorProps) {
  const aggFn = useWatch({ control, name: `${namePrefix}aggFn` });
  void useWatch({
    control,
    name: `${namePrefix}aggConditionLanguage`,
    defaultValue: 'lucene',
  });

  const tableName = _tableName;

  const showWhere = aggFn !== 'none';

  const tableConnection = useMemo(
    () => ({
      databaseName,
      tableName: tableName ?? '',
      connectionId: connectionId ?? '',
    }),
    [databaseName, tableName, connectionId],
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
        {aggFn !== 'count' && (
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
    </>
  );
}
