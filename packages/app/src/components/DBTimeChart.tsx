import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  tryExpandConfigVariables,
  useTimeChartSettings,
} from '@/ChartUtils';
import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import { ChartSeriesTooltip } from '@/components/charts/ChartSeriesTooltip';
import { useChartTooltipZIndex } from '@/components/charts/ChartTooltip';
import {
  MAX_LOADABLE_TIME_CHART_SERIES,
  resolveRenderedSeriesCap,
} from '@/defaults';
import { type ActiveClickPayload, MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useChartNumberFormats, useSource } from '@/source';
import type { NumberFormat } from '@/types';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import DateRangeIndicator from './charts/DateRangeIndicator';
import DisplaySwitcher from './charts/DisplaySwitcher';
import HiddenSeriesIndicator from './charts/HiddenSeriesIndicator';
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
  onShowAllSeries,
  fallbackNumberFormat,
  numberFormatByKey,
  previousPeriodOffsetSeconds,
  hiddenSeriesCount,
  onLoadAllSeries,
  expanded,
}: {
  payload: ActiveClickPayload | undefined;
  buildSearchUrl: (key?: string, value?: number) => string | null;
  onDismiss: () => void;
  /** Focus a series by its raw series key (dataKey) and display name. */
  onFocusSeries: (payload: { dataKey?: string; name: string }) => void;
  /** Clear an active series focus; undefined when nothing is focused. */
  onShowAllSeries?: () => void;
  fallbackNumberFormat?: NumberFormat;
  /** Per-value-column formats, keyed by result column name. */
  numberFormatByKey: Map<string, NumberFormat>;
  previousPeriodOffsetSeconds?: number;
  /** Series dropped by the chart's render cap (see ChartSeriesTooltip). */
  hiddenSeriesCount?: number;
  /** Render every series on the chart, bypassing the cap. */
  onLoadAllSeries?: () => void;
  /** "Load all" is active: render every row in the scrollable tooltip body. */
  expanded?: boolean;
}) {
  const isOpen =
    payload != null &&
    payload.activePayload != null &&
    payload.activePayload.length > 0;

  const popoverZIndex = useChartTooltipZIndex({ pinned: true });

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
      const target = e.target;
      if (target instanceof Node && dropdownRef.current?.contains(target)) {
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

  // Dismiss on outside click. Mantine's closeOnClickOutside misses it because
  // the chart's recharts onClick calls stopPropagation (see
  // HDXMultiSeriesTimeChart handleClick); a capture-phase listener sees the
  // click regardless, ignoring clicks inside the tooltip's own dropdown.
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Node && dropdownRef.current?.contains(target)) {
        return;
      }
      onDismiss();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
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
            onShowAllSeries={onShowAllSeries}
            hiddenSeriesCount={hiddenSeriesCount}
            onLoadAllSeries={onLoadAllSeries}
            expanded={expanded}
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

  // When the render cap hides series, the hidden-series notice lets the user
  // opt into rendering every series (accepting the memory/perf cost). Store the
  // query shape the opt-in was enabled at (not a bare boolean) so it can be
  // gated on the current shape during render — this resets the opt-in the
  // instant the query changes, with no setState-in-effect and no one-commit
  // window where a stale opt-in pairs with the new shape. `queryShapeIdentity`
  // is derived below; `showAllSeries` is defined right after it.
  const [showAllSeriesShape, setShowAllSeriesShape] = useState<string | null>(
    null,
  );

  const handleClearSelectedSeries = useCallback(() => {
    setSelectedSeriesSet(new Set());
  }, []);

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

  // Stable identity for the query's SHAPE, excluding the sliding time window.
  // `queriedConfig` (and the `config` it derives from) is a fresh object literal
  // on every render — dashboard tiles rebuild the tile config inline each render
  // (e.g. on hover) and live ranges tick the dateRange/granularity — so keying
  // effects on its object reference, or serializing the whole thing, would fire
  // them on unrelated re-renders / every live tick. Stripping the time fields
  // yields a value that changes only when the user re-authors the query.
  const queryShapeIdentity = useMemo(() => {
    // Serialize every top-level field except the sliding time window.
    const shape: Record<string, unknown> = { ...queriedConfig };
    delete shape.dateRange;
    delete shape.granularity;
    delete shape.dateRangeEndInclusive;
    // Builder configs normalize both `0` and null seriesLimit to `undefined`,
    // which JSON.stringify drops — so a null<->0 edit wouldn't change the shape
    // and the reset effect below wouldn't fire. Fold in the raw value so the
    // two states serialize differently.
    return JSON.stringify({
      shape,
      rawSeriesLimit: config.seriesLimit ?? null,
    });
  }, [queriedConfig, config.seriesLimit]);

  // "Load all" is active only while the shape it was enabled at still matches.
  // Deriving it (instead of resetting a boolean in an effect) means a query
  // change drops the opt-in in the same render, so a stale opt-in can never
  // pair with the new shape — and there's no setState-in-effect.
  const showAllSeries = showAllSeriesShape === queryShapeIdentity;
  const enableShowAllSeries = useCallback(
    () => setShowAllSeriesShape(queryShapeIdentity),
    [queryShapeIdentity],
  );
  // "Load all" only helps when it actually raises the cap. If the tile's own
  // seriesLimit already meets or exceeds the load-all bound (or is unlimited),
  // clicking would render the same set — so don't offer the affordance rather
  // than flip showAllSeries to a state where onLoadAll goes permanently
  // undefined for a no-op.
  const loadAllCanRaiseCap =
    MAX_LOADABLE_TIME_CHART_SERIES >
    resolveRenderedSeriesCap(config.seriesLimit);
  const loadAllHandler =
    showAllSeries || !loadAllCanRaiseCap ? undefined : enableShowAllSeries;

  // Determine whether the config can be optimized with an MV, to drive the MV
  // optimization indicator and the MV-derived date-range indicator in the
  // toolbar. Only those two indicators consume `mvOptimizationData`, so skip
  // this extra ClickHouse EXPLAIN when both are hidden — which includes the
  // edit-modal preview (ChartPreviewPanel passes showMVOptimizationIndicator and
  // showDateRangeIndicator both false), so the EXPLAIN is skipped there too.
  const builderQueriedConfig: BuilderChartConfigWithDateRange | undefined =
    isBuilderChartConfig(queriedConfig) ? queriedConfig : undefined;
  const { data: mvOptimizationData } = useMVOptimizationExplanation(
    builderQueriedConfig,
    { enabled: showMVOptimizationIndicator || showDateRangeIndicator },
  );

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
    hiddenSeriesCount,
    renderedSeriesCount,
  } = useMemo(() => {
    const defaultResponse = {
      error: null,
      graphResults: [],
      timestampColumn: undefined,
      lineData: [],
      groupColumns: [],
      valueColumns: [],
      isSingleValueColumn: true,
      hiddenSeriesCount: 0,
      renderedSeriesCount: 0,
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
        // "Load all" (from the warning / pinned tooltip) overrides everything;
        // otherwise the per-tile Series Limit drives the cap (null = default,
        // 0 = unlimited). On builder group-by charts the SQL CTE already trims
        // to seriesLimit, so this is a no-op there; on raw SQL it's the only
        // cardinality guard. "Load all" is bounded (not truly unlimited) so a
        // runaway high-cardinality result can't exhaust browser memory; drawn
        // lines stay capped at HARD_LINES_LIMIT either way. Take the max of the
        // bound and the tile's own cap so load-all can only ever RAISE the
        // rendered count — never reduce it when a tile's seriesLimit already
        // exceeds the bound. (A `0`/unlimited tile shows no affordance, so the
        // Infinity case is unreachable here.)
        maxSeries: showAllSeries
          ? Math.max(
              MAX_LOADABLE_TIME_CHART_SERIES,
              resolveRenderedSeriesCap(config.seriesLimit),
            )
          : resolveRenderedSeriesCap(config.seriesLimit),
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
    config.seriesLimit,
    previousPeriodData,
    hiddenSeries,
    previousPeriodOffsetSeconds,
    showAllSeries,
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

  // Dismiss any open pin when the query shape changes: its frozen snapshot
  // belongs to the previous query, and the resync effect would otherwise
  // repaint it with the new query's series at the stale click anchor. (The
  // "load all" opt-in resets on its own — it's derived from
  // `showAllSeriesShape === queryShapeIdentity` above — so it isn't touched
  // here.) Keyed on `queryShapeIdentity` (a stable serialization of the query
  // shape) rather than the `queriedConfig` object reference — which is new
  // every render — so unrelated re-renders (tile hover) and live-range ticks
  // don't dismiss the pin, while re-authoring the query still does.
  useEffect(() => {
    dismissPinned();
  }, [queryShapeIdentity, dismissPinned]);

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

  // In-place refresh of the already-open pin's frozen snapshot (used by the
  // chart's resync effect after "load all" / live ticks). Unlike
  // setPinnedPayload this does NOT broadcast the cross-chart pin-dismiss — it
  // isn't opening a new pin, just repainting the current one's rows.
  const refreshPinnedPayload = useCallback(
    (payload: ActiveClickPayload | undefined) => {
      if (disableDrillDown) {
        return;
      }
      setActiveClickPayload(payload);
    },
    [disableDrillDown],
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

      // The search page has no variable machinery, so the expressions read here
      // and handed to buildEventsSearchUrl must be final SQL/Lucene.
      // `whereLanguage` is pinned to buildEventsSearchUrl's default first, since
      // expansion below leaves nothing for it to expand.
      const expandedConfig = tryExpandConfigVariables({
        ...config,
        whereLanguage: config.whereLanguage || 'lucene',
      });

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

      // Metric formula configs with hidden operand series project only the
      // formula column(s), so value columns no longer map positionally onto
      // `select` — skip the value-range filter rather than misattributing a
      // formula value to an operand's expression. (With operands shown, the
      // operand columns still map by index and formula columns fall past the
      // `< expandedConfig.select.length` bound below.)
      const operandsHidden =
        isBuilderChartConfig(expandedConfig) &&
        (expandedConfig.formulas?.length ?? 0) > 0 &&
        expandedConfig.showOperandSeries === false;

      if (
        seriesValue &&
        !operandsHidden &&
        Array.isArray(expandedConfig.select) &&
        expandedConfig.select.length > 0
      ) {
        // Determine which value column to filter on
        let valueExpression: string | undefined;

        if (
          (isSingleValueColumn ?? true) &&
          expandedConfig.select.length === 1
        ) {
          const firstSelect = expandedConfig.select[0];
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
            valueColumnIndex < expandedConfig.select.length
          ) {
            const selectItem = expandedConfig.select[valueColumnIndex];
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
        config: expandedConfig,
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

    if (hiddenSeriesCount > 0) {
      allToolbarItems.push(
        <HiddenSeriesIndicator
          key="db-time-chart-hidden-series-indicator"
          hiddenSeriesCount={hiddenSeriesCount}
          renderedSeriesCount={renderedSeriesCount}
          // Offered only while still capped AND when load-all would actually
          // raise the cap (loadAllHandler is undefined otherwise), so the
          // notice never advertises a no-op click.
          onLoadAll={loadAllHandler}
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
    hiddenSeriesCount,
    renderedSeriesCount,
    loadAllHandler,
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
            onShowAllSeries={
              selectedSeriesSet.size > 0 ? handleClearSelectedSeries : undefined
            }
            fallbackNumberFormat={queriedConfig.numberFormat}
            numberFormatByKey={formatByColumn}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
            // "+N more" in the pinned tooltip loads every series (same escape
            // hatch as the hidden-series warning). Only offered while capped.
            hiddenSeriesCount={hiddenSeriesCount}
            onLoadAllSeries={loadAllHandler}
            // Once loaded, render the full set in the scrollable tooltip body
            // (not just the 20-row preview) so "load all" actually shows them.
            expanded={showAllSeries}
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
            refreshClickActive={refreshPinnedPayload}
            showLegend={showLegend}
            timestampKey={timestampColumn?.name}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
            selectedSeriesNames={selectedSeriesSet}
            onToggleSeries={handleToggleSeries}
            onClearSeriesSelection={handleClearSelectedSeries}
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
