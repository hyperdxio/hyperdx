import {
  Control,
  FieldArrayWithId,
  FieldErrors,
  UseFormClearErrors,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { NativeSelect, NumberInput } from 'react-hook-form-mantine';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptTimestamp,
  DisplayType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { IconBell, IconCirclePlus } from '@tabler/icons-react';

import { AlertChannelForm } from '@/components/Alerts';
import { AlertScheduleFields } from '@/components/AlertScheduleFields';
import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import SourceSchemaPreview from '@/components/SourceSchemaPreview';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { IS_LOCAL_MODE } from '@/config';
import { optionsToSelectData } from '@/utils';
import {
  ALERT_CHANNEL_OPTIONS,
  DEFAULT_TILE_ALERT,
  intervalToMinutes,
  TILE_ALERT_INTERVAL_OPTIONS,
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

import { ChartSeriesEditor } from './ChartSeriesEditor';

type ChartEditorControlsProps = {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  clearErrors: UseFormClearErrors<ChartEditorFormState>;
  errors: FieldErrors<ChartEditorFormState>;
  fields: FieldArrayWithId<ChartEditorFormState, 'series', 'id'>[];
  append: (value: SavedChartConfigWithSelectArray['select'][number]) => void;
  removeSeries: (index: number) => void;
  swapSeries: (from: number, to: number) => void;
  tableSource?: TSource;
  tableConnection: TableConnection;
  databaseName?: string;
  tableName?: string;
  dateRange: [Date, Date];
  select: ChartEditorFormState['select'];
  displayType: DisplayType;
  activeTab: string;
  seriesReturnType: ChartEditorFormState['seriesReturnType'];
  alert: ChartEditorFormState['alert'];
  isRawSqlInput: boolean;
  dashboardId?: string;
  parentRef: HTMLElement | null;
  chartConfigForExplanations?: ChartConfigWithOptTimestamp;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  openDisplaySettings: () => void;
};

export function ChartEditorControls({
  control,
  setValue,
  clearErrors,
  errors,
  fields,
  append,
  removeSeries,
  swapSeries,
  tableSource,
  tableConnection,
  databaseName,
  tableName,
  dateRange,
  select,
  displayType,
  activeTab,
  seriesReturnType,
  alert,
  isRawSqlInput,
  dashboardId,
  parentRef,
  chartConfigForExplanations,
  onSubmit,
  openDisplaySettings,
}: ChartEditorControlsProps) {
  const alertChannelType = useWatch({ control, name: 'alert.channel.type' });
  const alertScheduleOffsetMinutes = useWatch({
    control,
    name: 'alert.scheduleOffsetMinutes',
  });
  const maxAlertScheduleOffsetMinutes = alert?.interval
    ? Math.max(intervalToMinutes(alert.interval) - 1, 0)
    : 0;
  const alertIntervalLabel = alert?.interval
    ? TILE_ALERT_INTERVAL_OPTIONS[alert.interval]
    : undefined;

  return (
    <>
      <Flex mb="md" align="center" justify="space-between">
        <Group>
          <Text pe="md" size="sm">
            Data Source
          </Text>
          <SourceSelectControlled
            size="xs"
            control={control}
            name="source"
            data-testid="source-selector"
            sourceSchemaPreview={
              <SourceSchemaPreview source={tableSource} variant="text" />
            }
          />
        </Group>
        <Group>
          {tableSource &&
            activeTab !== 'search' &&
            chartConfigForExplanations &&
            isBuilderChartConfig(chartConfigForExplanations) && (
              <MVOptimizationIndicator
                source={tableSource}
                config={chartConfigForExplanations}
              />
            )}
        </Group>
      </Flex>
      {displayType !== DisplayType.Search && Array.isArray(select) ? (
        <>
          {fields.map((field, index) => (
            <ChartSeriesEditor
              control={control}
              databaseName={databaseName ?? ''}
              dateRange={dateRange}
              index={index}
              key={field.id}
              parentRef={parentRef}
              namePrefix={`series.${index}.`}
              onRemoveSeries={removeSeries}
              length={fields.length}
              onSwapSeries={swapSeries}
              onSubmit={onSubmit}
              setValue={setValue}
              connectionId={tableSource?.connection}
              showGroupBy={
                fields.length === 1 && displayType !== DisplayType.Number
              }
              showHaving={
                fields.length === 1 && displayType === DisplayType.Table
              }
              tableName={tableName ?? ''}
              tableSource={tableSource}
              errors={
                errors.series && Array.isArray(errors.series)
                  ? errors.series[index]
                  : undefined
              }
              clearErrors={clearErrors}
            />
          ))}
          {fields.length > 1 && displayType !== DisplayType.Number && (
            <>
              <Divider mt="md" mb="sm" />
              <div
                className="gap-2 align-items-center"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr)',
                }}
              >
                <div>
                  <Text
                    me="sm"
                    size="sm"
                    style={{
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Group By
                  </Text>
                </div>
                <div>
                  <SQLInlineEditorControlled
                    tableConnection={tableConnection}
                    control={control}
                    name={`groupBy`}
                    placeholder="SQL Columns"
                    onSubmit={onSubmit}
                    disableKeywordAutocomplete
                  />
                </div>
                {displayType === DisplayType.Table && (
                  <>
                    <div>
                      <Text
                        me="sm"
                        size="sm"
                        style={{
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Having
                      </Text>
                    </div>
                    <div>
                      <SQLInlineEditorControlled
                        tableConnection={tableConnection}
                        control={control}
                        name="having"
                        placeholder="SQL HAVING clause (ex. count() > 100)"
                        onSubmit={onSubmit}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          <Divider mt="md" mb="sm" />
          <Flex mt={4} align="center" justify="space-between">
            <Group gap="xs">
              {displayType !== DisplayType.Number &&
                displayType !== DisplayType.Pie && (
                  <Button
                    variant="subtle"
                    size="sm"
                    color="gray"
                    onClick={() => {
                      append({
                        aggFn: 'count',
                        aggCondition: '',
                        aggConditionLanguage: 'lucene',
                        valueExpression: '',
                      });
                    }}
                  >
                    <IconCirclePlus size={14} className="me-2" />
                    Add Series
                  </Button>
                )}
              {fields.length == 2 && displayType !== DisplayType.Number && (
                <Switch
                  label="As Ratio"
                  size="sm"
                  color="gray"
                  variant="subtle"
                  onClick={() => {
                    setValue(
                      'seriesReturnType',
                      seriesReturnType === 'ratio' ? 'column' : 'ratio',
                    );
                    onSubmit();
                  }}
                  checked={seriesReturnType === 'ratio'}
                />
              )}
              {(displayType === DisplayType.Line ||
                displayType === DisplayType.Number) &&
                dashboardId &&
                !IS_LOCAL_MODE && (
                  <Button
                    variant="subtle"
                    data-testid="alert-button"
                    size="sm"
                    color={alert ? 'red' : 'gray'}
                    onClick={() =>
                      setValue('alert', alert ? undefined : DEFAULT_TILE_ALERT)
                    }
                  >
                    <IconBell size={14} className="me-2" />
                    {!alert ? 'Add Alert' : 'Remove Alert'}
                  </Button>
                )}
            </Group>
            <Button
              onClick={openDisplaySettings}
              size="compact-sm"
              variant="secondary"
            >
              Display Settings
            </Button>
          </Flex>
        </>
      ) : (
        <Flex gap="xs" direction="column">
          <SQLInlineEditorControlled
            tableConnection={tableConnection}
            control={control}
            name="select"
            placeholder={
              ((tableSource?.kind === SourceKind.Log ||
                tableSource?.kind === SourceKind.Trace) &&
                tableSource.defaultTableSelectExpression) ||
              'SELECT Columns'
            }
            defaultValue={
              tableSource?.kind === SourceKind.Log ||
              tableSource?.kind === SourceKind.Trace
                ? tableSource.defaultTableSelectExpression
                : undefined
            }
            onSubmit={onSubmit}
            label="SELECT"
          />
          <SearchWhereInput
            tableConnection={tableConnection}
            control={control}
            name="where"
            onSubmit={onSubmit}
            onLanguageChange={(lang: 'sql' | 'lucene') =>
              setValue('whereLanguage', lang)
            }
            showLabel={false}
          />
        </Flex>
      )}
      {alert && !isRawSqlInput && (
        <Paper my="sm">
          <Stack gap="xs" data-testid="alert-details">
            <Paper px="md" py="sm" radius="xs">
              <Text size="xxs" opacity={0.5} mb={4}>
                Trigger
              </Text>
              <Group gap="xs">
                <Text size="sm" opacity={0.7}>
                  Alert when the value
                </Text>
                <NativeSelect
                  data={optionsToSelectData(TILE_ALERT_THRESHOLD_TYPE_OPTIONS)}
                  size="xs"
                  name={`alert.thresholdType`}
                  control={control}
                />
                <NumberInput
                  size="xs"
                  w={80}
                  control={control}
                  name={`alert.threshold`}
                />
                over
                <NativeSelect
                  data={optionsToSelectData(TILE_ALERT_INTERVAL_OPTIONS)}
                  size="xs"
                  name={`alert.interval`}
                  control={control}
                />
                <Text size="sm" opacity={0.7}>
                  window via
                </Text>
                <NativeSelect
                  data={optionsToSelectData(ALERT_CHANNEL_OPTIONS)}
                  size="xs"
                  name={`alert.channel.type`}
                  control={control}
                />
              </Group>
              {alert?.createdBy && (
                <Text size="xs" opacity={0.6} mt="xs">
                  Created by {alert.createdBy.name || alert.createdBy.email}
                </Text>
              )}
              <AlertScheduleFields
                control={control}
                setValue={setValue}
                scheduleOffsetName="alert.scheduleOffsetMinutes"
                scheduleStartAtName="alert.scheduleStartAt"
                scheduleOffsetMinutes={alertScheduleOffsetMinutes}
                maxScheduleOffsetMinutes={maxAlertScheduleOffsetMinutes}
                offsetWindowLabel={
                  alertIntervalLabel
                    ? `from each ${alertIntervalLabel} window`
                    : 'from each alert window'
                }
              />
            </Paper>
            <Paper px="md" py="sm" radius="xs">
              <Text size="xxs" opacity={0.5} mb={4}>
                Send to
              </Text>
              <AlertChannelForm
                control={control}
                type={alertChannelType}
                namePrefix="alert."
              />
            </Paper>
          </Stack>
        </Paper>
      )}
    </>
  );
}
