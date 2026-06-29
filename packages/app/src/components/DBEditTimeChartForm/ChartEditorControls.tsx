import { useState } from 'react';
import {
  Control,
  FieldArrayWithId,
  FieldErrors,
  UseFormClearErrors,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  HEATMAP_ALLOWED_SOURCE_KINDS,
  isBuilderChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptTimestamp,
  DisplayType,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Divider, Flex, Group, Switch, Text } from '@mantine/core';
import { IconBell, IconCirclePlus } from '@tabler/icons-react';

import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from '@/components/SourceSchemaPreview';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { IS_LOCAL_MODE } from '@/config';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

import { OnClickFormButton } from './OnClickForm/OnClickFormButton';
import { ChartSeriesEditor } from './ChartSeriesEditor';
import { HeatmapSeriesEditor } from './HeatmapSeriesEditor';
import { TileAlertEditor } from './TileAlertEditor';

// The builder editor runs ClickHouse metadata/autocomplete against the source's
// connection, so PromQL sources (Prometheus connections, no ClickHouse tables)
// are excluded here — they're selected inside PromqlChartEditor instead.
const BUILDER_ALLOWED_SOURCE_KINDS = [
  SourceKind.Log,
  SourceKind.Trace,
  SourceKind.Session,
  SourceKind.Metric,
];

type ChartEditorControlsProps = {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  clearErrors: UseFormClearErrors<ChartEditorFormState>;
  errors: FieldErrors<ChartEditorFormState>;
  fields: FieldArrayWithId<ChartEditorFormState, 'series', 'id'>[];
  append: (value: SavedChartConfigWithSelectArray['select'][number]) => void;
  removeSeries: (index: number) => void;
  swapSeries: (from: number, to: number) => void;
  duplicateSeries: (index: number) => void;
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
  openHeatmapSettings: () => void;
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
  duplicateSeries,
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
  openHeatmapSettings,
}: ChartEditorControlsProps) {
  const canAddSeries =
    displayType !== DisplayType.Pie &&
    displayType !== DisplayType.Heatmap &&
    // Number tiles support up to two series (numerator + denominator for
    // ratio mode); Line/Table types remain unbounded.
    !(displayType === DisplayType.Number && fields.length >= 2);
  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  // Exemplars overlay (trace links) is available on metric sources for the
  // time-series display types. Toggling persists `enableExemplars` on the chart
  // config; charts render the overlay from that flag (no runtime toggle). PromQL
  // charts use PromqlChartEditor, which has its own exemplars toggle.
  // Exemplars mark a single series' raw measurement (e.g. latency), so they're
  // only meaningful on a single, non-ratio series — not on ratio/multi-series.
  const enableExemplars = useWatch({ control, name: 'enableExemplars' });
  const series = useWatch({ control, name: 'series' });
  const canShowExemplars =
    (displayType === DisplayType.Line ||
      displayType === DisplayType.StackedBar) &&
    tableSource?.kind === SourceKind.Metric &&
    fields.length === 1 &&
    seriesReturnType !== 'ratio' &&
    // Latency-only for now: exemplar values are durations, which only share the
    // y-axis unit on a histogram metric.
    Array.isArray(series) &&
    series[0]?.metricType === MetricsDataType.Histogram;

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
            allowedSourceKinds={
              displayType === DisplayType.Heatmap
                ? [...HEATMAP_ALLOWED_SOURCE_KINDS]
                : BUILDER_ALLOWED_SOURCE_KINDS
            }
            onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
            isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(tableSource)}
          />
          <SourceSchemaPreview
            source={tableSource}
            controlled
            open={isSourceSchemaPreviewOpen}
            onClose={() => setIsSourceSchemaPreviewOpen(false)}
          />
        </Group>
        <Group>
          {tableSource &&
            activeTab !== 'search' &&
            activeTab !== 'heatmap' &&
            chartConfigForExplanations &&
            isBuilderChartConfig(chartConfigForExplanations) && (
              <MVOptimizationIndicator
                source={tableSource}
                config={chartConfigForExplanations}
              />
            )}
        </Group>
      </Flex>
      {displayType === DisplayType.Heatmap && Array.isArray(select) ? (
        <HeatmapSeriesEditor
          control={control}
          setValue={setValue}
          tableSource={tableSource}
          onSubmit={onSubmit}
          onOpenDisplaySettings={openHeatmapSettings}
        />
      ) : displayType !== DisplayType.Search && Array.isArray(select) ? (
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
              onDuplicateSeries={duplicateSeries}
              onSubmit={onSubmit}
              setValue={setValue}
              connectionId={tableSource?.connection}
              showGroupBy={
                fields.length === 1 && displayType !== DisplayType.Number
              }
              showHaving={
                fields.length === 1 && displayType === DisplayType.Table
              }
              showDuplicate={canAddSeries}
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
              {canAddSeries && (
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
              {/* Ratio merges exactly two series via divide(); only
                  Line/StackedBar/Table/Number can reach two series, so gating
                  on the count alone covers them all (Number included). */}
              {fields.length === 2 && (
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
              {canShowExemplars && (
                <Switch
                  label="Exemplars"
                  size="sm"
                  color="gray"
                  variant="subtle"
                  onClick={() => {
                    setValue('enableExemplars', enableExemplars !== true);
                    onSubmit();
                  }}
                  checked={enableExemplars === true}
                />
              )}
              {canShowExemplars && enableExemplars === true && (
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Trace source
                  </Text>
                  <SourceSelectControlled
                    size="xs"
                    control={control}
                    name="exemplarTraceSourceId"
                    allowedSourceKinds={[SourceKind.Trace]}
                  />
                </Group>
              )}
              {(displayType === DisplayType.Line ||
                displayType === DisplayType.StackedBar ||
                displayType === DisplayType.Number) &&
                dashboardId &&
                !alert &&
                !IS_LOCAL_MODE && (
                  <Button
                    variant="subtle"
                    data-testid="alert-button"
                    size="sm"
                    onClick={() => setValue('alert', DEFAULT_TILE_ALERT)}
                  >
                    <IconBell size={14} className="me-2" />
                    Add Alert
                  </Button>
                )}
            </Group>
            <Group>
              {displayType === DisplayType.Table && (
                <OnClickFormButton
                  control={control}
                  setValue={setValue}
                  onSubmit={onSubmit}
                />
              )}
              <Button
                onClick={openDisplaySettings}
                size="compact-sm"
                variant="secondary"
              >
                Display Settings
              </Button>
            </Group>
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
        <Box mt="sm">
          <TileAlertEditor
            control={control}
            setValue={setValue}
            alert={alert}
            onRemove={() => setValue('alert', undefined)}
          />
        </Box>
      )}
    </>
  );
}
