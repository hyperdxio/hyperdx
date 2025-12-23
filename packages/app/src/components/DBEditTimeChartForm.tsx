import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { omit } from 'lodash';
import {
  Control,
  Controller,
  useFieldArray,
  useForm,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { NativeSelect, NumberInput } from 'react-hook-form-mantine';
import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartAlertBaseSchema,
  ChartConfigWithDateRange,
  DateRange,
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
  Menu,
  Paper,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconBell,
  IconChartLine,
  IconCirclePlus,
  IconCode,
  IconDotsVertical,
  IconLayoutGrid,
  IconList,
  IconMarkdown,
  IconNumbers,
  IconPlayerPlay,
  IconTable,
  IconTrash,
} from '@tabler/icons-react';
import { SortingState } from '@tanstack/react-table';

import {
  AGG_FNS,
  buildTableRowSearchUrl,
  getPreviousDateRange,
} from '@/ChartUtils';
import { AlertChannelForm, getAlertReferenceLines } from '@/components/Alerts';
import ChartSQLPreview from '@/components/ChartSQLPreview';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import { IS_LOCAL_MODE } from '@/config';
import { GranularityPickerControlled } from '@/GranularityPicker';
import { useFetchMetricResourceAttrs } from '@/hooks/useFetchMetricResourceAttrs';
import SearchInputV2 from '@/SearchInputV2';
import { getFirstTimestampValueExpression, useSource } from '@/source';
import { parseTimeQuery } from '@/timeQuery';
import { FormatTime } from '@/useFormatTime';
import {
  getMetricTableName,
  optionsToSelectData,
  orderByStringToSortingState,
  sortingStateToOrderByString,
} from '@/utils';
import {
  ALERT_CHANNEL_OPTIONS,
  DEFAULT_TILE_ALERT,
  extendDateRangeToInterval,
  intervalToGranularity,
  TILE_ALERT_INTERVAL_OPTIONS,
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

import HDXMarkdownChart from '../HDXMarkdownChart';
import type { NumberFormat } from '../types';

import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import { AggFnSelectControlled } from './AggFnSelect';
import DBNumberChart from './DBNumberChart';
import DBSqlRowTableWithSideBar from './DBSqlRowTableWithSidebar';
import {
  CheckBoxControlled,
  InputControlled,
  SwitchControlled,
  TextInputControlled,
} from './InputControlled';
import { MetricNameSelect } from './MetricNameSelect';
import { NumberFormatInput } from './NumberFormat';
import SaveToDashboardModal from './SaveToDashboardModal';
import SourceSchemaPreview from './SourceSchemaPreview';
import { SourceSelectControlled } from './SourceSelect';

const isQueryReady = (queriedConfig: ChartConfigWithDateRange | undefined) =>
  ((queriedConfig?.select?.length ?? 0) > 0 ||
    typeof queriedConfig?.select === 'string') &&
  queriedConfig?.from?.databaseName &&
  // tableName is emptry for metric sources
  (queriedConfig?.from?.tableName || queriedConfig?.metricTables) &&
  queriedConfig?.timestampValueExpression;

const MINIMUM_THRESHOLD_VALUE = 0.0000000001; // to make alert input > 0

const NumberFormatInputControlled = ({
  control,
  onSubmit,
}: {
  control: Control<any>;
  onSubmit: () => void;
}) => {
  return (
    <Controller
      control={control}
      name="numberFormat"
      render={({ field: { onChange, value } }) => (
        <NumberFormatInput
          onChange={(newValue?: NumberFormat) => {
            onChange(newValue);
            onSubmit();
          }}
          value={value}
        />
      )}
    />
  );
};

function ChartSeriesEditorComponent({
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
  tableName: _tableName,
  parentRef,
  length,
  tableSource,
}: {
  control: Control<any>;
  databaseName: string;
  dateRange?: DateRange['dateRange'];
  connectionId?: string;
  index: number;
  namePrefix: string;
  parentRef?: HTMLElement | null;
  onRemoveSeries: (index: number) => void;
  onSwapSeries: (from: number, to: number) => void;
  onSubmit: () => void;
  setValue: UseFormSetValue<any>;
  showGroupBy: boolean;
  tableName: string;
  length: number;
  tableSource?: TSource;
}) {
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
  const { data: attributeKeys } = useFetchMetricResourceAttrs({
    databaseName,
    tableName: tableName || '',
    metricType,
    metricName,
    tableSource,
    isSql: aggConditionLanguage === 'sql',
  });

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
            defaultValue={AGG_FNS[0].value}
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
              ...(aggFn === 'none' && { width: '100%' }),
            }}
          >
            <SQLInlineEditorControlled
              tableConnection={{
                databaseName,
                tableName: tableName ?? '',
                connectionId: connectionId ?? '',
              }}
              control={control}
              name={`${namePrefix}valueExpression`}
              placeholder="SQL Column"
              onSubmit={onSubmit}
            />
          </div>
        )}
        {aggFn !== 'none' && (
          <Flex align={'center'} gap={'xs'} className="flex-grow-1">
            <Text size="sm">Where</Text>
            {aggConditionLanguage === 'sql' ? (
              <SQLInlineEditorControlled
                tableConnection={{
                  databaseName,
                  tableName: tableName ?? '',
                  connectionId: connectionId ?? '',
                }}
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
                tableConnection={{
                  connectionId: connectionId ?? '',
                  databaseName: databaseName ?? '',
                  tableName: tableName ?? '',
                }}
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
          </Flex>
        )}
        {showGroupBy && (
          <Flex align={'center'} gap={'xs'}>
            <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
              Group By
            </Text>
            <div style={{ minWidth: 300 }}>
              <SQLInlineEditorControlled
                parentRef={parentRef}
                tableConnection={{
                  databaseName,
                  tableName: tableName ?? '',
                  connectionId: connectionId ?? '',
                  metricName:
                    tableSource?.kind === SourceKind.Metric
                      ? metricName
                      : undefined,
                }}
                control={control}
                name={`groupBy`}
                placeholder="SQL Columns"
                disableKeywordAutocomplete
                onSubmit={onSubmit}
              />
            </div>
          </Flex>
        )}
      </Flex>
    </>
  );
}
const ChartSeriesEditor = ChartSeriesEditorComponent;

