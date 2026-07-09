import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { add, differenceInSeconds } from 'date-fns';
import {
  convertGranularityToSeconds,
  getAlignedDateRange,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Divider,
  Group,
  Popover,
  Portal,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import {
  IconChartBar,
  IconChartLine,
  IconCheck,
  IconCopy,
  IconFocusCentered,
  IconSearch,
} from '@tabler/icons-react';

import api from '@/api';
import {
  AGG_FNS,
  buildEventsSearchUrl,
  ChartKeyJoiner,
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  getPreviousDateRange,
  PreviousPeriodSuffix,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useChartNumberFormats, useSource } from '@/source';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import DateRangeIndicator from './charts/DateRangeIndicator';
import DisplaySwitcher from './charts/DisplaySwitcher';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

type ActiveClickPayload = {
  x: number;
  y: number;
  activeLabel: string;
  xPerc: number;
  yPerc: number;
  activePayload?: {
    value?: number;
    dataKey?: string;
    name?: string;
    /** Series color from Recharts, matching the legend swatch. */
    color?: string;
  }[];
};

/** A single group column / value pair decoded from a chart series key. */
export type SeriesGroupFilter = { column: string; value: string };

// Decode a Recharts series key (e.g. "count · error · api") into the
// underlying group-column filters. This is the same decode `buildSearchUrl`
// uses to build a drill-down URL, extracted so the focus callback can hand the
// caller structured filters (rather than a display string) to apply to a
// sibling results list.
export function decodeSeriesGroupFilters({
  seriesKey,
  groupColumns,
  valueColumns,
  isSingleValueColumn,
}: {
  seriesKey: string | undefined;
  groupColumns: string[];
  valueColumns: string[];
  isSingleValueColumn: boolean | undefined;
}): SeriesGroupFilter[] {
  const seriesKeys = seriesKey?.split(ChartKeyJoiner);
  const groupFilters: SeriesGroupFilter[] = [];

  if (seriesKeys?.length && groupColumns?.length) {
    // Determine if the first part is a value column name
    const startsWithValueColumn =
      !(isSingleValueColumn ?? true) ||
      ((groupColumns?.length ?? 0) === 0 && (valueColumns?.length ?? 0) > 0);
    const groupValues = startsWithValueColumn
      ? seriesKeys.slice(1)
      : seriesKeys;

    groupValues.forEach((value, index) => {
      if (groupColumns[index] != null) {
        groupFilters.push({ column: groupColumns[index], value });
      }
    });
  }

  return groupFilters;
}

// A single series row in the "Filter by group" list. Shows a color swatch and
// the series name, plus a row of icon actions: drill into the underlying
// events, copy the name, and focus the series on the chart (same as clicking
// its legend item). The swatch mirrors the chart legend so a row stays
// visually tied to its line.
function FilterByGroupRow({
  name,
  dataKey,
  color,
  drillInUrl,
  onDrillIn,
  onFocus,
}: {
  name: string;
  dataKey?: string;
  color?: string;
  drillInUrl: string;
  onDrillIn: () => void;
  onFocus: () => void;
}) {
  const clipboard = useClipboard({ timeout: 1500 });

  return (
    <Group gap={8} wrap="nowrap">
      {color != null && (
        // Same line swatch the legend renders, so the row reads as the same
        // series as its chart line.
        <svg width="12" height="4" style={{ flexShrink: 0 }} aria-hidden>
          <line x1="0" y1="2" x2="12" y2="2" stroke={color} strokeWidth={1.5} />
        </svg>
      )}
      <Text size="xs" truncate flex="1" title={name}>
        {name}
      </Text>
      {/* flexShrink:0 so the action cluster never resizes as the name
          truncates or the copy icon swaps, which would shift the row and
          make the buttons move out from under the cursor mid-click. */}
      <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Tooltip
          label="Drill in (opens new tab)"
          withArrow
          withinPortal
          color="gray"
          position="top"
        >
          <ActionIcon
            component={Link}
            href={drillInUrl}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            variant="subtle"
            size="xs"
            data-testid={`chart-view-events-link-${dataKey}`}
            aria-label="Drill in"
            onClick={onDrillIn}
          >
            <IconSearch size={13} />
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label={clipboard.copied ? 'Copied!' : 'Copy name'}
          withArrow
          withinPortal
          color="gray"
          position="top"
        >
          <ActionIcon
            variant="subtle"
            size="xs"
            aria-label="Copy name"
            data-testid={`chart-copy-name-${dataKey}`}
            onClick={() => clipboard.copy(name)}
          >
            {clipboard.copied ? (
              <IconCheck size={13} />
            ) : (
              <IconCopy size={13} />
            )}
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label="Focus"
          withArrow
          withinPortal
          color="gray"
          position="top"
        >
          <ActionIcon
            variant="subtle"
            size="xs"
            aria-label="Focus"
            data-testid={`chart-focus-series-${dataKey}`}
            onClick={onFocus}
          >
            <IconFocusCentered size={13} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

function ActiveTimeTooltip({
  activeClickPayload,
  buildSearchUrl,
  onDismiss,
  onFocusSeries,
}: {
  activeClickPayload: ActiveClickPayload | undefined;
  buildSearchUrl: (key?: string, value?: number) => string | null;
  onDismiss: () => void;
  /** Focus a series by its raw series key (dataKey) and display name. */
  onFocusSeries: (payload: { dataKey?: string; name: string }) => void;
}) {
  const isOpen =
    activeClickPayload != null &&
    activeClickPayload.activePayload != null &&
    activeClickPayload.activePayload.length > 0;

  if (!isOpen) {
    return null;
  }

  const validPayloads = activeClickPayload
    .activePayload!.filter(
      p =>
        p.value != null &&
        // Exclude previous period series
        // TODO: it would be cool to support this in the future
        !p.dataKey?.endsWith(PreviousPeriodSuffix),
    )
    .sort((a, b) => b.value! - a.value!); // Sort by value descending (highest first)

  return (
    <>
      {/* Backdrop to capture clicks and prevent propagation to chart */}
      <Portal>
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 199, // Just below Mantine Popover default (200)
          }}
          onClick={e => {
            e.stopPropagation();
            e.preventDefault();
            onDismiss();
          }}
          onMouseDown={e => {
            e.stopPropagation();
          }}
        />
      </Portal>

      <Popover
        opened={isOpen}
        onChange={opened => {
          if (!opened) {
            onDismiss();
          }
        }}
        position="bottom-start"
        offset={4}
        withinPortal
        closeOnEscape
        withArrow
        shadow="md"
      >
        <Popover.Target>
          <div
            style={{
              position: 'absolute',
              left: activeClickPayload.x ?? 0,
              top: activeClickPayload.y ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Popover.Target>
        <Popover.Dropdown
          p={8}
          // Fixed width (not maw) so the dropdown never re-measures when a row's
          // content changes (e.g. the copy icon swapping to a check). A
          // content-driven width would make Floating UI reposition the popover
          // mid-interaction, shifting the buttons out from under the cursor.
          w={280}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          <Stack gap={4} style={{ maxHeight: '220px', overflowY: 'auto' }}>
            <Link
              data-testid="chart-view-events-link"
              href={buildSearchUrl() ?? '/search'}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              onClick={onDismiss}
            >
              <Group gap={8} py={2}>
                <IconSearch size={14} />
                <Text size="xs">View All Events</Text>
              </Group>
            </Link>
            {validPayloads.length > 1 && (
              <>
                <Divider my={4} />
                <Text c="gray.5" size="xs">
                  Filter by group:
                </Text>
                {validPayloads.map((payload, idx) => {
                  const seriesUrl = buildSearchUrl(
                    payload.dataKey,
                    payload.value,
                  );
                  const name = payload.name ?? payload.dataKey ?? '';
                  return (
                    <FilterByGroupRow
                      key={idx}
                      name={name}
                      dataKey={payload.dataKey}
                      color={payload.color}
                      drillInUrl={seriesUrl ?? '/search'}
                      onDrillIn={onDismiss}
                      onFocus={() => {
                        onFocusSeries({ dataKey: payload.dataKey, name });
                        onDismiss();
                      }}
                    />
                  );
                })}
              </>
            )}
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </>
  );
}

type DBTimeChartComponentProps = {
  config: ChartConfigWithDateRange;
  disableQueryChunking?: boolean;
  disableDrillDown?: boolean;
  enableParallelQueries?: boolean;
  enabled?: boolean;
  logReferenceTimestamp?: number;
  onSettled?: () => void;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  queryKeyPrefix?: string;
  referenceLines?: React.ReactNode;
  setDisplayType?: (type: DisplayType) => void;
  showDisplaySwitcher?: boolean;
  showLegend?: boolean;
  sourceId?: string;
  /** Names of series that should not be shown in the chart */
  hiddenSeries?: string[];
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
  showDateRangeIndicator?: boolean;
  errorVariant?: ChartErrorStateVariant;
  /**
   * Called when the user clicks "Focus" on a series in the drill-down menu,
   * with the group-column filters decoded from that series. When provided, the
   * consumer owns focus behavior — e.g. the search page applies these as search
   * filters so both the chart AND the sibling results list narrow to the series.
   * When omitted, Focus falls back to a chart-only visual isolation (legend
   * behavior), which is all a standalone chart can do.
   */
  onFocusSeries?: (filters: SeriesGroupFilter[]) => void;
};

function DBTimeChartComponent({
  config,
  disableQueryChunking,
  disableDrillDown,
  enableParallelQueries,
  enabled = true,
  logReferenceTimestamp,
  onTimeRangeSelect,
  queryKeyPrefix,
  referenceLines,
  setDisplayType,
  showDisplaySwitcher = true,
  showLegend = true,
  sourceId,
  hiddenSeries,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  showDateRangeIndicator = true,
  errorVariant,
  onFocusSeries,
}: DBTimeChartComponentProps) {
  const [selectedSeriesSet, setSelectedSeriesSet] = useState<Set<string>>(
    new Set(),
  );

  const handleToggleSeries = useCallback(
    (seriesName: string, isShiftKey?: boolean) => {
      setSelectedSeriesSet(prev => {
        const newSet = new Set(prev);

        if (isShiftKey) {
          // Shift-click: add to selection
          if (newSet.has(seriesName)) {
            newSet.delete(seriesName);
          } else {
            newSet.add(seriesName);
          }
        } else {
          // Regular click: toggle selection
          if (newSet.has(seriesName) && newSet.size === 1) {
            // If this is the only selected item, clear selection (show all)
            newSet.clear();
          } else {
            // Otherwise, select only this one
            newSet.clear();
            newSet.add(seriesName);
          }
        }

        return newSet;
      });
    },
    [],
  );

  const originalDateRange = config.dateRange;
  const {
    displayType: displayTypeProp,
    dateRange,
    granularity,
    fillNulls,
  } = useTimeChartSettings(config);

  const { data: me, isLoading: isLoadingMe } = api.useMe();

  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(config),
    [config],
  );

  // Determine whether the config can be optimized with an MV, to determine whether
  // to show the MV optimization indicator and date range indicator in the toolbar
  const builderQueriedConfig: BuilderChartConfigWithDateRange | undefined =
    isBuilderChartConfig(queriedConfig) ? queriedConfig : undefined;
  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(builderQueriedConfig);

  const { data, isLoading, isError, error, isPlaceholderData, isSuccess } =
    useQueriedChartConfig(queriedConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [
        queryKeyPrefix,
        queriedConfig,
        'chunked',
        {
          disableQueryChunking,
          enableParallelQueries,
          parallelizeWhenPossible: me?.team?.parallelizeWhenPossible,
        },
      ],
      enabled: enabled && !isLoadingMe,
      enableQueryChunking: !disableQueryChunking,
      enableParallelQueries:
        enableParallelQueries && me?.team?.parallelizeWhenPossible,
    });

  const previousPeriodChartConfig: ChartConfigWithDateRange = useMemo(() => {
    const previousPeriodDateRange =
      queriedConfig.alignDateRangeToGranularity === false
        ? getPreviousDateRange(originalDateRange)
        : getAlignedDateRange(
            getPreviousDateRange(originalDateRange),
            granularity,
          );

    return {
      ...queriedConfig,
      dateRange: previousPeriodDateRange,
    };
  }, [queriedConfig, originalDateRange, granularity]);

  const previousPeriodOffsetSeconds = useMemo(() => {
    return config.compareToPreviousPeriod
      ? differenceInSeconds(
          dateRange[0],
          previousPeriodChartConfig.dateRange[0],
        )
      : undefined;
  }, [
    config.compareToPreviousPeriod,
    dateRange,
    previousPeriodChartConfig.dateRange,
  ]);

  const { data: previousPeriodData, isLoading: isPreviousPeriodLoading } =
    useQueriedChartConfig(previousPeriodChartConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, previousPeriodChartConfig, 'chunked'],
      enabled: !!(enabled && config.compareToPreviousPeriod),
      enableQueryChunking: true,
    });

  const isLoadingOrPlaceholder =
    isLoading ||
    isPreviousPeriodLoading ||
    !data?.isComplete ||
    (config.compareToPreviousPeriod && !previousPeriodData?.isComplete) ||
    isPlaceholderData;

  const { data: source } = useSource({
    id: sourceId || config.source,
  });

  const { formatByColumn, chartFormat: axisNumberFormat } =
    useChartNumberFormats(queriedConfig, data?.meta);

  const {
    error: resultFormattingError,
    graphResults,
    timestampColumn,
    groupColumns,
    valueColumns,
    isSingleValueColumn,
    lineData,
  } = useMemo(() => {
    const defaultResponse = {
      error: null,
      graphResults: [],
      timestampColumn: undefined,
      lineData: [],
      groupColumns: [],
      valueColumns: [],
      isSingleValueColumn: true,
    };

    if (data == null || !isSuccess) {
      return defaultResponse;
    }

    try {
      const formatResult = formatResponseForTimeChart({
        currentPeriodResponse: data,
        previousPeriodResponse: config.compareToPreviousPeriod
          ? previousPeriodData
          : undefined,
        dateRange,
        granularity,
        generateEmptyBuckets: shouldFillNullsWithZero(fillNulls),
        source,
        hiddenSeries,
        previousPeriodOffsetSeconds,
      });
      return {
        ...defaultResponse,
        ...formatResult,
      };
    } catch (e: unknown) {
      console.error(e);
      return {
        ...defaultResponse,
        error: e,
      };
    }
  }, [
    data,
    dateRange,
    granularity,
    isSuccess,
    fillNulls,
    source,
    config.compareToPreviousPeriod,
    previousPeriodData,
    hiddenSeries,
    previousPeriodOffsetSeconds,
  ]);

  // To enable backward compatibility, allow non-controlled usage of displayType
  const [displayTypeLocal, setDisplayTypeLocal] = useState(displayTypeProp);

  const displayType = useMemo(() => {
    if (setDisplayType) {
      return displayTypeProp;
    } else {
      return displayTypeLocal;
    }
  }, [displayTypeLocal, displayTypeProp, setDisplayType]);

  const handleSetDisplayType = useCallback(
    (type: DisplayType) => {
      if (setDisplayType) {
        setDisplayType(type);
      } else {
        setDisplayTypeLocal(type);
      }
    },
    [setDisplayType],
  );

  useEffect(() => {
    if (config.compareToPreviousPeriod) {
      setDisplayTypeLocal(DisplayType.Line);
    }
  }, [config.compareToPreviousPeriod]);

  const [activeClickPayload, setActiveClickPayload] = useState<
    ActiveClickPayload | undefined
  >(undefined);

  // Wrap the setter to only allow setting if source is available
  const setActiveClickPayloadIfSourceAvailable = useCallback(
    (payload: ActiveClickPayload | undefined) => {
      if (source == null || disableDrillDown) {
        return; // Don't set if no source
      }
      setActiveClickPayload(payload);
    },
    [source, disableDrillDown],
  );

  const clickedActiveLabelDate = useMemo(() => {
    return activeClickPayload?.activeLabel != null
      ? new Date(Number.parseInt(activeClickPayload.activeLabel) * 1000)
      : undefined;
  }, [activeClickPayload]);

  const buildSearchUrl = useCallback(
    (seriesKey?: string, seriesValue?: number) => {
      // Raw SQL charts are not supported for drill-down as we don't know the source which is being used.
      if (
        clickedActiveLabelDate == null ||
        source == null ||
        isRawSqlChartConfig(config) ||
        isPromqlChartConfig(config)
      ) {
        return null;
      }

      // Parse the series key to extract group values
      const seriesKeys = seriesKey?.split(ChartKeyJoiner);
      const groupFilters = decodeSeriesGroupFilters({
        seriesKey,
        groupColumns,
        valueColumns,
        isSingleValueColumn,
      });

      // Build value range filter for Y-axis if provided
      let valueRangeFilter:
        | {
            expression: string;
            value: number;
          }
        | undefined;

      if (
        seriesValue &&
        Array.isArray(config.select) &&
        config.select.length > 0
      ) {
        // Determine which value column to filter on
        let valueExpression: string | undefined;

        if ((isSingleValueColumn ?? true) && config.select.length === 1) {
          const firstSelect = config.select[0];
          const aggFn =
            typeof firstSelect === 'string' ? undefined : firstSelect.aggFn;
          // Only add value range filter if the aggregation is attributable
          const isAttributable =
            AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

          if (isAttributable) {
            valueExpression =
              typeof firstSelect === 'string'
                ? firstSelect
                : firstSelect.valueExpression;
          }
        } else if (seriesKeys?.length && (valueColumns?.length ?? 0) > 0) {
          const firstPart = seriesKeys[0];
          const valueColumnIndex = valueColumns?.findIndex(
            col => col === firstPart,
          );

          if (
            valueColumnIndex != null &&
            valueColumnIndex >= 0 &&
            valueColumnIndex < config.select.length
          ) {
            const selectItem = config.select[valueColumnIndex];
            const aggFn =
              typeof selectItem === 'string' ? undefined : selectItem.aggFn;
            // Only add value range filter if the aggregation is attributable
            const isAttributable =
              AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

            if (isAttributable) {
              valueExpression =
                typeof selectItem === 'string'
                  ? selectItem
                  : selectItem.valueExpression;
            }
          }
        }

        if (valueExpression) {
          valueRangeFilter = {
            expression: valueExpression,
            value: seriesValue,
          };
        }
      }

      // Calculate time range from clicked date and granularity
      const from = clickedActiveLabelDate;
      const to = add(clickedActiveLabelDate, {
        seconds: convertGranularityToSeconds(granularity),
      });

      return buildEventsSearchUrl({
        source,
        config,
        dateRange: [from, to],
        groupFilters,
        valueRangeFilter,
      });
    },
    [
      clickedActiveLabelDate,
      config,
      granularity,
      source,
      groupColumns,
      valueColumns,
      isSingleValueColumn,
    ],
  );

  // Focus a series from the drill-down menu. When the consumer supplied an
  // onFocusSeries handler, decode the series into its group-column filters and
  // hand them up so the consumer can narrow both the chart and any sibling
  // results list. Otherwise fall back to chart-only visual isolation, which is
  // the best a standalone chart (e.g. a dashboard tile) can do.
  const handleFocusSeries = useCallback(
    ({ dataKey, name }: { dataKey?: string; name: string }) => {
      if (onFocusSeries) {
        const groupFilters = decodeSeriesGroupFilters({
          seriesKey: dataKey,
          groupColumns,
          valueColumns,
          isSingleValueColumn,
        });
        if (groupFilters.length > 0) {
          onFocusSeries(groupFilters);
          return;
        }
      }
      handleToggleSeries(name);
    },
    [
      onFocusSeries,
      groupColumns,
      valueColumns,
      isSingleValueColumn,
      handleToggleSeries,
    ],
  );

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator && builderQueriedConfig) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-time-chart-mv-indicator"
          config={builderQueriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const mvDateRange = mvOptimizationData?.optimizedConfig?.dateRange;
    const isAlignedToChartGranularity =
      queriedConfig.alignDateRangeToGranularity !== false;

    if (
      showDateRangeIndicator &&
      (mvDateRange || isAlignedToChartGranularity)
    ) {
      const mvGranularity = isAlignedToChartGranularity
        ? undefined
        : mvOptimizationData?.explanations.find(e => e.success)?.mvConfig
            .minGranularity;

      allToolbarItems.push(
        <DateRangeIndicator
          key="db-time-chart-date-range-indicator"
          originalDateRange={config.dateRange}
          effectiveDateRange={mvDateRange || queriedConfig.dateRange}
          mvGranularity={mvGranularity}
        />,
      );
    }

    if (showDisplaySwitcher) {
      allToolbarItems.push(
        <DisplaySwitcher
          key="db-time-chart-display-switcher"
          value={displayType}
          onChange={handleSetDisplayType}
          options={[
            {
              value: DisplayType.Line,
              label: 'Display as Line Chart',
              icon: <IconChartLine />,
            },
            {
              value: DisplayType.StackedBar,
              label: config.compareToPreviousPeriod
                ? 'Bar Chart Unavailable When Comparing to Previous Period'
                : 'Display as Bar Chart',
              icon: <IconChartBar />,
              disabled: config.compareToPreviousPeriod,
            },
          ]}
        />,
      );
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    builderQueriedConfig,
    config,
    displayType,
    handleSetDisplayType,
    showDisplaySwitcher,
    source,
    toolbarPrefix,
    toolbarSuffix,
    showMVOptimizationIndicator,
    showDateRangeIndicator,
    mvOptimizationData,
    queriedConfig,
  ]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : resultFormattingError ? (
        <ChartErrorState
          variant={errorVariant}
          error={
            resultFormattingError instanceof Error
              ? resultFormattingError
              : new Error(String(resultFormattingError))
          }
        />
      ) : graphResults.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <>
          <ActiveTimeTooltip
            activeClickPayload={activeClickPayload}
            buildSearchUrl={buildSearchUrl}
            onDismiss={() => setActiveClickPayload(undefined)}
            onFocusSeries={handleFocusSeries}
          />
          <MemoChart
            dateRange={dateRange}
            displayType={displayType}
            graphResults={graphResults}
            isClickActive={activeClickPayload}
            lineData={lineData}
            isLoading={isLoadingOrPlaceholder}
            logReferenceTimestamp={logReferenceTimestamp}
            fallbackNumberFormat={queriedConfig.numberFormat}
            axisNumberFormat={axisNumberFormat}
            tooltipNumberFormatsByKey={formatByColumn}
            onTimeRangeSelect={onTimeRangeSelect}
            referenceLines={referenceLines}
            setIsClickActive={setActiveClickPayloadIfSourceAvailable}
            showLegend={showLegend}
            timestampKey={timestampColumn?.name}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
            selectedSeriesNames={selectedSeriesSet}
            onToggleSeries={handleToggleSeries}
            granularity={granularity}
            dateRangeEndInclusive={queriedConfig.dateRangeEndInclusive}
            fitYAxisToData={queriedConfig.fitYAxisToData}
          />
        </>
      )}
    </ChartContainer>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
