import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
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
import {
  Button,
  Divider,
  Group,
  Paper,
  Popover,
  Portal,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconChartBar, IconChartLine, IconSearch } from '@tabler/icons-react';

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
import { DEFAULT_MAX_EXEMPLARS } from '@/defaults';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import {
  ExemplarTraceMeta,
  useExemplars,
  useExemplarTraceMeta,
} from '@/hooks/useExemplars';
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
  activePayload?: { value?: number; dataKey?: string; name?: string }[];
};

// Floating card shown when hovering an exemplar marker: trace metadata (from the
// configured exemplar trace source) plus a button to open the trace directly.
function ExemplarHoverCard({
  hovered,
  meta,
  isLoading,
  traceSourceConfigured,
  onInspect,
  onMouseEnter,
  onMouseLeave,
}: {
  hovered: { exemplar: Exemplar; x: number; y: number } | null;
  meta?: ExemplarTraceMeta;
  isLoading: boolean;
  traceSourceConfigured: boolean;
  onInspect: (exemplar: Exemplar) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position the card next to the marker, but flip to the left / clamp upward
  // when it would overflow the chart container, so it's never cut off. Measured
  // after render (size depends on the async-loaded metadata).
  useLayoutEffect(() => {
    if (!hovered || !ref.current) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const parent = el.offsetParent as HTMLElement | null;
    const pW = parent?.clientWidth ?? window.innerWidth;
    const pH = parent?.clientHeight ?? window.innerHeight;
    const cardW = el.offsetWidth;
    const cardH = el.offsetHeight;
    const margin = 12;

    let left = hovered.x + margin;
    if (left + cardW > pW) left = hovered.x - margin - cardW; // flip left
    left = Math.max(4, Math.min(left, pW - cardW - 4));

    let top = hovered.y - margin;
    if (top + cardH > pH) top = pH - cardH - 4; // shift up to stay in view
    top = Math.max(4, top);

    setPos({ left, top });
  }, [hovered, meta, isLoading, traceSourceConfigured]);

  if (!hovered) return null;
  const { exemplar } = hovered;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: pos?.left ?? hovered.x + 12,
        top: pos?.top ?? Math.max(0, hovered.y - 12),
        zIndex: 5,
        // Avoid a one-frame flash at the unflipped position before measuring.
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Paper shadow="md" p="xs" withBorder maw={280}>
        <Stack gap={6}>
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              Exemplar
            </Text>
            <Text size="xs" ff="monospace" truncate>
              {exemplar.traceId.slice(0, 16)}…
            </Text>
          </Group>
          {!traceSourceConfigured ? (
            <Text size="xs" c="dimmed">
              Set an exemplar trace source in the chart editor to see trace
              details.
            </Text>
          ) : isLoading ? (
            <Text size="xs" c="dimmed">
              Loading trace…
            </Text>
          ) : meta ? (
            <Stack gap={2}>
              {meta.service && <Text size="xs">Service: {meta.service}</Text>}
              {meta.spanName && <Text size="xs">Span: {meta.spanName}</Text>}
              {meta.durationMs != null && (
                <Text size="xs">Duration: {meta.durationMs.toFixed(1)} ms</Text>
              )}
              {meta.statusCode && (
                <Text size="xs">Status: {meta.statusCode}</Text>
              )}
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">
              Trace not found in source.
            </Text>
          )}
          <Button
            size="compact-xs"
            variant="secondary"
            onClick={() => onInspect(exemplar)}
          >
            Inspect trace
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}

function ActiveTimeTooltip({
  activeClickPayload,
  buildSearchUrl,
  onDismiss,
}: {
  activeClickPayload: ActiveClickPayload | undefined;
  buildSearchUrl: (key?: string, value?: number) => string | null;
  onDismiss: () => void;
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
          p="xs"
          maw={300}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          <Stack gap="xs" style={{ maxHeight: '220px', overflowY: 'auto' }}>
            <Link
              data-testid="chart-view-events-link"
              href={buildSearchUrl() ?? '/search'}
              onClick={onDismiss}
            >
              <Group gap="xs">
                <IconSearch size={16} />
                View All Events
              </Group>
            </Link>
            {validPayloads.length > 1 && (
              <>
                <Divider />
                <Text c="gray.5" size="xs">
                  Filter by group:
                </Text>
                {validPayloads.map((payload, idx) => {
                  const seriesUrl = buildSearchUrl(
                    payload.dataKey,
                    payload.value,
                  );
                  return (
                    <Tooltip
                      key={idx}
                      label={payload.name}
                      withArrow
                      color="gray"
                      position="right"
                    >
                      <Link
                        data-testid={`chart-view-events-link-${payload.dataKey}`}
                        href={seriesUrl ?? '/search'}
                        onClick={onDismiss}
                      >
                        <Group gap="xs">
                          <IconSearch size={12} />
                          <Text size="xs" truncate flex="1">
                            {payload.name}
                          </Text>
                        </Group>
                      </Link>
                    </Tooltip>
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
      const groupFilters: Array<{ column: string; value: any }> = [];

      if (seriesKeys?.length && groupColumns?.length) {
        // Determine if the first part is a value column name
        const startsWithValueColumn =
          !(isSingleValueColumn ?? true) ||
          ((groupColumns?.length ?? 0) === 0 &&
            (valueColumns?.length ?? 0) > 0);
        const groupValues = startsWithValueColumn
          ? seriesKeys.slice(1)
          : seriesKeys;

        // Build group filters
        groupValues.forEach((value, index) => {
          if (groupColumns[index] != null) {
            groupFilters.push({
              column: groupColumns[index],
              value,
            });
          }
        });
      }

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
