import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithDateRange,
  DisplayType,
  SavedChartConfig,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Divider,
  Flex,
  SegmentedControl,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconChartDots,
  IconChartLine,
  IconChartPie,
  IconList,
  IconMarkdown,
  IconNumbers,
  IconTable,
} from '@tabler/icons-react';

import { getPreviousDateRange } from '@/ChartUtils';
import ChartDisplaySettingsDrawer, {
  ChartConfigDisplaySettings,
} from '@/components/ChartDisplaySettingsDrawer';
import RawSqlChartEditor from '@/components/ChartEditor/RawSqlChartEditor';
import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import {
  convertFormStateToChartConfig,
  convertFormStateToSavedChartConfig,
  convertSavedChartConfigToFormState,
  isRawSqlDisplayType,
  validateChartForm,
} from '@/components/ChartEditor/utils';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { InputControlled } from '@/components/InputControlled';
import SaveToDashboardModal from '@/components/SaveToDashboardModal';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import HDXMarkdownChart from '@/HDXMarkdownChart';
import { getTraceDurationNumberFormat, useSource } from '@/source';
import { normalizeNoOpAlertScheduleFields } from '@/utils/alerts';

import { ChartActionBar } from './ChartActionBar';
import { ChartEditorControls } from './ChartEditorControls';
import { ChartPreviewPanel } from './ChartPreviewPanel';
import { ErrorNotificationMessage } from './ErrorNotificationMessage';
import {
  buildChartConfigForExplanations,
  computeDbTimeChartConfig,
  displayTypeToActiveTab,
  TABS_WITH_GENERATED_SQL,
  zSavedChartConfig,
} from './utils';

