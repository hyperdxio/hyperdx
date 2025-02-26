import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Control,
  Controller,
  useFieldArray,
  useForm,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import { NativeSelect, NumberInput } from 'react-hook-form-mantine';
import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertBaseSchema,
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  MetricsDataType,
  SavedChartConfig,
  SelectList,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Accordion,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';

import { AGG_FNS } from '@/ChartUtils';
import { AlertChannelForm, getAlertReferenceLines } from '@/components/Alerts';
import ChartSQLPreview from '@/components/ChartSQLPreview';
import { DBSqlRowTable } from '@/components/DBRowTable';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import { IS_DEV } from '@/config';
import { GranularityPickerControlled } from '@/GranularityPicker';
import { useFetchMetricResourceAttrs } from '@/hooks/useFetchMetricResourceAttrs';
import SearchInputV2 from '@/SearchInputV2';
import { getFirstTimestampValueExpression, useSource } from '@/source';
import { parseTimeQuery } from '@/timeQuery';
import { getMetricTableName, optionsToSelectData } from '@/utils';
import {
  ALERT_CHANNEL_OPTIONS,
  DEFAULT_TILE_ALERT,
  extendDateRangeToInterval,
  intervalToGranularity,
  TILE_ALERT_INTERVAL_OPTIONS,
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

import HDXMarkdownChart from '../HDXMarkdownChart';

import { AggFnSelectControlled } from './AggFnSelect';
import DBNumberChart from './DBNumberChart';
import { InputControlled } from './InputControlled';
import { MetricNameSelect } from './MetricNameSelect';
import { NumberFormatInput } from './NumberFormat';
import { SourceSelectControlled } from './SourceSelect';

const isQueryReady = (queriedConfig: ChartConfigWithDateRange | undefined) =>
  ((queriedConfig?.select?.length ?? 0) > 0 ||
    typeof queriedConfig?.select === 'string') &&
  queriedConfig?.from?.databaseName &&
  // tableName is emptry for metric sources
  (queriedConfig?.from?.tableName || queriedConfig?.metricTables) &&
  queriedConfig?.timestampValueExpression;

const NumberFormatInputControlled = ({
  control,
}: {
  control: Control<any>;
}) => {
  return (
    <Controller
      control={control}
      name="numberFormat"
      render={({ field: { onChange, value } }) => (
        <NumberFormatInput onChange={onChange} value={value} />
      )}
    />
  );
};

function ChartSeriesEditor({
  control,
  databaseName,
  connectionId,
  index,
  namePrefix,
  onRemoveSeries,
  onSubmit,
  setValue,
  showGroupBy,
  tableName: _tableName,
  watch,
}: {
  control: Control<any>;
  databaseName: string;
  connectionId?: string;
  index?: number;
  namePrefix: string;
  onRemoveSeries: () => void;
  onSubmit: () => void;
  setValue: UseFormSetValue<any>;
  showGroupBy: boolean;
  tableName: string;
  watch: UseFormWatch<any>;
}) {
  const aggFn = watch(`${namePrefix}aggFn`);
  const aggConditionLanguage = watch(
    `${namePrefix}aggConditionLanguage`,
    'lucene',
  );

  const metricType = watch(`${namePrefix}metricType`);
  const selectedSourceId = watch('source');
  const { data: tableSource } = useSource({ id: selectedSourceId });

  const tableName =
    tableSource?.kind === SourceKind.Metric
      ? getMetricTableName(tableSource, metricType)
      : _tableName;

  const { data: attributeKeys } = useFetchMetricResourceAttrs({
    databaseName,
    tableName: tableName || '',
    metricType,
    metricName: watch(`${namePrefix}metricName`),
    tableSource,
    isSql: aggConditionLanguage === 'sql',
  });

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            {(index ?? -1) > 0 && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                onClick={() => onRemoveSeries()}
              >
                <i className="bi bi-trash me-2" />
                Remove Series
              </Button>
            )}
          </Group>
        }
        c="dark.2"
        labelPosition="right"
        mb={8}
      />
      <Flex gap="sm" mt="xs" align="center">
        <div
          style={{
            minWidth: 200,
          }}
        >
          <AggFnSelectControlled
            aggFnName={`${namePrefix}aggFn`}
            quantileLevelName={`${namePrefix}level`}
            defaultValue={AGG_FNS[0].value}
            control={control}
          />
        </div>
        {tableSource?.kind === SourceKind.Metric && (
          <MetricNameSelect
            metricName={watch(`${namePrefix}metricName`)}
            metricType={metricType}
            setMetricName={value => {
              setValue(`${namePrefix}metricName`, value);
              setValue(`${namePrefix}valueExpression`, 'Value');
            }}
            setMetricType={value => setValue(`${namePrefix}metricType`, value)}
            metricSource={tableSource}
          />
        )}
        {tableSource?.kind !== SourceKind.Metric && aggFn !== 'count' && (
          <div style={{ minWidth: 220 }}>
            <SQLInlineEditorControlled
              database={databaseName}
              table={tableName}
              control={control}
              name={`${namePrefix}valueExpression`}
              connectionId={connectionId}
              placeholder="SQL Column"
              onSubmit={onSubmit}
            />
          </div>
        )}
        <Text size="sm">Where</Text>
        {aggConditionLanguage === 'sql' ? (
          <SQLInlineEditorControlled
            database={databaseName}
            table={tableName}
            connectionId={connectionId}
            control={control}
            name={`${namePrefix}aggCondition`}
            placeholder="SQL WHERE clause (ex. column = 'foo')"
            onLanguageChange={lang =>
              setValue(`${namePrefix}aggConditionLanguage`, lang)
            }
            additionalSuggestions={attributeKeys}
            language="sql"
            onSubmit={onSubmit}
          />
        ) : (
          <SearchInputV2
            connectionId={connectionId}
            database={databaseName}
            table={tableName}
            control={control}
            name={`${namePrefix}aggCondition`}
            onLanguageChange={lang =>
              setValue(`${namePrefix}aggConditionLanguage`, lang)
            }
            language="lucene"
            placeholder="Search your events w/ Lucene ex. column:foo"
            onSubmit={onSubmit}
            additionalSuggestions={attributeKeys}
          />
        )}
        {showGroupBy && (
          <>
            <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
              Group By
            </Text>
            <div style={{ minWidth: 300 }}>
              <SQLInlineEditorControlled
                database={databaseName}
                table={tableName}
                control={control}
                connectionId={connectionId}
                name={`groupBy`}
                placeholder="SQL Columns"
                disableKeywordAutocomplete
                onSubmit={onSubmit}
              />
            </div>
          </>
        )}
      </Flex>
    </>
  );
}

