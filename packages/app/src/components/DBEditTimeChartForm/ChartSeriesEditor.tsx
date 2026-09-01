import { useCallback, useEffect, useMemo } from 'react';
import {
  Control,
  FieldErrors,
  UseFormClearErrors,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { indexToSeriesRef } from '@hyperdx/common-utils/dist/core/formula';
import {
  DateRange,
  isChartPaletteToken,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Box,
  Flex,
  Group,
  Menu,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconListSearch,
  IconPalette,
  IconTrash,
} from '@tabler/icons-react';

import { AGG_FNS } from '@/ChartUtils';
import {
  AggFnSelectControlled,
  defaultAggFnForMetricType,
  HISTOGRAM_SUPPORTED_AGG_FNS,
} from '@/components/AggFnSelect';
import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import { isFormulaSourceKind } from '@/components/ChartEditor/utils';
import {
  SeriesAliasField,
  SeriesCard,
  SeriesCardMenu,
} from '@/components/ChartSeries/SeriesCard';
import {
  CheckBoxControlled,
  TextInputControlled,
} from '@/components/InputControlled';
import { MetricAttributeHelperPanel } from '@/components/MetricAttributeHelperPanel';
import {
  MetricExplorerModal,
  type MetricExplorerSelection,
} from '@/components/MetricExplorer/MetricExplorerModal';
import { MetricNameSelect } from '@/components/MetricNameSelect';
import { FORMAT_ICONS } from '@/components/NumberFormat';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import SeriesColorDrawer from '@/components/SeriesColorDrawer';
import SeriesNumberFormatDrawer from '@/components/SeriesNumberFormatDrawer';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useFetchMetricMetadata } from '@/hooks/useFetchMetricMetadata';
import {
  parseAttributeKeysFromSuggestions,
  useFetchMetricResourceAttrs,
} from '@/hooks/useFetchMetricResourceAttrs';
import { COLORS, getColorFromCSSToken, getMetricTableName } from '@/utils';

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
  onDuplicateSeries: (index: number) => void;
  onSubmit: () => void;
  setValue: UseFormSetValue<ChartEditorFormState>;
  showGroupBy: boolean;
  showHaving: boolean;
  showDuplicate: boolean;
  showColor: boolean;
  tableName: string;
  length: number;
  tableSource?: TSource;
  errors?: FieldErrors<SeriesItem>;
  clearErrors: UseFormClearErrors<ChartEditorFormState>;
  /** Commit URL/query immediately on agg and metric picks (Explore). */
  eagerSubmit?: boolean;
  groupByPlaceholder?: string;
  /** Override letter-badge visibility. Defaults to formula-capable sources. */
  showSeriesRef?: boolean;
  /** When set, the A/B badge inserts this letter into the focused formula. */
  onInsertSeriesRef?: (letter: string) => void;
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
  onDuplicateSeries,
  onSubmit,
  setValue,
  showGroupBy,
  showHaving,
  showDuplicate,
  showColor,
  tableName: _tableName,
  parentRef,
  length,
  tableSource,
  errors,
  clearErrors,
  eagerSubmit = false,
  groupByPlaceholder = 'SQL columns',
  showSeriesRef,
  onInsertSeriesRef,
}: ChartSeriesEditorProps) {
  const aggFn = useWatch({ control, name: `${namePrefix}aggFn` });
  const aggConditionLanguage = useWatch({
    control,
    name: `${namePrefix}aggConditionLanguage`,
    defaultValue: 'lucene',
  });

  const metricType = useWatch({ control, name: `${namePrefix}metricType` });

  // Initialize metricType to 'gauge' when switching to a metric source
  // and reset 'custom' aggFn to 'count' since custom is not supported for metrics
  useEffect(() => {
    if (tableSource?.kind === SourceKind.Metric) {
      if (!metricType) {
        setValue(`${namePrefix}metricType`, MetricsDataType.Gauge);
      }
      if (aggFn === 'none') {
        setValue(`${namePrefix}aggFn`, 'count');
      }
    }
  }, [tableSource?.kind, metricType, aggFn, namePrefix, setValue]);

  // 'increase' aggFn is only valid on Sum metrics. Reset it if the user
  // switches to a different metric type or source kind so the backend does
  // not error on a stale 'increase' selection.
  useEffect(() => {
    const isSumMetric =
      tableSource?.kind === SourceKind.Metric &&
      metricType === MetricsDataType.Sum;
    if (!isSumMetric && aggFn === 'increase') {
      setValue(`${namePrefix}aggFn`, 'sum');
    }
  }, [tableSource?.kind, metricType, aggFn, namePrefix, setValue]);

  // Histogram and exponential histogram metrics only support 'count' and
  // 'quantile' aggregations. Reset any unsupported aggFn to a default, valid one
  useEffect(() => {
    const isHistogramMetric =
      tableSource?.kind === SourceKind.Metric &&
      (metricType === MetricsDataType.Histogram ||
        metricType === MetricsDataType.ExponentialHistogram);
    if (
      isHistogramMetric &&
      !HISTOGRAM_SUPPORTED_AGG_FNS.includes(aggFn ?? '')
    ) {
      setValue(`${namePrefix}aggFn`, 'count');
    }
  }, [tableSource?.kind, metricType, aggFn, namePrefix, setValue]);

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

  const [
    isMetricExplorerOpen,
    { open: openMetricExplorer, close: closeMetricExplorer },
  ] = useDisclosure(false);

  // Applying from the explorer also resets the aggregation, so a metric picked
  // for its own sake charts something meaningful instead of inheriting whatever
  // the previous metric used. The coercion effects above accept every value
  // `defaultAggFnForMetricType` can return.
  const applyExplorerMetric = useCallback(
    ({
      name,
      type,
      where,
      groupBy: stagedGroupBy,
    }: MetricExplorerSelection) => {
      setValue(`${namePrefix}metricName`, name);
      setValue(`${namePrefix}metricType`, type);
      setValue(`${namePrefix}valueExpression`, 'Value');
      const { aggFn: nextAggFn, level } = defaultAggFnForMetricType(type);
      setValue(`${namePrefix}aggFn`, nextAggFn);
      if (level != null) {
        setValue(`${namePrefix}level`, level);
      }

      // Filters were written against this metric's attributes, so they replace
      // the series' condition rather than stacking onto the previous metric's.
      // Unconditionally, including when nothing was staged: leaving the old
      // condition in place would silently apply the previous metric's
      // attributes to the new one, which reads as an empty chart rather than
      // an error (a Map lookup for an absent key yields '', not a failure).
      setValue(`${namePrefix}aggCondition`, where.join(' AND '));

      // Staged group-bys replace the chart's, same as the filters above: they
      // were chosen against this metric's tags. Only when something was staged
      // though — group by is chart-level, so clearing it on every apply would
      // discard a grouping the user set by hand elsewhere.
      if (stagedGroupBy.length > 0) {
        setValue('groupBy', stagedGroupBy.join(', '));
      }

      clearErrors(`${namePrefix}metricName`);
      onSubmit();
    },
    [namePrefix, setValue, clearErrors, onSubmit],
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

  const seriesNumberFormat = useWatch({
    control,
    name: `${namePrefix}numberFormat`,
  });

  const [
    isSeriesNumberFormatOpen,
    { open: openSeriesNumberFormat, close: closeSeriesNumberFormat },
  ] = useDisclosure(false);

  const seriesColor = useWatch({ control, name: `${namePrefix}color` });
  const seriesColorRules = useWatch({
    control,
    name: `${namePrefix}colorRules`,
  });

  const [
    isSeriesColorOpen,
    { open: openSeriesColor, close: closeSeriesColor },
  ] = useDisclosure(false);

  const swatchColor =
    seriesColor && isChartPaletteToken(seriesColor)
      ? getColorFromCSSToken(seriesColor)
      : COLORS[index % COLORS.length];
  const canRemove = (index ?? -1) > 0 || length > 1;
  const seriesRef = indexToSeriesRef(index);
  const showRef =
    (showSeriesRef ?? isFormulaSourceKind(tableSource?.kind)) &&
    seriesRef != null;

  return (
    <>
      <SeriesCard
        index={index}
        color={swatchColor}
        onColorClick={showColor ? openSeriesColor : undefined}
        titleExtra={
          showRef ? (
            <Tooltip
              label={
                onInsertSeriesRef
                  ? 'Insert in formula'
                  : 'Reference this series in a formula by this letter'
              }
            >
              <Badge
                size="sm"
                radius="sm"
                variant="light"
                color="gray"
                data-testid="series-ref-badge"
                {...(onInsertSeriesRef
                  ? {
                      component: 'button' as const,
                      type: 'button' as const,
                      onClick: () => {
                        if (seriesRef != null) {
                          onInsertSeriesRef(seriesRef);
                        }
                      },
                      style: { cursor: 'pointer' },
                    }
                  : {})}
              >
                {seriesRef}
              </Badge>
            </Tooltip>
          ) : undefined
        }
        aliasSlot={
          <SeriesAliasField>
            <div style={{ width: 140 }}>
              <TextInputControlled
                name={`${namePrefix}alias`}
                control={control}
                placeholder="Alias"
                onBlur={() => onSubmit()}
                size="xs"
                data-testid="series-alias-input"
              />
            </div>
          </SeriesAliasField>
        }
        menu={
          <SeriesCardMenu>
            {showDuplicate && (
              <Menu.Item
                leftSection={<IconCopy size={14} />}
                onClick={() => onDuplicateSeries(index)}
                data-testid="series-duplicate-button"
              >
                Duplicate
              </Menu.Item>
            )}
            {(index ?? -1) > 0 && (
              <Menu.Item
                leftSection={<IconArrowUp size={14} />}
                onClick={() => onSwapSeries(index, index - 1)}
              >
                Move up
              </Menu.Item>
            )}
            {(index ?? -1) < length - 1 && (
              <Menu.Item
                leftSection={<IconArrowDown size={14} />}
                onClick={() => onSwapSeries(index, index + 1)}
              >
                Move down
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={FORMAT_ICONS[seriesNumberFormat?.output ?? 'number']}
              onClick={openSeriesNumberFormat}
            >
              Display format
            </Menu.Item>
            {showColor && (
              <Menu.Item
                leftSection={<IconPalette size={14} />}
                onClick={openSeriesColor}
                data-testid="series-color-button"
              >
                Color
              </Menu.Item>
            )}
            {canRemove && (
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => onRemoveSeries(index)}
              >
                Remove series
              </Menu.Item>
            )}
          </SeriesCardMenu>
        }
      >
        <Group gap="xs" align="flex-start" wrap="wrap">
          <Box miw={180} maw={220}>
            <AggFnSelectControlled
              aggFnName={`${namePrefix}aggFn`}
              quantileLevelName={`${namePrefix}level`}
              defaultValue={AGG_FNS[0]?.value ?? 'avg'}
              control={control}
              hideCustom={tableSource?.kind === SourceKind.Metric}
              metricType={
                tableSource?.kind === SourceKind.Metric ? metricType : undefined
              }
              onValueChange={eagerSubmit ? onSubmit : undefined}
            />
          </Box>
          {tableSource?.kind === SourceKind.Metric && metricType && (
            <Box miw={220}>
              <Group gap="xs" wrap="nowrap" align="start">
                <Box flex={1} miw={0}>
                  <MetricNameSelect
                    metricName={metricName}
                    metricType={metricType}
                    setMetricName={value => {
                      setValue(`${namePrefix}metricName`, value);
                      setValue(`${namePrefix}valueExpression`, 'Value');
                      if (eagerSubmit) onSubmit();
                    }}
                    setMetricType={value => {
                      setValue(`${namePrefix}metricType`, value);
                      if (eagerSubmit) onSubmit();
                    }}
                    metricSource={tableSource}
                    dateRange={dateRange}
                    data-testid="metric-name-selector"
                    error={errors?.metricName?.message}
                    onFocus={() => clearErrors(`${namePrefix}metricName`)}
                  />
                </Box>
                <Tooltip label="Browse metrics" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="input-sm"
                    onClick={openMetricExplorer}
                    aria-label="Browse metrics"
                    data-testid="metric-explorer-open"
                  >
                    <IconListSearch size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <MetricExplorerModal
                opened={isMetricExplorerOpen}
                onClose={closeMetricExplorer}
                metricSource={tableSource}
                dateRange={dateRange}
                value={{ metricName, metricType }}
                language={aggConditionLanguage === 'sql' ? 'sql' : 'lucene'}
                onApply={applyExplorerMetric}
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
            </Box>
          )}
          {tableSource?.kind !== SourceKind.Metric && aggFn !== 'count' && (
            <Box
              miw={180}
              style={{ flexGrow: aggFn === 'none' ? 2 : undefined }}
            >
              <SQLInlineEditorControlled
                tableConnection={tableConnection}
                control={control}
                name={`${namePrefix}valueExpression`}
                placeholder="SQL column"
                onSubmit={onSubmit}
                enableVariables
              />
            </Box>
          )}
          {showWhere && (
            <Group
              gap="xs"
              wrap="nowrap"
              align="center"
              style={{ flex: 1, minWidth: 240 }}
            >
              <Text size="xs" c="dimmed">
                Where
              </Text>
              <Box style={{ flex: 1, minWidth: 180 }}>
                <SearchWhereInput
                  tableConnection={tableConnection}
                  sourceId={tableSource?.id}
                  dateRange={dateRange}
                  control={control}
                  name={`${namePrefix}aggCondition`}
                  onSubmit={onSubmit}
                  showLabel={false}
                  size="xs"
                  additionalSuggestions={attributeSuggestions}
                  data-testid="series-where-input"
                  enableVariables
                />
              </Box>
            </Group>
          )}
          {showGroupBy && (
            <Group
              gap="xs"
              wrap="nowrap"
              align="center"
              style={{ flex: 1, minWidth: 200 }}
            >
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                Group by
              </Text>
              <Box style={{ flex: 1, minWidth: 160 }}>
                <SQLInlineEditorControlled
                  parentRef={parentRef}
                  tableConnection={tableConnection}
                  control={control}
                  name={`groupBy`}
                  placeholder={groupByPlaceholder}
                  disableKeywordAutocomplete
                  onSubmit={onSubmit}
                  enableVariables
                />
              </Box>
            </Group>
          )}
          {showHaving && (
            <Group
              gap="xs"
              wrap="nowrap"
              align="center"
              style={{ flex: 1, minWidth: 240 }}
            >
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                Having
              </Text>
              <Box style={{ flex: 1, minWidth: 200 }}>
                <SQLInlineEditorControlled
                  tableConnection={tableConnection}
                  control={control}
                  name="having"
                  placeholder="SQL HAVING clause (ex. count() > 100)"
                  disableKeywordAutocomplete
                  onSubmit={onSubmit}
                  enableVariables
                />
              </Box>
            </Group>
          )}
        </Group>
        {tableSource?.kind === SourceKind.Metric &&
          metricName &&
          metricType && (
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
              onAddToGroupBy={showGroupBy ? handleAddToGroupBy : undefined}
            />
          )}
      </SeriesCard>
      <SeriesNumberFormatDrawer
        opened={isSeriesNumberFormatOpen}
        numberFormat={seriesNumberFormat}
        onChange={format => {
          setValue(`${namePrefix}numberFormat`, format.numberFormat);
          onSubmit();
        }}
        onClose={() => {
          closeSeriesNumberFormat();
        }}
      />
      {showColor && (
        <SeriesColorDrawer
          opened={isSeriesColorOpen}
          color={seriesColor}
          colorRules={seriesColorRules}
          onChange={next => {
            setValue(`${namePrefix}color`, next.color);
            setValue(`${namePrefix}colorRules`, next.colorRules);
            onSubmit();
          }}
          onClose={closeSeriesColor}
        />
      )}
    </>
  );
}