// Autocomplete can focus on column/map keys

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const zSavedChartConfig = z
  .object({
    // TODO: Chart
    alert: ChartAlertBaseSchema.optional(),
  })
  .passthrough();

export type SavedChartConfigWithSelectArray = Omit<
  SavedChartConfig,
  'select'
> & {
  select: Exclude<SavedChartConfig['select'], string>;
};

type SavedChartConfigWithSeries = SavedChartConfig & {
  series: SavedChartConfigWithSelectArray['select'];
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
  'data-testid': dataTestId,
  submitRef,
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
  'data-testid'?: string;
  submitRef?: React.MutableRefObject<(() => void) | undefined>;
}) {
  // useFieldArray only supports array type fields, and select can be either a string or array.
  // To solve for this, we maintain an extra form field called 'series' which is always an array.
  const configWithSeries: SavedChartConfigWithSeries = useMemo(
    () => ({
      ...chartConfig,
      series: Array.isArray(chartConfig.select) ? chartConfig.select : [],
    }),
    [chartConfig],
  );

  const { control, setValue, handleSubmit, register } =
    useForm<SavedChartConfigWithSeries>({
      defaultValues: configWithSeries,
      values: configWithSeries,
      resolver: zodResolver(zSavedChartConfig),
    });

  const {
    fields,
    append,
    remove: removeSeries,
    swap: swapSeries,
  } = useFieldArray({
    control: control as Control<SavedChartConfigWithSeries>,
    name: 'series',
  });

  const [isSampleEventsOpen, setIsSampleEventsOpen] = useState(false);

  const select = useWatch({ control, name: 'select' });
  const sourceId = useWatch({ control, name: 'source' });
  const whereLanguage = useWatch({ control, name: 'whereLanguage' });
  const alert = useWatch({ control, name: 'alert' });
  const seriesReturnType = useWatch({ control, name: 'seriesReturnType' });
  const compareToPreviousPeriod = useWatch({
    control,
    name: 'compareToPreviousPeriod',
  });
  const groupBy = useWatch({ control, name: 'groupBy' });
  const displayType =
    useWatch({ control, name: 'displayType' }) ?? DisplayType.Line;
  const markdown = useWatch({ control, name: 'markdown' });
  const alertChannelType = useWatch({ control, name: 'alert.channel.type' });
  const granularity = useWatch({ control, name: 'granularity' });

  const { data: tableSource } = useSource({ id: sourceId });
  const databaseName = tableSource?.from.databaseName;
  const tableName = tableSource?.from.tableName;

  // const tableSource = tableSourceWatch();
  // const databaseName = tableSourceWatch('from.databaseName');
  // const tableName = tableSourceWatch('from.tableName');
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
  }, [displayType, setValue]);

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
  const [queriedSource, setQueriedSource] = useState<TSource | undefined>(
    undefined,
  );

  const setQueriedConfigAndSource = useCallback(
    (config: ChartConfigWithDateRange, source: TSource) => {
      setQueriedConfig(config);
      setQueriedSource(source);
    },
    [],
  );

  const [saveToDashboardModalOpen, setSaveToDashboardModalOpen] =
    useState(false);

  const onSubmit = useCallback(() => {
    handleSubmit(form => {
      // Merge the series and select fields back together, and prevent the series field from being submitted
      const config = {
        ...omit(form, ['series']),
        select:
          form.displayType === DisplayType.Search ? form.select : form.series,
      };

      setChartConfig(config);
      if (tableSource != null) {
        const isSelectEmpty = !config.select || config.select.length === 0; // select is string or array
        const newConfig = {
          ...config,
          from: tableSource.from,
          timestampValueExpression: tableSource.timestampValueExpression,
          dateRange,
          connection: tableSource.connection,
          implicitColumnExpression: tableSource.implicitColumnExpression,
          metricTables: tableSource.metricTables,
          select: isSelectEmpty
            ? tableSource.defaultTableSelectExpression || ''
            : config.select,
          // Order By can only be set by the user for table charts
          orderBy:
            config.displayType === DisplayType.Table
              ? config.orderBy
              : undefined,
        };
        setQueriedConfigAndSource(
          // WARNING: DON'T JUST ASSIGN OBJECTS OR DO SPREAD OPERATOR STUFF WHEN
          // YOUR STATE IS AN OBJECT. YOU'RE COPYING BY REFERENCE WHICH MIGHT
          // ACCIDENTALLY CAUSE A useQuery SOMEWHERE TO FIRE A REQUEST EVERYTIME
          // AN INPUT CHANGES. USE structuredClone TO PERFORM A DEEP COPY INSTEAD
          structuredClone(newConfig),
          tableSource,
        );
      }
    })();
  }, [
    handleSubmit,
    setChartConfig,
    setQueriedConfigAndSource,
    tableSource,
    dateRange,
  ]);

  const onTableSortingChange = useCallback(
    (sortState: SortingState | null) => {
      setValue('orderBy', sortingStateToOrderByString(sortState) ?? '');
      onSubmit();
    },
    [setValue, onSubmit],
  );

  const tableSortState = useMemo(
    () =>
      queriedConfig?.orderBy && typeof queriedConfig.orderBy === 'string'
        ? orderByStringToSortingState(queriedConfig.orderBy)
        : undefined,
    [queriedConfig],
  );

  useEffect(() => {
    if (submitRef) {
      submitRef.current = onSubmit;
    }
  }, [onSubmit, submitRef]);

  const handleSave = useCallback(
    (v: SavedChartConfigWithSeries) => {
      // If the chart type is search, we need to ensure the select is a string
      if (displayType === DisplayType.Search && typeof v.select !== 'string') {
        v.select = '';
      } else if (displayType !== DisplayType.Search) {
        v.select = v.series;
      }
      // Avoid saving the series field. Series should be persisted in the select field.
      onSave?.(omit(v, ['series']));
    },
    [onSave, displayType],
  );

  // Track previous values for detecting changes
  const prevGranularityRef = useRef(granularity);
  const prevDisplayTypeRef = useRef(displayType);

  useEffect(() => {
    // Emulate the granularity picker auto-searching similar to dashboards
    if (granularity !== prevGranularityRef.current) {
      prevGranularityRef.current = granularity;
      onSubmit();
    }
  }, [granularity, onSubmit]);

  useEffect(() => {
    if (displayType !== prevDisplayTypeRef.current) {
      prevDisplayTypeRef.current = displayType;

      if (displayType === DisplayType.Search && typeof select !== 'string') {
        setValue('select', '');
        setValue('series', []);
      }
      if (displayType !== DisplayType.Search && typeof select === 'string') {
        const defaultSeries: SavedChartConfigWithSelectArray['select'] = [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ];
        setValue('where', '');
        setValue('select', defaultSeries);
        setValue('series', defaultSeries);
      }
      onSubmit();
    }
  }, [displayType, select, setValue, onSubmit]);

  // Emulate the date range picker auto-searching similar to dashboards
  useEffect(() => {
    setQueriedConfig((config: ChartConfigWithDateRange | undefined) => {
      if (config == null) {
        return config;
      }

      return {
        ...config,
        dateRange,
      };
    });
  }, [dateRange]);

  // Trigger a search when "compare to previous period" changes
  useEffect(() => {
    setQueriedConfig((config: ChartConfigWithDateRange | undefined) => {
      if (config == null) {
        return config;
      }

      return {
        ...config,
        compareToPreviousPeriod,
      };
    });
  }, [compareToPreviousPeriod]);

  const queryReady = isQueryReady(queriedConfig);

  // The chart config to use when explaining to to the user whether and why
  // their query is or is not being executed against a materialized view.
  const chartConfigForMvOptimizationExplanation:
    | ChartConfigWithDateRange
    | undefined = useMemo(() => {
    // If the user has submitted a query, us the submitted query, unless they have changed sources
    if (queriedConfig && queriedSource?.id === tableSource?.id) {
      return queriedConfig;
    }

    // If there is a chart config from the props (either a saved config or one from the URL params), use that,
    // unless a different source has been selected.
    return chartConfig && tableSource?.id === chartConfig.source
      ? {
          ...chartConfig,
          dateRange,
          timestampValueExpression: tableSource.timestampValueExpression,
          from: tableSource.from,
          connection: tableSource.connection,
        }
      : undefined;
  }, [chartConfig, dateRange, tableSource, queriedConfig, queriedSource]);

  const previousDateRange = getPreviousDateRange(dateRange);

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

  // Need to force a rerender on change as the modal will not be mounted when initially rendered
  const [parentRef, setParentRef] = useState<HTMLElement | null>(null);

  return (
    <div ref={setParentRef} data-testid={dataTestId}>
      <Controller
        control={control}
        name="displayType"
        render={({ field: { onChange, value } }) => (
          <Tabs value={value} onChange={onChange} radius={'xs'} mb="md">
            <Tabs.List>
              <Tabs.Tab
                value={DisplayType.Line}
                leftSection={<IconChartLine size={16} />}
              >
                Line/Bar
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Table}
                leftSection={<IconTable size={16} />}
              >
                Table
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Number}
                leftSection={<IconNumbers size={16} />}
              >
                Number
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Search}
                leftSection={<IconList size={16} />}
              >
                Search
              </Tabs.Tab>
              <Tabs.Tab
                value={DisplayType.Markdown}
                leftSection={<IconMarkdown size={16} />}
              >
                Markdown
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        )}
      />
      <Flex align="center" gap="sm" mb="sm">
        <Text size="sm" className="text-nowrap">
          Chart Name
        </Text>
        <InputControlled
          name="name"
          control={control}
          w="100%"
          type="text"
          placeholder="My Chart Name"
          data-testid="chart-name-input"
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
          <Box p="md" mb="md">
            <HDXMarkdownChart
              config={{
                markdown: markdown || 'Preview',
              }}
            />
          </Box>
        </div>
      ) : (
        <>
          <Flex mb="md" align="center" gap="sm" justify="space-between">
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
            {tableSource && activeTab !== 'search' && (
              <MVOptimizationIndicator
                source={tableSource}
                config={chartConfigForMvOptimizationExplanation}
              />
            )}
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
                  tableName={tableName ?? ''}
                  tableSource={tableSource}
                />
              ))}
              {fields.length > 1 && displayType !== DisplayType.Number && (
                <>
                  <Divider mt="md" mb="sm" />
                  <Flex align="center" mt="sm">
                    <Text
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
                        tableConnection={tcFromSource(tableSource)}
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
                  {displayType === DisplayType.Line &&
                    dashboardId &&
                    !IS_LOCAL_MODE && (
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
                        <IconBell size={14} className="me-2" />
                        {!alert ? 'Add Alert' : 'Remove Alert'}
                      </Button>
                    )}
                </Group>
                <NumberFormatInputControlled
                  control={control}
                  onSubmit={onSubmit}
                />
              </Flex>
            </>
          ) : (
            <Flex gap="xs" direction="column">
              <SQLInlineEditorControlled
                tableConnection={tcFromSource(tableSource)}
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
                  tableConnection={tcFromSource(tableSource)}
                  control={control}
                  name={`where`}
                  placeholder="SQL WHERE clause (ex. column = 'foo')"
                  onLanguageChange={lang => setValue('whereLanguage', lang)}
                  language="sql"
                  onSubmit={onSubmit}
                />
              ) : (
                <SearchInputV2
                  tableConnection={{
                    connectionId: tableSource?.connection ?? '',
                    databaseName: databaseName ?? '',
                    tableName: tableName ?? '',
                  }}
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
            <Paper px="md" py="sm" radius="xs">
              <Group gap="xs" justify="space-between">
                <Group gap="xs">
                  <Text size="sm" opacity={0.7}>
                    Alert when the value
                  </Text>
                  <NativeSelect
                    data={optionsToSelectData(
                      TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
                    )}
                    size="xs"
                    name={`alert.thresholdType`}
                    control={control}
                  />
                  <NumberInput
                    min={MINIMUM_THRESHOLD_VALUE}
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
                {(alert as any)?.createdBy && (
                  <Text size="xs" opacity={0.6}>
                    Created by{' '}
                    {(alert as any).createdBy?.name ||
                      (alert as any).createdBy?.email}
                  </Text>
                )}
              </Group>
              <Text size="xxs" opacity={0.5} mb={4} mt="xs">
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
      <Flex justify="space-between" mt="sm">
        <Flex gap="sm">
          {onSave != null && (
            <Button
              data-testid="chart-save-button"
              loading={isSaving}
              variant="outline"
              onClick={handleSubmit(handleSave)}
            >
              Save
            </Button>
          )}
          {onClose != null && (
            <Button
              variant="subtle"
              color="dark"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
          )}
        </Flex>
        <Flex gap="sm" my="sm" align="center" justify="end">
          {activeTab === 'table' && (
            <div style={{ minWidth: 300 }}>
              <SQLInlineEditorControlled
                parentRef={parentRef}
                tableConnection={tcFromSource(tableSource)}
                // The default order by is the current group by value
                placeholder={typeof groupBy === 'string' ? groupBy : ''}
                control={control}
                name={`orderBy`}
                disableKeywordAutocomplete
                onSubmit={onSubmit}
                label="ORDER BY"
              />
            </div>
          )}
          {activeTab !== 'markdown' &&
            setDisplayedTimeInputValue != null &&
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
          {activeTab !== 'markdown' && (
            <Button
              data-testid="chart-run-query-button"
              variant="outline"
              type="submit"
              onClick={onSubmit}
            >
              <IconPlayerPlay size={16} />
            </Button>
          )}
          {!IS_LOCAL_MODE && !dashboardId && (
            <Menu width={250}>
              <Menu.Target>
                <Button variant="outline" color="gray" px="xs" size="xs">
                  <IconDotsVertical size={14} />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconLayoutGrid size={16} />}
                  onClick={() => setSaveToDashboardModalOpen(true)}
                >
                  Save to Dashboard
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Flex>
      </Flex>
      {activeTab === 'time' && (
        <Group justify="end" mb="xs">
          <SwitchControlled
            control={control}
            name="compareToPreviousPeriod"
            label={
              <>
                Compare to Previous Period{' '}
                {!dashboardId && (
                  <>
                    (
                    <FormatTime value={previousDateRange?.[0]} format="short" />
                    {' - '}
                    <FormatTime value={previousDateRange?.[1]} format="short" />
                    )
                  </>
                )}
              </>
            }
          />
        </Group>
      )}
      {!queryReady && activeTab !== 'markdown' ? (
        <Paper shadow="xs" p="xl">
          <Center mih={400}>
            <Text size="sm">
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
          <DBTableChart
            config={queriedConfig}
            getRowSearchLink={row =>
              buildTableRowSearchUrl({
                row,
                source: tableSource,
                config: queriedConfig,
                dateRange: queriedConfig.dateRange,
              })
            }
            onSortingChange={onTableSortingChange}
            sort={tableSortState}
          />
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
            <DBSqlRowTableWithSideBar
              sourceId={sourceId}
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
                // Search mode requires a string select, not an array of aggregations
                select:
                  typeof queriedConfig.select === 'string' &&
                  queriedConfig.select
                    ? queriedConfig.select
                    : tableSource?.defaultTableSelectExpression || '',
                groupBy: undefined,
                granularity: undefined,
              }}
              enabled
              isLive={false}
              queryKeyPrefix={'search'}
            />
          </div>
        )}
      {showGeneratedSql && (
        <>
          <Divider mt="md" />
          {showSampleEvents && (
            <Accordion
              value={isSampleEventsOpen ? 'sample' : null}
              onChange={value => setIsSampleEventsOpen(value === 'sample')}
            >
              <Accordion.Item value="sample">
                <Accordion.Control icon={<IconList size={16} />}>
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
                      <DBSqlRowTableWithSideBar
                        sourceId={sourceId}
                        config={sampleEventsConfig}
                        enabled={isSampleEventsOpen}
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
              <Accordion.Control icon={<IconCode size={16} />}>
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
      <SaveToDashboardModal
        chartConfig={chartConfig}
        opened={saveToDashboardModalOpen}
        onClose={() => setSaveToDashboardModalOpen(false)}
      />
    </div>
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
