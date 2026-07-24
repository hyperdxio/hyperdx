import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import Router from 'next/router';
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
  Exemplar,
} from '@hyperdx/common-utils/dist/types';
import { Popover, Portal } from '@mantine/core';
import { IconChartBar, IconChartLine } from '@tabler/icons-react';

import api from '@/api';
import {
  AGG_FNS,
  buildEventsSearchUrl,
  ChartKeyJoiner,
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  getPreviousDateRange,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import { ChartSeriesTooltip } from '@/components/charts/ChartSeriesTooltip';
import { useChartTooltipZIndex } from '@/components/charts/ChartTooltip';
import { ExemplarHoverCard } from '@/components/Exemplars';
import { DEFAULT_MAX_EXEMPLARS } from '@/defaults';
import { type ActiveClickPayload, MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useExemplars, useExemplarTraceMeta } from '@/hooks/useExemplars';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useChartNumberFormats, useSource } from '@/source';
import type { NumberFormat } from '@/types';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import DateRangeIndicator from './charts/DateRangeIndicator';
import DisplaySwitcher from './charts/DisplaySwitcher';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

/** A single group column / value pair decoded from a chart series key. */
export type SeriesGroupFilter = { column: string; value: string };

// Only one pinned tooltip at a time across all charts. Module-level (not
// context) because charts can be scattered with no common provider, and their
// onClick stopPropagation hides cross-chart clicks from Mantine's click-outside.
const pinnedTooltipRegistry = new Map<string, () => void>();

function broadcastTooltipPinned(activeId: string) {
  pinnedTooltipRegistry.forEach((dismiss, id) => {
    if (id !== activeId) {
      dismiss();
    }
  });
}

// Registers this chart's dismiss handler and returns a callback to close every
// other chart's pinned tooltip (call it when pinning this one).
function useCrossChartPinDismiss(onDismiss: () => void): () => void {
  const id = useId();
  // Keep the latest onDismiss without re-subscribing each render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    pinnedTooltipRegistry.set(id, () => onDismissRef.current());
    return () => {
      pinnedTooltipRegistry.delete(id);
    };
  }, [id]);

  return useCallback(() => broadcastTooltipPinned(id), [id]);
}