// Autocomplete can focus on column/map keys

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const zSavedChartConfig = z
  .object({
    // TODO: Chart
    alert: AlertBaseSchema.optional(),
  })
  .passthrough();

export type SavedChartConfigWithSelectArray = Omit<
  SavedChartConfig,
  'select'
> & {
  select: Exclude<SavedChartConfig['select'], string>;
};

export default function EditTimeChartForm({
  dashboardId,
  chartConfig,
  displayedTimeInputValue,
  dateRange,
  isSaving,
  onTimeRangeSearch,
  setChartConfig,
  setDisplayedTimeInputValue,
  onSave,
  onTimeRangeSelect,
  onClose,
}: {
  dashboardId?: string;
  chartConfig: SavedChartConfig;
  displayedTimeInputValue?: string;
  dateRange: [Date, Date];
  isSaving?: boolean;
  onTimeRangeSearch?: (value: string) => void;
  setChartConfig: (chartConfig: SavedChartConfig) => void;
  setDisplayedTimeInputValue?: (value: string) => void;
  onSave?: (chart: SavedChartConfig) => void;
  onClose?: () => void;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
}) {
  const { control, watch, setValue, handleSubmit, register } =
    useForm<SavedChartConfig>({
      defaultValues: chartConfig,
      resolver: zodResolver(zSavedChartConfig),
    });

  const { fields, append, remove } = useFieldArray({
    control: control as Control<SavedChartConfigWithSelectArray>,
    name: 'select', // TODO: bug with select = "" - it becomes and empty array
  });

  const select = watch('select');
  const sourceId = watch('source');
  const whereLanguage = watch('whereLanguage');
  const alert = watch('alert');

  const { data: tableSource } = useSource({ id: sourceId });
  const databaseName = tableSource?.from.databaseName;
  const tableName = tableSource?.from.tableName;

  // const tableSource = tableSourceWatch();
  // const databaseName = tableSourceWatch('from.databaseName');
  // const tableName = tableSourceWatch('from.tableName');

  const displayType = watch('displayType') ?? DisplayType.Line;
  const activeTab = useMemo(() => {
    switch (displayType) {
      case DisplayType.Search:
        return 'search';
      case DisplayType.Markdown:
        return 'markdown';
      case DisplayType.Table:
        return 'table';
      case DisplayType.Number:
        return 'number';
      default:
        return 'time';
    }
  }, [displayType]);

  useEffect(() => {
    if (displayType !== DisplayType.Line) {
      setValue('alert', undefined);
    }
  }, [displayType]);

  const showGeneratedSql = ['table', 'time', 'number'].includes(activeTab); // Whether to show the generated SQL preview
  const showSampleEvents = tableSource?.kind !== SourceKind.Metric;

  // const queriedConfig: ChartConfigWithDateRange | undefined = useMemo(() => {
  //   if (queriedTableSource == null) {
  //     return undefined;
  //   }

  //   return {
  //     ...chartConfig,
  //     from: queriedTableSource.from,
  //     timestampValueExpression: queriedTableSource?.timestampValueExpression,
  //     dateRange,
  //   };
  // }, [dateRange, chartConfig, queriedTableSource]);

  // Only update this on submit, otherwise we'll have issues
  // with using the source value from the last submit
  // (ex. ignoring local custom source updates)
  const [queriedConfig, setQueriedConfig] = useState<
    ChartConfigWithDateRange | undefined
  >(undefined);

  const onSubmit = useCallback(() => {
    handleSubmit(form => {
      setChartConfig(form);
      if (tableSource != null) {
        setQueriedConfig({
          ...form,
          from: tableSource.from,
          timestampValueExpression: tableSource.timestampValueExpression,
          dateRange,
          connection: tableSource.connection,
          implicitColumnExpression: tableSource.implicitColumnExpression,
          metricTables: tableSource.metricTables,
        });
      }
    })();
  }, [handleSubmit, setChartConfig, setQueriedConfig, tableSource, dateRange]);

  watch((_, { name, type }) => {
    // Emulate the granularity picker auto-searching similar to dashboards
    if (name === 'granularity' && type === 'change') {
      onSubmit();
    }
    if (name === 'displayType' && type === 'change') {
      if (_.displayType === DisplayType.Search && typeof select !== 'string') {
        setValue('select', '');
      }
      if (_.displayType !== DisplayType.Search && typeof select === 'string') {
        setValue('where', '');
        setValue('select', [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ]);
      }
      onSubmit();
    }
  });

  // Emulate the date range picker auto-searching similar to dashboards
  useEffect(() => {
    setQueriedConfig(config => {
      if (config == null) {
        return config;
      }

      return {
        ...config,
        dateRange,
      };
    });
  }, [dateRange]);

  const queryReady = isQueryReady(queriedConfig);

  const sampleEventsConfig = useMemo(
    () =>
      tableSource != null && queriedConfig != null && queryReady
        ? {
            ...queriedConfig,
            orderBy: [
              {
                ordering: 'DESC' as const,
                valueExpression: getFirstTimestampValueExpression(
                  tableSource.timestampValueExpression,
                ),
              },
            ],
            dateRange,
            timestampValueExpression: tableSource.timestampValueExpression,
            connection: tableSource.connection,
            from: tableSource.from,
            limit: { limit: 200 },
            select: tableSource?.defaultTableSelectExpression || '',
            filters: seriesToFilters(queriedConfig.select),
            filtersLogicalOperator: 'OR' as const,
            groupBy: undefined,
            granularity: undefined,
          }
        : null,
    [queriedConfig, tableSource, dateRange, queryReady],
  );

  return (
    <>
      <Controller
        control={control}
        name="displayType"
        render={({ field: { onChange, value } }) => (
          <Tabs value={value} onChange={onChange} radius={'xs'} mb="md">
            <Tabs.List>
              <Tabs.Tab
                value={DisplayType.Line}
                leftSection={<i className="bi bi-graph-up" />}
              >
                Line/Bar
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Table}
                leftSection={<i className="bi bi-table" />}
              >
                Table
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Number}
                leftSection={<i className="bi bi-123" />}
              >
                Number
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Search}
                leftSection={<i className="bi bi-card-list" />}
              >
                Search
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Markdown}
                leftSection={<i className="bi bi-markdown" />}
              >
                Markdown
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        )}
      />
      <Flex align="center" gap="sm" mb="sm">
        <Text c="gray.4" size="sm" className="text-nowrap">
          Chart Name
        </Text>
        <InputControlled
          name="name"
          control={control}
          w="100%"
          type="text"
          placeholder="My Chart Name"
        />
      </Flex>
      <Divider my="md" />

      {activeTab === 'markdown' ? (
        <div>
          <Textarea
            {...register('markdown')}
            label="Markdown content"
            placeholder="Markdown"
            mb="md"
            styles={{
              input: {
                minHeight: 200,
              },
            }}
          />
          <Box p="md" bg="dark.6" mb="md">
            <HDXMarkdownChart
              config={{
                markdown: watch('markdown') || 'Preview',
              }}
            />
          </Box>
        </div>
      ) : (
        <>
          <Flex mb="md" align="center" gap="sm">
            <Text c="gray.4" pe="md" size="sm">
              Data Source
            </Text>
            <SourceSelectControlled size="xs" control={control} name="source" />
          </Flex>

          {displayType !== DisplayType.Search && Array.isArray(select) ? (
            <>
              {fields.map((field, index) => (
                <ChartSeriesEditor
                  control={control}
                  databaseName={databaseName ?? ''}
                  index={index}
                  key={field.id}
                  namePrefix={`select.${index}.`}
                  onRemoveSeries={() => remove(index)}
                  onSubmit={onSubmit}
                  setValue={setValue}
                  connectionId={tableSource?.connection}
                  showGroupBy={
                    fields.length === 1 && displayType !== DisplayType.Number
                  }
                  tableName={tableName ?? ''}
                  watch={watch}
                />
              ))}
              {fields.length > 1 && displayType !== DisplayType.Number && (
                <>
                  <Divider mt="md" mb="sm" />
                  <Flex align="center" mt="sm">
                    <Text
                      c="gray.4"
                      me="sm"
                      size="sm"
                      style={{
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Group By
                    </Text>
                    <div style={{ flexGrow: 1 }}>
                      <SQLInlineEditorControlled
                        database={databaseName}
                        table={tableName}
                        connectionId={tableSource?.connection}
                        control={control}
                        name={`groupBy`}
                        placeholder="SQL Columns"
                        onSubmit={onSubmit}
                        disableKeywordAutocomplete
                      />
                    </div>
                  </Flex>
                </>
              )}
              <Divider mt="md" mb="sm" />
              <Flex mt={4} align="center" justify="space-between">
                <Group gap={0}>
                  {displayType !== DisplayType.Number && (
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
                      <i className="bi bi-plus-circle me-2" />
                      Add Series
                    </Button>
                  )}
                  {displayType === DisplayType.Line &&
                    dashboardId &&
                    IS_DEV && (
                      <Button
                        variant="subtle"
                        size="sm"
                        color={alert ? 'red' : 'gray'}
                        onClick={() =>
                          setValue(
                            'alert',
                            alert ? undefined : DEFAULT_TILE_ALERT,
                          )
                        }
                      >
                        <i className="bi bi-bell-fill me-2" />
                        {!alert ? 'Add Alert' : 'Remove Alert'}
                      </Button>
                    )}
                </Group>
                <NumberFormatInputControlled control={control} />
              </Flex>
            </>
          ) : (
            <Flex gap="xs" direction="column">
              <SQLInlineEditorControlled
                connectionId={tableSource?.connection}
                database={databaseName}
                table={tableName}
                control={control}
                name="select"
                placeholder={
                  tableSource?.defaultTableSelectExpression || 'SELECT Columns'
                }
                defaultValue={tableSource?.defaultTableSelectExpression}
                onSubmit={onSubmit}
                label="SELECT"
              />
              {whereLanguage === 'sql' ? (
                <SQLInlineEditorControlled
                  database={databaseName}
                  table={tableName}
                  connectionId={tableSource?.connection}
                  control={control}
                  name={`where`}
                  placeholder="SQL WHERE clause (ex. column = 'foo')"
                  onLanguageChange={lang => setValue('whereLanguage', lang)}
                  language="sql"
                  onSubmit={onSubmit}
                />
              ) : (
                <SearchInputV2
                  connectionId={tableSource?.connection}
                  database={databaseName}
                  table={tableName}
                  control={control}
                  name="where"
                  onLanguageChange={lang => setValue('whereLanguage', lang)}
                  language="lucene"
                  placeholder="Search your events w/ Lucene ex. column:foo"
                  onSubmit={onSubmit}
                />
              )}
            </Flex>
          )}
        </>
      )}

      {alert && (
        <Paper my="sm">
          <Stack gap="xs">
            <Paper px="md" py="sm" bg="dark.6" radius="xs">
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
                  min={1}
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
              <Text size="xxs" opacity={0.5} mb={4} mt="xs">
                Send to
              </Text>
              <AlertChannelForm
                control={control}
                type={watch('alert.channel.type')}
                namePrefix="alert."
              />
            </Paper>
          </Stack>
        </Paper>
      )}

      <Flex justify="space-between" mt="sm">
        <Flex gap="sm">
          {onSave != null && (
            <Button
              loading={isSaving}
              variant="outline"
              onClick={() => {
                handleSubmit(v => {
                  onSave?.(v);
                })();
              }}
            >
              Save
            </Button>
          )}
          {onClose != null && (
            <Button
              variant="subtle"
              color="dark.2"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
          )}
        </Flex>
        <Flex gap="sm" my="sm" align="center" justify="end">
          {setDisplayedTimeInputValue != null &&
            displayedTimeInputValue != null &&
            onTimeRangeSearch != null && (
              <TimePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={range => {
                  onTimeRangeSearch(range);
                }}
                onSubmit={range => {
                  onTimeRangeSearch(range);
                }}
              />
            )}
          {activeTab === 'time' && (
            <GranularityPickerControlled control={control} name="granularity" />
          )}
          <Button
            variant="outline"
            type="submit"
            color="green"
            onClick={onSubmit}
          >
            <i className="bi bi-play"></i>
          </Button>
        </Flex>
      </Flex>
      {!queryReady && activeTab !== 'markdown' ? (
        <Paper shadow="xs" p="xl">
          <Center mih={400}>
            <Text size="sm" c="gray.4">
              Please start by selecting a database, table, and timestamp column
              above and then click the play button to query data.
            </Text>
          </Center>
        </Paper>
      ) : undefined}
      {queryReady && queriedConfig != null && activeTab === 'table' && (
        <div
          className="flex-grow-1 d-flex flex-column"
          style={{ minHeight: 400 }}
        >
          <DBTableChart config={queriedConfig} />
        </div>
      )}
      {queryReady && queriedConfig != null && activeTab === 'time' && (
        <div
          className="flex-grow-1 d-flex flex-column"
          style={{ minHeight: 400 }}
        >
          <DBTimeChart
            sourceId={sourceId}
            config={{
              ...queriedConfig,
              granularity: alert
                ? intervalToGranularity(alert.interval)
                : queriedConfig.granularity,
              dateRange: alert
                ? extendDateRangeToInterval(
                    queriedConfig.dateRange,
                    alert.interval,
                  )
                : queriedConfig.dateRange,
            }}
            onTimeRangeSelect={onTimeRangeSelect}
            referenceLines={
              alert &&
              getAlertReferenceLines({
                threshold: alert.threshold,
                thresholdType: alert.thresholdType,
              })
            }
          />
        </div>
      )}
      {queryReady && queriedConfig != null && activeTab === 'number' && (
        <div
          className="flex-grow-1 d-flex flex-column"
          style={{ minHeight: 400 }}
        >
          <DBNumberChart config={queriedConfig} />
        </div>
      )}
      {queryReady &&
        tableSource &&
        queriedConfig != null &&
        activeTab === 'search' && (
          <div
            className="flex-grow-1 d-flex flex-column"
            style={{ height: 400 }}
          >
            <DBSqlRowTable
              config={{
                ...queriedConfig,
                orderBy: [
                  {
                    ordering: 'DESC' as const,
                    valueExpression: getFirstTimestampValueExpression(
                      tableSource.timestampValueExpression,
                    ),
                  },
                ],
                dateRange,
                timestampValueExpression: tableSource.timestampValueExpression,
                connection: tableSource.connection,
                from: tableSource.from,
                limit: { limit: 200 },
                select:
                  queriedConfig.select ||
                  tableSource?.defaultTableSelectExpression ||
                  '',
                groupBy: undefined,
                granularity: undefined,
              }}
              onRowExpandClick={() => {}}
              highlightedLineId={undefined}
              enabled
              isLive={false}
              queryKeyPrefix={'search'}
              onScroll={() => {}}
            />
          </div>
        )}
      {showGeneratedSql && (
        <>
          <Divider mt="md" />
          {showSampleEvents && (
            <Accordion defaultValue="sample">
              <Accordion.Item value="sample">
                <Accordion.Control icon={<i className="bi bi-card-list"></i>}>
                  <Text size="sm" style={{ alignSelf: 'center' }}>
                    Sample Matched Events
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  {sampleEventsConfig != null && (
                    <div
                      className="flex-grow-1 d-flex flex-column"
                      style={{ height: 400 }}
                    >
                      <DBSqlRowTable
                        config={sampleEventsConfig}
                        highlightedLineId={undefined}
                        enabled
                        isLive={false}
                        queryKeyPrefix={'search'}
                      />
                    </div>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
          <Accordion defaultValue="">
            <Accordion.Item value={'SQL'}>
              <Accordion.Control icon={<i className="bi bi-code-square"></i>}>
                <Text size="sm" style={{ alignSelf: 'center' }}>
                  Generated SQL
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                {queryReady && queriedConfig != null && (
                  <ChartSQLPreview config={queriedConfig} />
                )}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}
    </>
  );
}

// similar to seriesToSearchQuery from v1
function seriesToFilters(select: SelectList): Filter[] {
  if (typeof select === 'string') {
    return [];
  }

  const filters: Filter[] = select
    .map(({ aggCondition, aggConditionLanguage }) => {
      if (aggConditionLanguage != null && aggCondition != null) {
        return {
          type: aggConditionLanguage,
          condition: aggCondition,
        };
      } else {
        return null;
      }
    })
    .filter(Boolean) as Filter[];

  return filters;
}
