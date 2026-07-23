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
  isMetricsV2Tables,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Flex,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconTrash,
} from '@tabler/icons-react';

import { AGG_FNS } from '@/ChartUtils';
import {
  AggFnSelectControlled,
  getMetricV2DefaultAggFn,
  isMetricV2AggFnAllowed,
  SumMonotonicity,
} from '@/components/AggFnSelect';
import {
  ChartEditorFormState,
  SavedChartConfigWithSelectArray,
} from '@/components/ChartEditor/types';
import {
  CheckBoxControlled,
  TextInputControlled,
} from '@/components/InputControlled';
import {
  mergeTokenLookupIntoCondition,
  MetricAttributeHelperPanel,
} from '@/components/MetricAttributeHelperPanel';
import { MetricNameSelect } from '@/components/MetricNameSelect';
import { FORMAT_ICONS } from '@/components/NumberFormat';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import SeriesNumberFormatDrawer from '@/components/SeriesNumberFormatDrawer';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import {
  useFetchMetricMetadata,
  useMetricSeriesProfile,
} from '@/hooks/useFetchMetricMetadata';
import {
  parseAttributeKeysFromSuggestions,
  useFetchMetricResourceAttrs,
} from '@/hooks/useFetchMetricResourceAttrs';
import { useColumns } from '@/hooks/useMetadata';
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
  onDuplicateSeries: (index: number) => void;
  onSubmit: () => void;
  setValue: UseFormSetValue<ChartEditorFormState>;
  showGroupBy: boolean;
  showHaving: boolean;
  showDuplicate: boolean;
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
  onDuplicateSeries,
  onSubmit,
  setValue,
  showGroupBy,
  showHaving,
  showDuplicate,
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

  // Reset a stale selection to the type's primary aggregate (pXX presets
  // decompose into quantile + level). Shared by the guard effect and the
  // eager reset on metric switch so every reset path lands on a LEGAL
  // value — a hardcoded 'sum' fallback used to reach the translator on
  // exp-histograms ("sum is not supported for exponential histograms").
  const applyDefaultAggFn = useCallback(
    (type: MetricsDataType, regime: SumMonotonicity) => {
      const fallback = getMetricV2DefaultAggFn(type, regime);
      if (/^p\d+$/.test(fallback)) {
        setValue(
          `${namePrefix}level`,
          Number.parseFloat(fallback.replace('p', '0.')),
        );
        setValue(`${namePrefix}aggFn`, 'quantile');
      } else {
        setValue(`${namePrefix}aggFn`, fallback);
      }
    },
    [namePrefix, setValue],
  );

  // Token-lookup filters need the v2 series table's *AttributeItems ALIAS
  // columns — detect their presence so older databases keep the plain map
  // equality clause.
  const isV2Source =
    tableSource?.kind === SourceKind.Metric &&
    isMetricsV2Tables(tableSource.metricTables);

  // 'increase' aggFn is only valid on Sum metrics. Reset it if the user
  // switches to a different metric type or source kind so the backend does
  // not error on a stale 'increase' selection.
  useEffect(() => {
    const isSumMetric =
      tableSource?.kind === SourceKind.Metric &&
      metricType === MetricsDataType.Sum;
    if (!isSumMetric && aggFn === 'increase') {
      if (isV2Source && metricType) {
        applyDefaultAggFn(metricType, 'unknown');
      } else {
        setValue(`${namePrefix}aggFn`, 'sum');
      }
    }
  }, [
    tableSource?.kind,
    metricType,
    aggFn,
    namePrefix,
    setValue,
    isV2Source,
    applyDefaultAggFn,
  ]);

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
      dateRange,
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

  // Temporality/monotonicity profile — the same cached lookup the query
  // translator uses, so this adds no per-query latency. Sum-typed metrics
  // branch the aggregate list on IsMonotonic (counter vs UpDownCounter).
  const { data: seriesProfile, isLoading: isProfileLoading } =
    useMetricSeriesProfile({
      databaseName,
      metricType,
      metricName,
      tableSource: metricTableSource,
      dateRange,
    });
  // 'updown' (level treatment) requires cumulative + IsMonotonic=false —
  // the EXACT condition the translator's level-style select uses. A delta
  // non-monotonic sum (legal in OTLP) is net-change flux, which the
  // translator renders as per-second Rate → counter treatment here so the
  // labels match the query.
  const sumMonotonicity: SumMonotonicity =
    metricType !== MetricsDataType.Sum
      ? 'unknown'
      : seriesProfile?.temporality === 'cumulative' &&
          seriesProfile.isMonotonic === false
        ? 'updown'
        : seriesProfile?.temporality != null &&
            (seriesProfile.isMonotonic === true ||
              (seriesProfile.temporality === 'delta' &&
                seriesProfile.isMonotonic === false))
          ? 'monotonic'
          : 'unknown';

  // §4: v2 metric types gate the aggregate list (see AggFnSelect) — reset a
  // stale selection that is illegal for the (new) metric type/regime to the
  // type's primary aggregate so the translator never sees it.
  const quantileLevel = useWatch({ control, name: `${namePrefix}level` });
  useEffect(() => {
    if (!isV2Source || !metricType) {
      return;
    }
    // A missing aggFn is illegal in every regime — fix it without waiting
    // (the translator renders it as literally "undefined is not supported").
    if (aggFn == null) {
      applyDefaultAggFn(metricType, sumMonotonicity);
      return;
    }
    // Only the Sum list branches on monotonicity, so only Sum waits for the
    // profile (a still-loading regime could transiently reset a legitimate
    // selection). Gating every type on the profile left a window where a
    // stale aggFn reached the translator ("avg is not supported for
    // exponential histograms").
    if (metricType === MetricsDataType.Sum && isProfileLoading) {
      return;
    }
    if (
      !isMetricV2AggFnAllowed(metricType, aggFn, quantileLevel, sumMonotonicity)
    ) {
      applyDefaultAggFn(metricType, sumMonotonicity);
    }
  }, [
    isV2Source,
    metricType,
    aggFn,
    quantileLevel,
    sumMonotonicity,
    isProfileLoading,
    applyDefaultAggFn,
  ]);

  // Type badge: which aggregation regime the user is in, visible before
  // picking a function.
  const metricTypeBadge = !metricName
    ? undefined
    : metricType === MetricsDataType.Sum
      ? sumMonotonicity === 'monotonic'
        ? { label: 'counter', color: 'teal' }
        : sumMonotonicity === 'updown'
          ? { label: 'up/down', color: 'grape' }
          : isProfileLoading
            ? undefined
            : { label: 'sum · unresolved', color: 'gray' }
      : metricType === MetricsDataType.Gauge
        ? { label: 'gauge', color: 'blue' }
        : metricType === MetricsDataType.Histogram
          ? { label: 'histogram', color: 'cyan' }
          : metricType === MetricsDataType.ExponentialHistogram
            ? { label: 'exp histogram', color: 'cyan' }
            : metricType === MetricsDataType.Summary
              ? { label: 'summary', color: 'indigo' }
              : undefined;
  const seriesTableName = isV2Source
    ? (metricTableSource?.metricTables?.series ?? '')
    : '';
  const { data: seriesColumns } = useColumns({
    databaseName,
    tableName: seriesTableName,
    connectionId: connectionId ?? metricTableSource?.connection ?? '',
  });
  const useTokenLookup =
    isV2Source &&
    (seriesColumns ?? []).some(c => c.name.endsWith('AttributeItems'));

  const handleAddToWhere = useCallback(
    (clause: string) => {
      const currentValue = aggCondition || '';

      // Successive token-lookup clauses on the same Items column merge into
      // one hasAllTokens call (AND semantics, single index lookup).
      const newValue =
        mergeTokenLookupIntoCondition(currentValue, clause) ??
        (currentValue ? `${currentValue} AND ${clause}` : clause);
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

  const seriesNumberFormat = useWatch({
    control,
    name: `${namePrefix}numberFormat`,
  });

  const [
    isSeriesNumberFormatOpen,
    { open: openSeriesNumberFormat, close: closeSeriesNumberFormat },
  ] = useDisclosure(false);

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
            {showDuplicate && (
              <Button
                variant="subtle"
                color="gray"
                size="xxs"
                onClick={() => onDuplicateSeries(index)}
                title="Duplicate series"
                data-testid="series-duplicate-button"
              >
                <IconCopy size={14} />
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
            <Tooltip label="Edit series display format">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="xs"
                onClick={openSeriesNumberFormat}
                aria-label="Edit series display format"
              >
                {FORMAT_ICONS[seriesNumberFormat?.output ?? 'number']}
              </ActionIcon>
            </Tooltip>
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
            hideCustom={tableSource?.kind === SourceKind.Metric}
            metricType={
              tableSource?.kind === SourceKind.Metric ? metricType : undefined
            }
            metricsV2={isV2Source}
            sumMonotonicity={sumMonotonicity}
          />
        </div>
        {tableSource?.kind === SourceKind.Metric && metricType && (
          <div style={{ minWidth: 220 }}>
            <MetricNameSelect
              metricName={metricName}
              metricType={metricType}
              setMetricName={value => {
                setValue(`${namePrefix}metricName`, value);
                setValue(`${namePrefix}valueExpression`, 'Value');
              }}
              setMetricType={value => {
                setValue(`${namePrefix}metricType`, value);
                // Eager reset in the SAME event as the type change: the
                // guard effect runs a render later, and the form can submit
                // the stale (type, aggFn) pair in between — the transient
                // "<aggFn> is not supported for ..." chart error. The
                // 'unknown' regime is the pre-profile superset for Sum.
                if (
                  isV2Source &&
                  value &&
                  (aggFn == null ||
                    !isMetricV2AggFnAllowed(
                      value,
                      aggFn,
                      quantileLevel,
                      'unknown',
                    ))
                ) {
                  applyDefaultAggFn(value, 'unknown');
                }
              }}
              metricSource={tableSource}
              data-testid="metric-name-selector"
              error={errors?.metricName?.message}
              onFocus={() => clearErrors(`${namePrefix}metricName`)}
            />
            <Flex justify="space-between" align="center">
              {isV2Source && metricTypeBadge ? (
                <Badge
                  size="xs"
                  variant="light"
                  color={metricTypeBadge.color}
                  className="mt-2"
                  data-testid="metric-type-badge"
                >
                  {metricTypeBadge.label}
                </Badge>
              ) : (
                <div />
              )}
              {metricType === 'gauge' && (
                <CheckBoxControlled
                  control={control}
                  name={`${namePrefix}isDelta`}
                  label="Delta"
                  size="xs"
                  className="mt-2"
                />
              )}
            </Flex>
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
          onAddToGroupBy={showGroupBy ? handleAddToGroupBy : undefined}
          dateRange={dateRange}
          useTokenLookup={useTokenLookup}
        />
      )}
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
    </>
  );
}
