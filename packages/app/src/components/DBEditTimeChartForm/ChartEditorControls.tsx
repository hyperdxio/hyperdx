import { useMemo, useState } from 'react';
import {
  Control,
  FieldArrayWithId,
  FieldErrors,
  UseFormClearErrors,
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
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Divider, Flex, Group, Switch, Text } from '@mantine/core';
import { IconBell, IconCirclePlus } from '@tabler/icons-react';

import {
  ChartEditorFormState,
  ChartFormSetValue,
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
import { getEventBody, isSingleExpression } from '@/source';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

import { OnClickFormButton } from './OnClickForm/OnClickFormButton';
import { ChartSeriesEditor } from './ChartSeriesEditor';
import { HeatmapSeriesEditor } from './HeatmapSeriesEditor';
import { TileAlertEditor } from './TileAlertEditor';
import { buildGroupByConnectionProps } from './utils';

type ChartEditorControlsProps = {
  control: Control<ChartEditorFormState>;
  setValue: ChartFormSetValue;
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
  ratioMode: ChartEditorFormState['ratioMode'];
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
  ratioMode,
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
    displayType !== DisplayType.Bar &&
    displayType !== DisplayType.Heatmap &&
    // Number tiles support up to two series (numerator + denominator for
    // ratio mode); Line/Table types remain unbounded.
    !(displayType === DisplayType.Number && fields.length >= 2);
  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  // The chart-level Group By must be valid against every series query. For
  // metric sources (which fan out to per-type tables) this means offering the
  // intersection of each series' fields; see buildGroupByConnectionProps.
  const series = useWatch({ control, name: 'series' });
  const groupByConnectionProps = useMemo(
    () => buildGroupByConnectionProps({ tableSource, series, tableConnection }),
    [tableSource, series, tableConnection],
  );

  // Grouped ratios can divide two ways (see RatioModeSchema); the mode toggle
  // is only meaningful when a Group By is set, so gate it on a non-empty value.
  const groupBy = useWatch({ control, name: 'groupBy' });
  const hasGroupBy = typeof groupBy === 'string' && groupBy.trim().length > 0;

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
                : undefined
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
            activeTab !== 'event_patterns' &&
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
      ) : displayType === DisplayType.EventPatterns ? (
        <Flex gap="xs" direction="column">
          <SQLInlineEditorControlled
            tableConnection={tableConnection}
            control={control}
            name="select"
            placeholder={
              tableSource
                ? `Default (${getEventBody(tableSource) ?? 'Body'}) — column name or expression`
                : 'Default — column name or expression'
            }
            onSubmit={onSubmit}
            label="Pattern Expression"
          />
          {typeof select === 'string' &&
            select.length > 0 &&
            !isSingleExpression(select) && (
              <Text size="xs" c="red">
                Pattern expression must be a single column or expression —
                multi-column lists are not supported. The source default will be
                used instead.
              </Text>
            )}
          <SearchWhereInput
            tableConnection={tableConnection}
            control={control}
            name="where"
            onSubmit={onSubmit}
            onLanguageChange={(lang: 'sql' | 'lucene') =>
              setValue('whereLanguage', lang, { isUserChange: true })
            }
            showLabel={false}
          />
        </Flex>
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
                    {...groupByConnectionProps}
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
                      { isUserChange: true },
                    );
                    onSubmit();
                  }}
                  checked={seriesReturnType === 'ratio'}
                />
              )}
              {/* Grouped ratios divide per-group by default; this opts into
                  share-of-total (each group's contribution to the blended
                  rate). Only metric sources fan out to per-series queries
                  merged client-side (see mergeResultSets/ratioMode) — other
                  sources compute the ratio within-group in the DB, where
                  ratioMode has no effect — so restrict to metric sources. No
                  effect on ungrouped ratios either, so also gate on a Group
                  By. */}
              {fields.length === 2 &&
                seriesReturnType === 'ratio' &&
                tableSource?.kind === SourceKind.Metric &&
                hasGroupBy && (
                  <Switch
                    label="Share of total"
                    size="sm"
                    color="gray"
                    variant="subtle"
                    onClick={() => {
                      setValue(
                        'ratioMode',
                        ratioMode === 'share_of_total'
                          ? 'per_group'
                          : 'share_of_total',
                      );
                      onSubmit();
                    }}
                    checked={ratioMode === 'share_of_total'}
                  />
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
                data-testid="display-settings-button"
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
              setValue('whereLanguage', lang, { isUserChange: true })
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