type EditTimeChartFormProps = {
  dashboardId?: string;
  chartConfig: SavedChartConfig;
  displayedTimeInputValue?: string;
  dateRange: [Date, Date];
  isSaving?: boolean;
  onTimeRangeSearch?: (value: string) => void;
  setChartConfig?: (chartConfig: SavedChartConfig) => void;
  setDisplayedTimeInputValue?: (value: string) => void;
  onSave?: (chart: SavedChartConfig) => void;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  'data-testid'?: string;
  submitRef?: React.MutableRefObject<(() => void) | undefined>;
  isDashboardForm?: boolean;
  autoRun?: boolean;
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
  onDirtyChange,
  'data-testid': dataTestId,
  submitRef,
  isDashboardForm = false,
  autoRun = false,
}: EditTimeChartFormProps) {
  const formValue: ChartEditorFormState = useMemo(
    () => convertSavedChartConfigToFormState(chartConfig),
    [chartConfig],
  );

  const {
    control,
    setValue,
    handleSubmit,
    register,
    setError,
    clearErrors,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<ChartEditorFormState>({
    defaultValues: formValue,
    values: formValue,
    resolver: zodResolver(zSavedChartConfig),
  });

  const {
    fields,
    append,
    remove: removeSeries,
    swap: swapSeries,
  } = useFieldArray({
    control,
    name: 'series',
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const select = useWatch({ control, name: 'select' });
  const sourceId = useWatch({ control, name: 'source' });
  const alert = useWatch({ control, name: 'alert' });
  const seriesReturnType = useWatch({ control, name: 'seriesReturnType' });
  const groupBy = useWatch({ control, name: 'groupBy' });
  const displayType =
    useWatch({ control, name: 'displayType' }) ?? DisplayType.Line;
  const markdown = useWatch({ control, name: 'markdown' });
  const granularity = useWatch({ control, name: 'granularity' });
  const configType = useWatch({ control, name: 'configType' });

  const chartConfigAlert = !isRawSqlSavedChartConfig(chartConfig)
    ? chartConfig.alert
    : undefined;

  const isRawSqlInput =
    configType === 'sql' && isRawSqlDisplayType(displayType);

  const { data: tableSource } = useSource({ id: sourceId });
  const databaseName = tableSource?.from.databaseName;
  const tableName = tableSource?.from.tableName;

  const activeTab = displayTypeToActiveTab(displayType);

  useEffect(() => {
    if (
      displayType !== DisplayType.Line &&
      displayType !== DisplayType.Number
    ) {
      setValue('alert', undefined);
    }
  }, [displayType, setValue]);

  const showGeneratedSql = TABS_WITH_GENERATED_SQL.has(activeTab);

  const showSampleEvents =
    tableSource?.kind !== SourceKind.Metric && !isRawSqlInput;

  const [
    alignDateRangeToGranularity,
    fillNulls,
    compareToPreviousPeriod,
    numberFormat,
  ] = useWatch({
    control,
    name: [
      'alignDateRangeToGranularity',
      'fillNulls',
      'compareToPreviousPeriod',
      'numberFormat',
    ],
  });

  const autoDetectedNumberFormat = useMemo(
    () =>
      getTraceDurationNumberFormat(
        tableSource,
        Array.isArray(select) ? select : undefined,
      ),
    [tableSource, select],
  );

  const displaySettings: ChartConfigDisplaySettings = useMemo(
    () => ({
      alignDateRangeToGranularity,
      fillNulls,
      compareToPreviousPeriod,
      numberFormat,
    }),
    [
      alignDateRangeToGranularity,
      fillNulls,
      compareToPreviousPeriod,
      numberFormat,
    ],
  );

  const [
    displaySettingsOpened,
    { open: openDisplaySettings, close: closeDisplaySettings },
  ] = useDisclosure(false);

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
    (config: ChartConfigWithDateRange, source: TSource | undefined) => {
      setQueriedConfig(config);
      setQueriedSource(source);
    },
    [],
  );

  const dbTimeChartConfig = useMemo(
    () => computeDbTimeChartConfig(queriedConfig, alert),
    [queriedConfig, alert],
  );

  const [saveToDashboardModalOpen, setSaveToDashboardModalOpen] =
    useState(false);

  const validateAndNormalize = useCallback(
    (form: ChartEditorFormState) => {
      const errors = validateChartForm(form, tableSource, setError);
      if (errors.length > 0) return { errors, config: null };

      const savedConfig = convertFormStateToSavedChartConfig(form, tableSource);
      if (!savedConfig) return { errors: [], config: null };

      const config = isRawSqlSavedChartConfig(savedConfig)
        ? savedConfig
        : {
            ...savedConfig,
            alert: normalizeNoOpAlertScheduleFields(
              savedConfig.alert,
              chartConfigAlert,
              {
                preserveExplicitScheduleOffsetMinutes:
                  dirtyFields.alert?.scheduleOffsetMinutes === true,
                preserveExplicitScheduleStartAt:
                  dirtyFields.alert?.scheduleStartAt === true,
              },
            ),
          };

      return { errors: [], config };
    },
    [
      tableSource,
      setError,
      chartConfigAlert,
      dirtyFields.alert?.scheduleOffsetMinutes,
      dirtyFields.alert?.scheduleStartAt,
    ],
  );

  const onSubmit = useCallback(
    (suppressErrorNotification: boolean = false) => {
      handleSubmit(form => {
        const { errors, config } = validateAndNormalize(form);
        if (errors.length > 0) {
          if (!suppressErrorNotification) {
            notifications.show({
              id: 'chart-error',
              title: 'Invalid Chart',
              message: <ErrorNotificationMessage errors={errors} />,
              color: 'red',
            });
          }
          return;
        }

        const queriedConfig = convertFormStateToChartConfig(
          form,
          dateRange,
          tableSource,
        );

        if (config && queriedConfig) {
          const isRawSqlChart =
            form.configType === 'sql' && isRawSqlDisplayType(form.displayType);
          setChartConfig?.(config);
          setQueriedConfigAndSource(
            queriedConfig,
            isRawSqlChart ? undefined : tableSource,
          );
        }
      })();
    },
    [
      validateAndNormalize,
      handleSubmit,
      setChartConfig,
      setQueriedConfigAndSource,
      tableSource,
      dateRange,
    ],
  );

  useEffect(() => {
    if (submitRef) {
      submitRef.current = onSubmit;
    }
  }, [onSubmit, submitRef]);

  const autoRunFired = useRef(false);
  useEffect(() => {
    if (autoRun && !autoRunFired.current && tableSource) {
      autoRunFired.current = true;
      onSubmit(true);
    }
  }, [autoRun, tableSource, onSubmit]);

  const handleSave = useCallback(
    (form: ChartEditorFormState) => {
      const { errors, config } = validateAndNormalize(form);
      if (errors.length > 0) {
        notifications.show({
          id: 'chart-error',
          title: 'Invalid Chart',
          message: <ErrorNotificationMessage errors={errors} />,
          color: 'red',
        });
        return;
      }

      if (config) {
        onSave?.(config);
      }
    },
    [validateAndNormalize, onSave],
  );

  // Track previous values for detecting changes
  const prevGranularityRef = useRef(granularity);
  const prevDisplayTypeRef = useRef(displayType);
  const prevConfigTypeRef = useRef(configType);

  useEffect(() => {
    // Emulate the granularity picker auto-searching similar to dashboards
    if (granularity !== prevGranularityRef.current) {
      prevGranularityRef.current = granularity;
      onSubmit();
    }
  }, [granularity, onSubmit]);

  useEffect(() => {
    const displayTypeChanged = displayType !== prevDisplayTypeRef.current;
    const configTypeChanged = configType !== prevConfigTypeRef.current;

    if (displayTypeChanged || configTypeChanged) {
      prevDisplayTypeRef.current = displayType;
      prevConfigTypeRef.current = configType;

      if (displayType === DisplayType.Search && typeof select !== 'string') {
        setValue('select', '');
        setValue('series', []);
      }

      if (displayType !== DisplayType.Search && !Array.isArray(select)) {
        const defaultSeries: SavedChartConfigWithSelectArray['select'] =
          displayType === DisplayType.Heatmap
            ? [
                {
                  aggFn: 'heatmap',
                  aggCondition: '',
                  aggConditionLanguage: getStoredLanguage() ?? 'lucene',
                  valueExpression: '',
                  countExpression: 'count()',
                },
              ]
            : [
                {
                  aggFn: 'count',
                  aggCondition: '',
                  aggConditionLanguage: getStoredLanguage() ?? 'lucene',
                  valueExpression: '',
                },
              ];
        setValue('where', '');
        setValue('select', defaultSeries);
        setValue('series', defaultSeries);
      }

      // Don't auto-submit when config type changes, to avoid clearing form state (like source)
      if (displayTypeChanged) {
        // true = Suppress error notification (because we're auto-submitting)
        onSubmit(true);
      }
    }
  }, [displayType, select, setValue, onSubmit, configType]);

  // Emulate the date range picker auto-searching similar to dashboards
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const chartConfigForExplanations = useMemo(
    () =>
      buildChartConfigForExplanations({
        queriedConfig,
        queriedSourceId: queriedSource?.id,
        tableSource,
        chartConfig,
        dateRange,
        activeTab,
        dbTimeChartConfig,
      }),
    [
      queriedConfig,
      queriedSource?.id,
      tableSource,
      chartConfig,
      dateRange,
      activeTab,
      dbTimeChartConfig,
    ],
  );

  const previousDateRange = getPreviousDateRange(dateRange);

  // Need to force a rerender on change as the modal will not be mounted when initially rendered
  const [parentRef, setParentRef] = useState<HTMLElement | null>(null);

  const handleUpdateDisplaySettings = useCallback(
    ({
      numberFormat,
      alignDateRangeToGranularity,
      fillNulls,
      compareToPreviousPeriod,
    }: ChartConfigDisplaySettings) => {
      setValue('numberFormat', numberFormat);
      setValue('alignDateRangeToGranularity', alignDateRangeToGranularity);
      setValue('fillNulls', fillNulls);
      setValue('compareToPreviousPeriod', compareToPreviousPeriod);
      onSubmit();
    },
    [setValue, onSubmit],
  );

  const tableConnection = useMemo(
    () => tcFromSource(tableSource),
    [tableSource],
  );

  return (
    <div ref={setParentRef} data-testid={dataTestId}>
      <ErrorBoundary>
        <Controller
          control={control}
          name="displayType"
          render={({ field: { onChange, value } }) => (
            <Tabs
              value={value}
              onChange={onChange}
              radius={'xs'}
              mb="md"
              data-testid="chart-type-input"
            >
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
                  value={DisplayType.Pie}
                  leftSection={<IconChartPie size={16} />}
                >
                  Pie
                </Tabs.Tab>
                <Tabs.Tab
                  value={DisplayType.Heatmap}
                  leftSection={<IconChartDots size={16} />}
                >
                  Heatmap
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
            flex={1}
            type="text"
            placeholder="My Chart Name"
            data-testid="chart-name-input"
          />
          {isRawSqlDisplayType(displayType) && (
            <Controller
              control={control}
              name="configType"
              render={({ field: { onChange, value } }) => (
                <SegmentedControl
                  value={value ?? 'builder'}
                  onChange={onChange}
                  data={[
                    { label: 'Builder', value: 'builder' },
                    { label: 'SQL', value: 'sql' },
                  ]}
                />
              )}
            />
          )}
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
        ) : isRawSqlInput ? (
          <RawSqlChartEditor
            control={control}
            setValue={setValue}
            onOpenDisplaySettings={openDisplaySettings}
            isDashboardForm={isDashboardForm}
          />
        ) : (
          <ChartEditorControls
            control={control}
            setValue={setValue}
            clearErrors={clearErrors}
            errors={errors}
            fields={fields}
            append={append}
            removeSeries={removeSeries}
            swapSeries={swapSeries}
            tableSource={tableSource}
            tableConnection={tableConnection}
            databaseName={databaseName}
            tableName={tableName}
            dateRange={dateRange}
            select={select}
            displayType={displayType}
            activeTab={activeTab}
            seriesReturnType={seriesReturnType}
            alert={alert}
            isRawSqlInput={isRawSqlInput}
            dashboardId={dashboardId}
            parentRef={parentRef}
            chartConfigForExplanations={chartConfigForExplanations}
            onSubmit={onSubmit}
            openDisplaySettings={openDisplaySettings}
          />
        )}
        <ChartActionBar
          control={control}
          handleSubmit={handleSubmit}
          tableConnection={tableConnection}
          activeTab={activeTab}
          isRawSqlInput={isRawSqlInput}
          dashboardId={dashboardId}
          parentRef={parentRef}
          groupBy={groupBy}
          onSubmit={onSubmit}
          handleSave={handleSave}
          onSave={onSave}
          onClose={onClose}
          isSaving={isSaving}
          displayedTimeInputValue={displayedTimeInputValue}
          setDisplayedTimeInputValue={setDisplayedTimeInputValue}
          onTimeRangeSearch={onTimeRangeSearch}
          setSaveToDashboardModalOpen={setSaveToDashboardModalOpen}
        />
      </ErrorBoundary>
      <ChartPreviewPanel
        queriedConfig={queriedConfig}
        tableSource={tableSource}
        dateRange={dateRange}
        activeTab={activeTab}
        alert={alert}
        sourceId={sourceId}
        onTimeRangeSelect={onTimeRangeSelect}
        chartConfigForExplanations={chartConfigForExplanations}
        showGeneratedSql={showGeneratedSql}
        showSampleEvents={showSampleEvents}
        dbTimeChartConfig={dbTimeChartConfig}
        setValue={(name, value) =>
          setValue(name, value as ChartEditorFormState[typeof name])
        }
        onSubmit={onSubmit}
      />
      <SaveToDashboardModal
        chartConfig={chartConfig}
        opened={saveToDashboardModalOpen}
        onClose={() => setSaveToDashboardModalOpen(false)}
      />
      <ChartDisplaySettingsDrawer
        opened={displaySettingsOpened}
        settings={displaySettings}
        defaultNumberFormat={autoDetectedNumberFormat}
        previousDateRange={!dashboardId ? previousDateRange : undefined}
        displayType={displayType}
        onChange={handleUpdateDisplaySettings}
        onClose={closeDisplaySettings}
      />
    </div>
  );
}
