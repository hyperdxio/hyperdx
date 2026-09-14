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
  BuilderChartConfigWithDateRange,
  DateRange,
  Filter,
  isChartPaletteToken,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Box,
  Button,
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
import { SeriesColumnPicker } from '@/components/DBEditTimeChartForm/SeriesColumnPicker';
import {
  formatGroupByFields,
  parseGroupByFields,
} from '@/components/Explore/exploreGroupBy';
import { ExploreQueryEditor } from '@/components/Explore/ExploreQueryEditor';
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
import { useSearchPageFilterState } from '@/searchFilters';
import { COLORS, getColorFromCSSToken, getMetricTableName } from '@/utils';

type SeriesItem = NonNullable<
  SavedChartConfigWithSelectArray['select']
>[number];

const NO_KNOWN_COLUMNS: Set<string> = new Set();

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * AND clauses onto an existing condition, skipping any already in it. The
 * duplicate check is a substring match rather than a parse: the condition is
 * free text in either SQL or Lucene, and the only clauses compared against it
 * are generated ones, which are reproduced verbatim.
 */
function appendWhereClauses(current: string, clauses: string[]) {
  return clauses
    .filter(Boolean)
    .reduce(
      (acc, clause) =>
        acc.includes(clause) ? acc : acc ? `${acc} AND ${clause}` : clause,
      current.trim(),
    );
}

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
  /**
   * Whether the chart has a group by at all, as opposed to this card being the
   * place that edits it. Explore keeps the input in its toolbar, so the metric
   * helper's "add to group by" must not disappear along with the input.
   * Defaults to `showGroupBy` for callers that render both together.
   */
  canGroupBy?: boolean;
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
  /**
   * The chart-level WHERE clause, when the page has one. A series condition is
   * ANDed with it, so the label says so rather than offering a second,
   * identically-named "Where" whose precedence the reader has to guess.
   */
  sharedWhere?: string;
  /**
   * Filter the series with Explore's query editor — the same SQL field as the
   * page query bar — instead of `SearchWhereInput`. Explore is SQL-only, so its
   * series have no use for the Lucene/SQL switch, and one filter field across
   * the page beats two that look and behave differently. Dashboard tiles keep
   * `SearchWhereInput`: they still author Lucene and `$variable` references,
   * neither of which the query editor speaks.
   */
  useQueryEditor?: boolean;
  /**
   * Chart config the series' filter pills read to offer and format values.
   * Without it the editor still promotes clauses, but renders no pills.
   */
  filtersChartConfig?: BuilderChartConfigWithDateRange;
  /** Top-level columns, used to quote pill keys that need escaping. */
  knownColumns?: Set<string>;
  dateTimeColumns?: ReadonlyMap<string, string>;
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
  canGroupBy = showGroupBy,
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
  sharedWhere,
  useQueryEditor = false,
  filtersChartConfig,
  knownColumns,
  dateTimeColumns,
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
  // `useWatch` widens these paths to every field they could match, which
  // includes the series array itself. Narrowed once so the readers below get
  // the string each path actually resolves to.
  const watchedAggCondition = useWatch({
    control,
    name: `${namePrefix}aggCondition`,
  });
  const watchedGroupBy = useWatch({ control, name: 'groupBy' });
  const aggCondition = asText(watchedAggCondition);
  const groupBy = asText(watchedGroupBy);

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

  const seriesFilters = useWatch({
    control,
    name: `${namePrefix}filters`,
  });

  const handleSeriesFiltersChange = useCallback(
    (next: Filter[]) => {
      setValue(`${namePrefix}filters`, next);
      onSubmit();
    },
    [namePrefix, setValue, onSubmit],
  );

  const seriesFilterState = useSearchPageFilterState({
    searchQuery: seriesFilters,
    onFilterChange: handleSeriesFiltersChange,
    dateTimeColumns,
    knownColumns: knownColumns ?? NO_KNOWN_COLUMNS,
  });

  const handleAddToWhere = useCallback(
    (clause: string) => {
      setValue(
        `${namePrefix}aggCondition`,
        appendWhereClauses(aggCondition, [clause]),
      );
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
    ({ name, type, groupBy: stagedGroupBy }: MetricExplorerSelection) => {
      const isSwap = name !== metricName || type !== metricType;

      setValue(`${namePrefix}metricName`, name);
      setValue(`${namePrefix}metricType`, type);
      setValue(`${namePrefix}valueExpression`, 'Value');
      const { aggFn: nextAggFn, level } = defaultAggFnForMetricType(type);
      setValue(`${namePrefix}aggFn`, nextAggFn);
      if (level != null) {
        setValue(`${namePrefix}level`, level);
      }

      // Swapping the metric invalidates whatever was filtering the old one:
      // its attributes do not exist on the new metric, and a Map lookup for an
      // absent key yields '' rather than failing, so a stale condition charts
      // nothing instead of erroring. Re-picking the metric already on the
      // series is an edit rather than a swap, so its condition still holds.
      if (isSwap) {
        setValue(`${namePrefix}aggCondition`, '');
      }

      // Group by is chart-level, so a clear here would discard a grouping set
      // elsewhere on the page — only written when something was staged.
      if (stagedGroupBy.length > 0) {
        setValue(
          'groupBy',
          formatGroupByFields(
            isSwap
              ? stagedGroupBy
              : [
                  ...new Set([
                    ...parseGroupByFields(groupBy),
                    ...stagedGroupBy,
                  ]),
                ],
          ),
        );
      }

      clearErrors(`${namePrefix}metricName`);
      onSubmit();
    },
    [
      namePrefix,
      metricName,
      metricType,
      groupBy,
      setValue,
      clearErrors,
      onSubmit,
    ],
  );

  const handleAddToGroupBy = useCallback(
    (clause: string) => {
      const newValue = groupBy ? `${groupBy}, ${clause}` : clause;
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
            <>
              <Box miw={220}>
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
              {/*
                A peer of the metric field rather than an addon on it: applying
                also rewrites the aggregation, the series condition and the
                chart's group by, which a control drawn into the field's frame
                reads as scoped to that one value. Labelled rather than an icon
                because browsing is how a metric is found when its name is not
                already known, not an advanced escape hatch.
              */}
              <Button
                variant="secondary"
                size="sm"
                leftSection={<IconListSearch size={16} />}
                onClick={openMetricExplorer}
                data-testid="metric-explorer-open"
              >
                Browse metrics
              </Button>
              <MetricExplorerModal
                opened={isMetricExplorerOpen}
                onClose={closeMetricExplorer}
                metricSource={tableSource}
                dateRange={dateRange}
                value={{ metricName, metricType }}
                currentWhere={aggCondition}
                currentGroupBy={groupBy}
                onApply={applyExplorerMetric}
              />
            </>
          )}
          {tableSource?.kind !== SourceKind.Metric &&
            aggFn !== 'count' &&
            // Custom is an expression by definition — there is no column to
            // pick, so it keeps the editor.
            (aggFn === 'none' ? (
              <Box miw={180} style={{ flexGrow: 2 }}>
                <SQLInlineEditorControlled
                  tableConnection={tableConnection}
                  control={control}
                  name={`${namePrefix}valueExpression`}
                  placeholder="SQL expression"
                  onSubmit={onSubmit}
                  enableVariables
                />
              </Box>
            ) : (
              <SeriesColumnPicker
                control={control}
                name={`${namePrefix}valueExpression`}
                aggFn={aggFn}
                tableSource={tableSource}
                dateRange={dateRange}
                onSubmit={onSubmit}
              />
            ))}
          {showWhere && (
            <Group
              gap="xs"
              wrap="nowrap"
              align="center"
              style={{ flex: 1, minWidth: 240 }}
            >
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {sharedWhere?.trim() ? 'And where' : 'Where'}
              </Text>
              <Box style={{ flex: 1, minWidth: 180 }}>
                {useQueryEditor ? (
                  <ExploreQueryEditor
                    tableConnection={tableConnection}
                    sourceId={tableSource?.id}
                    dateRange={dateRange}
                    control={control}
                    name={`${namePrefix}aggCondition`}
                    languageName={`${namePrefix}aggConditionLanguage`}
                    onSubmit={onSubmit}
                    additionalSuggestions={attributeSuggestions}
                    placeholder="Filter this series"
                    searchFilters={seriesFilterState}
                    chartConfig={filtersChartConfig}
                    dateTimeColumns={dateTimeColumns}
                    containerTestId="series-query-editor"
                    data-testid="series-where-input"
                  />
                ) : (
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
                )}
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
              onAddToGroupBy={canGroupBy ? handleAddToGroupBy : undefined}
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