// Decode a Recharts series key (e.g. "count · error · api") into the
// underlying group-column filters. This is the same decode `buildSearchUrl`
// uses to build a drill-down URL, extracted so the focus callback can hand the
// caller structured filters (rather than a display string) to apply to a
// sibling results list.
export function decodeSeriesGroupFilters({
  seriesKey,
  groupColumns,
  isSingleValueColumn,
}: {
  seriesKey: string | undefined;
  groupColumns: string[];
  isSingleValueColumn: boolean | undefined;
}): SeriesGroupFilter[] {
  const seriesKeys = seriesKey?.split(ChartKeyJoiner);
  const groupFilters: SeriesGroupFilter[] = [];

  if (seriesKeys?.length && groupColumns?.length) {
    // When the series has multiple value columns, the key is prefixed with the
    // value column name (e.g. "count · error"), so the group values start at
    // index 1. (The "no group columns" case the original inline code also
    // guarded is impossible here — this block only runs when groupColumns is
    // non-empty.)
    const startsWithValueColumn = !(isSingleValueColumn ?? true);
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

// The interactive PINNED tooltip, rendered over the chart in a body-portaled
// Mantine Popover anchored at the clicked point. Hover uses the recharts tooltip
// in MemoChart instead; this is only for the click-locked state.
function ChartTooltipOverlay({
  payload,
  buildSearchUrl,
  onDismiss,
  onFocusSeries,
  fallbackNumberFormat,
  numberFormatByKey,
  previousPeriodOffsetSeconds,
}: {
  payload: ActiveClickPayload | undefined;
  buildSearchUrl: (key?: string, value?: number) => string | null;
  onDismiss: () => void;
  /** Focus a series by its raw series key (dataKey) and display name. */
  onFocusSeries: (payload: { dataKey?: string; name: string }) => void;
  fallbackNumberFormat?: NumberFormat;
  /** Per-value-column formats, keyed by result column name. */
  numberFormatByKey: Map<string, NumberFormat>;
  previousPeriodOffsetSeconds?: number;
}) {
  const isOpen =
    payload != null &&
    payload.activePayload != null &&
    payload.activePayload.length > 0;

  const popoverZIndex = useChartTooltipZIndex();

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // The pinned tooltip anchors at `position: fixed` viewport coords captured
  // once at click time. When a surrounding scroll container scrolls, the chart
  // moves but the fixed tooltip stays glued to the viewport, detaching from its
  // data point (Mantine's closeOnClickOutside/closeOnEscape don't fire on
  // scroll). Dismiss on scroll instead so it never floats away — but ignore
  // scrolls originating inside the tooltip's own scrollable series list, or a
  // long tooltip couldn't be scrolled without instantly closing.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target != null && dropdownRef.current?.contains(target)) {
        return;
      }
      onDismiss();
    };
    window.addEventListener('scroll', handleScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [isOpen, onDismiss]);

  if (!isOpen) {
    return null;
  }

  return (
    // Portal to body so the `position: fixed` anchor resolves against the
    // viewport: dashboard tiles use CSS transforms, and a transformed ancestor
    // would otherwise make `fixed` resolve against it and throw the tooltip off.
    <Portal>
      <Popover
        opened
        onChange={opened => {
          if (!opened) {
            onDismiss();
          }
        }}
        closeOnClickOutside
        closeOnEscape
        trapFocus={false}
        withinPortal
        position="bottom"
        offset={12}
        middlewares={{ flip: true, shift: true }}
        returnFocus={false}
        zIndex={popoverZIndex}
      >
        <Popover.Target>
          {/* 1x1 anchor at the clicked data point. */}
          <div
            style={{
              position: 'fixed',
              left: payload.viewportX ?? 0,
              top: payload.viewportY ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Popover.Target>
        <Popover.Dropdown
          ref={dropdownRef}
          p={0}
          style={{
            // Width comes from the shared .chartTooltip class; fit-content stops
            // Mantine's default dropdown width from overriding it.
            width: 'fit-content',
            border: 'none',
            background: 'transparent',
          }}
        >
          <ChartSeriesTooltip
            activeLabel={payload.activeLabel}
            activePayload={payload.activePayload!}
            fallbackNumberFormat={fallbackNumberFormat}
            numberFormatByKey={numberFormatByKey}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
            buildSearchUrl={buildSearchUrl}
            onDismiss={onDismiss}
            onFocusSeries={onFocusSeries}
          />
        </Popover.Dropdown>
      </Popover>
    </Portal>
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
  /** Event markers (e.g. alert firing/recovery) drawn as dashed lines with labels. */
  annotations?: ChartAnnotation[];
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
  annotations,
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

  // Exemplar overlay is configured per-chart via `enableExemplars` (set in the
  // chart editor next to "As Ratio"), not a runtime toolbar toggle. The hook is
  // a no-op unless the flag is set and the source kind supports exemplars.
  const { exemplars } = useExemplars(queriedConfig, source);

  // Trace source an exemplar resolves against: the chart's explicit
  // `exemplarTraceSourceId`, else the chart source's linked trace source.
  const exemplarTraceSourceId =
    queriedConfig.exemplarTraceSourceId ||
    (source as { traceSourceId?: string } | undefined)?.traceSourceId;
  const { data: exemplarTraceSource } = useSource({
    id: exemplarTraceSourceId,
  });

  // Hover card state. A short close delay lets the cursor travel from the SVG
  // marker into the HTML card without it closing.
  const [hoveredExemplar, setHoveredExemplar] = useState<{
    exemplar: Exemplar;
    x: number;
    y: number;
  } | null>(null);
  const exemplarCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openExemplarCard = useCallback(
    (exemplar: Exemplar, x: number, y: number) => {
      if (exemplarCloseTimer.current) clearTimeout(exemplarCloseTimer.current);
      setHoveredExemplar({ exemplar, x, y });
    },
    [],
  );
  const scheduleCloseExemplarCard = useCallback(() => {
    if (exemplarCloseTimer.current) clearTimeout(exemplarCloseTimer.current);
    exemplarCloseTimer.current = setTimeout(
      () => setHoveredExemplar(null),
      150,
    );
  }, []);
  useEffect(
    () => () => {
      if (exemplarCloseTimer.current) clearTimeout(exemplarCloseTimer.current);
    },
    [],
  );

  const { data: hoveredTraceMeta, isLoading: isHoveredTraceMetaLoading } =
    useExemplarTraceMeta(
      hoveredExemplar?.exemplar.traceId,
      exemplarTraceSource,
    );

  const navigateToExemplarTrace = useCallback(
    (exemplar: Exemplar) => {
      if (exemplarTraceSourceId) {
        const params = new URLSearchParams();
        params.set('source', exemplarTraceSourceId);
        params.set('traceId', exemplar.traceId);
        Router.push(`/search?${params.toString()}`);
      } else {
        Router.push(`/trace/${encodeURIComponent(exemplar.traceId)}`);
      }
    },
    [exemplarTraceSourceId],
  );

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

  const dismissPinned = useCallback(() => setActiveClickPayload(undefined), []);
  const notifyTooltipPinned = useCrossChartPinDismiss(dismissPinned);

  // Pin the tooltip on click. Not gated on `source`: source-less charts still
  // show values/percent-change, and the drill-down actions hide themselves when
  // there's no source. `disableDrillDown` stays an explicit opt-out.
  const setPinnedPayload = useCallback(
    (payload: ActiveClickPayload | undefined) => {
      if (disableDrillDown) {
        return;
      }
      // Pinning here closes any other chart's pinned tooltip.
      if (payload != null) {
        notifyTooltipPinned();
      }
      setActiveClickPayload(payload);
    },
    [disableDrillDown, notifyTooltipPinned],
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
          isSingleValueColumn,
        });
        if (groupFilters.length > 0) {
          onFocusSeries(groupFilters);
          return;
        }
      }
      handleToggleSeries(name);
    },
    [onFocusSeries, groupColumns, isSingleValueColumn, handleToggleSeries],
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
          {/* Pinned (click-locked) tooltip; hover is handled in MemoChart. */}
          <ChartTooltipOverlay
            payload={activeClickPayload}
            buildSearchUrl={buildSearchUrl}
            // Stable reference so the overlay's scroll-dismissal effect doesn't
            // re-register its window listener on every re-render.
            onDismiss={dismissPinned}
            onFocusSeries={handleFocusSeries}
            fallbackNumberFormat={queriedConfig.numberFormat}
            numberFormatByKey={formatByColumn}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
          />
          <ExemplarHoverCard
            hovered={hoveredExemplar}
            meta={hoveredTraceMeta ?? undefined}
            isLoading={isHoveredTraceMetaLoading}
            traceSourceConfigured={!!exemplarTraceSource}
            onInspect={navigateToExemplarTrace}
            onMouseEnter={() => {
              if (exemplarCloseTimer.current)
                clearTimeout(exemplarCloseTimer.current);
            }}
            onMouseLeave={scheduleCloseExemplarCard}
          />
          <MemoChart
            dateRange={dateRange}
            displayType={displayType}
            graphResults={graphResults}
            isClickActive={activeClickPayload}
            lineData={lineData}
            isLoading={isLoadingOrPlaceholder}
            logReferenceTimestamp={logReferenceTimestamp}
            axisNumberFormat={axisNumberFormat}
            fallbackNumberFormat={queriedConfig.numberFormat}
            tooltipNumberFormatsByKey={formatByColumn}
            onTimeRangeSelect={onTimeRangeSelect}
            referenceLines={referenceLines}
            annotations={annotations}
            setIsClickActive={setPinnedPayload}
            showLegend={showLegend}
            timestampKey={timestampColumn?.name}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
            selectedSeriesNames={selectedSeriesSet}
            onToggleSeries={handleToggleSeries}
            granularity={granularity}
            dateRangeEndInclusive={queriedConfig.dateRangeEndInclusive}
            fitYAxisToData={queriedConfig.fitYAxisToData}
            exemplars={exemplars}
            maxExemplars={me?.team?.maxExemplars ?? DEFAULT_MAX_EXEMPLARS}
            onExemplarHover={openExemplarCard}
            onExemplarHoverEnd={scheduleCloseExemplarCard}
          />
        </>
      )}
    </ChartContainer>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
