import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInSeconds } from 'date-fns';
import { getAlignedDateRange } from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
  Exemplar,
} from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import {
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  getPreviousDateRange,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import ChartContainer from '@/components/charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from '@/components/charts/ChartErrorState';
import { ChartTooltipOverlay } from '@/components/DBTimeChart/ChartTooltipOverlay';
import { useCrossChartPinDismiss } from '@/components/DBTimeChart/crossChartPin';
import {
  buildSeriesSearchUrl,
  decodeSeriesGroupFilters,
  type SeriesGroupFilter,
} from '@/components/DBTimeChart/searchUrl';
import { useChartToolbarItems } from '@/components/DBTimeChart/useChartToolbarItems';
import { useExemplarCard } from '@/components/DBTimeChart/useExemplarCard';
import { ExemplarHoverCard } from '@/components/Exemplars';
import { DEFAULT_MAX_EXEMPLARS } from '@/defaults';
import { type ActiveClickPayload, MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useChartNumberFormats, useSource } from '@/source';

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

  // Exemplar overlay: data plus the hover/pin card state machine. See
  // useExemplarCard — the chart coordinates with it below because its drill-down
  // tooltip and the exemplar card are mutually exclusive.
  const {
    exemplars,
    exemplarNotice,
    reportClampDropped,
    traceLookupFailed,
    exemplarTraceSource,
    activeExemplar,
    pinnedExemplar,
    pinnedExemplarKey,
    hoveredTraceMeta,
    isHoveredTraceMetaLoading,
    openExemplarCard,
    scheduleCloseExemplarCard,
    cancelClose: cancelExemplarCardClose,
    pin: pinExemplarCardState,
    unpin: unpinExemplarCard,
    navigateToExemplarTrace,
  } = useExemplarCard({
    queriedConfig,
    source,
    displayType,
    // Rendered series count, so a multi-line chart cannot be given markers that
    // belong to an unknown line. Taken from the main query's own result — the
    // exemplar response can't answer it, since Prometheus returns only series
    // that carry a sampled exemplar. This is why the hook is called here rather
    // than beside the other data hooks: it needs lineData.
    // Current-period lines only. The previous-period comparison lands in the same
    // lineData (flagged isDashed), so counting it made a single-metric chart with
    // "Compare to Previous Period" ticked look like two series: every marker
    // vanished behind a notice telling the user to aggregate to a single line,
    // which they already had. The markers belong to the solid current line.
    plottedSeriesCount: lineData.filter(ld => !ld.isDashed).length,
  });

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

  const dismissPinned = useCallback(() => {
    setActiveClickPayload(undefined);
    unpinExemplarCard();
  }, [unpinExemplarCard]);
  const notifyTooltipPinned = useCrossChartPinDismiss(dismissPinned);

  // Clicking an exemplar marker pins its card. The marker stops the click from
  // reaching the chart, so this never races the drill-down tooltip — but the
  // two are still mutually exclusive, here and in setPinnedPayload below.
  const pinExemplarCard = useCallback(
    (exemplar: Exemplar, x: number, y: number) => {
      notifyTooltipPinned();
      setActiveClickPayload(undefined);
      pinExemplarCardState(exemplar, x, y);
    },
    [notifyTooltipPinned, pinExemplarCardState],
  );

  // Pin the tooltip on click. Not gated on `source`: source-less charts still
  // show values/percent-change, and the drill-down actions hide themselves when
  // there's no source. `disableDrillDown` stays an explicit opt-out.
  const setPinnedPayload = useCallback(
    (payload: ActiveClickPayload | undefined) => {
      // Any click that reaches the plot area dismisses a pinned exemplar card —
      // before the drill-down opt-out, so the card still closes on charts that
      // have drill-down disabled.
      unpinExemplarCard();
      if (disableDrillDown) {
        return;
      }
      // Pinning here closes any other chart's pinned tooltip.
      if (payload != null) {
        notifyTooltipPinned();
      }
      setActiveClickPayload(payload);
    },
    [disableDrillDown, notifyTooltipPinned, unpinExemplarCard],
  );

  const clickedActiveLabelDate = useMemo(() => {
    return activeClickPayload?.activeLabel != null
      ? new Date(Number.parseInt(activeClickPayload.activeLabel) * 1000)
      : undefined;
  }, [activeClickPayload]);

  const buildSearchUrl = useCallback(
    (seriesKey?: string, seriesValue?: number) =>
      buildSeriesSearchUrl({
        seriesKey,
        seriesValue,
        clickedActiveLabelDate,
        source,
        config,
        granularity,
        groupColumns,
        valueColumns,
        isSingleValueColumn,
      }),
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

  const toolbarItemsMemo = useChartToolbarItems({
    builderQueriedConfig,
    config,
    displayType,
    exemplarNotice,
    handleSetDisplayType,
    mvOptimizationData,
    queriedConfig,
    showDateRangeIndicator,
    showDisplaySwitcher,
    showMVOptimizationIndicator,
    source,
    toolbarPrefix,
    toolbarSuffix,
  });

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
            hovered={activeExemplar}
            meta={hoveredTraceMeta ?? undefined}
            isLoading={isHoveredTraceMetaLoading}
            traceSourceConfigured={!!exemplarTraceSource}
            traceLookupFailed={traceLookupFailed}
            numberFormat={axisNumberFormat}
            pinned={pinnedExemplar != null}
            onClose={unpinExemplarCard}
            onInspect={navigateToExemplarTrace}
            onMouseEnter={cancelExemplarCardClose}
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
            onExemplarSelect={pinExemplarCard}
            pinnedExemplarKey={pinnedExemplarKey}
            onExemplarPinEnd={unpinExemplarCard}
            onExemplarsDropped={reportClampDropped}
          />
        </>
      )}
    </ChartContainer>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
