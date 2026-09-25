import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import cx from 'classnames';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Customized,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { useChartSyncId } from '@/chartSync';
import { findNearestSeriesKey, LineData } from '@/ChartUtils';
import {
  AnnotationHitLayer,
  type HoveredAnnotation,
} from '@/components/charts/AnnotationHitLayer';
import { AnnotationTooltip } from '@/components/charts/AnnotationTooltip';
import { ChartAnnotation } from '@/components/charts/chartAnnotations';
import { ChartOverlayControls } from '@/components/charts/ChartOverlayControls';
import { toViewportPoint } from '@/components/charts/ChartTooltip';
import type { NumberFormat } from '@/types';
import { useFormatTime } from '@/useFormatTime';
import { COLORS } from '@/utils';

import { formatAxisTick, getYAxisTicks } from './axisTicks';
import {
  type ActiveClickPayload,
  buildActiveClickSeries,
  type ChartMouseState,
  getActiveLabel,
  getSelectedLineData,
  getSeriesDisplayName,
  getVisibleLineData,
  hasSeriesSelection,
  sameActiveClickSeries,
  seriesClassName,
} from './chartData';
import { LegendRenderer } from './ChartLegend';
import { CaptureActiveDot, StackedBarWithOverlap } from './chartPrimitives';
import { HDXLineChartTooltip } from './ChartTooltipContent';
import {
  ANNOTATION_LABEL_HEADROOM,
  NEAREST_SERIES_MAX_DISTANCE_PX,
  SINGLE_POINT_BAR_RIGHT_PADDING,
  SINGLE_POINT_BAR_WIDTH_RATIO,
  Y_AXIS_WIDTH,
} from './constants';
import { useChartScales } from './useChartScales';

import styles from '@styles/HDXLineChart.module.scss';

// Debounce (ms) for the chart's ResponsiveContainer resize observer. Without
// it the observer fires on every frame, and a resize → re-render → resize
// cycle can keep the chart (and the form controls around it in the tile
// editor) from ever settling.
const RESPONSIVE_CONTAINER_DEBOUNCE_MS = 50;

/**
 * Compute the unique set of hexes referenced by `<linearGradient>` defs
 * inside MemoChart. Exported so a unit test can pin the dedup-and-union
 * behavior without standing up a full recharts render (which jsdom
 * struggles with at the container-sized SVG layer).
 *
 * Includes every categorical hex up front so any positional `<Area>`
 * fill resolves, then unions in semantic hexes returned by the
 * `getChartColor{Info,Success,Warning,Error}` helpers; those land in
 * `lineData[].color` and would otherwise be missing a matching def.
 * `undefined` colors are filtered so `c.replace('#', '')` can't throw
 * on a future caller that leaves a series color unset.
 */
export function collectMemoChartGradientHexes(
  lineData: { color?: string }[],
): string[] {
  return Array.from(
    new Set([
      ...COLORS,
      ...lineData
        .map(ld => ld.color)
        .filter((c): c is string => typeof c === 'string'),
    ]),
  );
}

export const MemoChart = memo(function MemoChart({
  graphResults,
  setIsClickActive,
  refreshClickActive,
  isClickActive,
  dateRange,
  lineData,
  referenceLines,
  annotations,
  logReferenceTimestamp,
  displayType = DisplayType.Line,
  axisNumberFormat,
  fallbackNumberFormat,
  tooltipNumberFormatsByKey,
  isLoading,
  timestampKey = 'ts_bucket',
  onTimeRangeSelect,
  showLegend = true,
  previousPeriodOffsetSeconds,
  selectedSeriesNames,
  onToggleSeries,
  onClearSeriesSelection,
  granularity,
  dateRangeEndInclusive = true,
  fitYAxisToData = false,
}: {
  // Matches what useChartScales narrows to, so the hook's stricter type is
  // actually checked at this boundary rather than satisfied by `any`.
  graphResults: Record<string, unknown>[];
  setIsClickActive: (v: ActiveClickPayload | undefined) => void;
  /**
   * In-place refresh of the open pin's frozen snapshot (rows only), without the
   * cross-chart pin-dismiss broadcast setIsClickActive performs. Used by the
   * resync effect. Falls back to setIsClickActive when not provided.
   */
  refreshClickActive?: (v: ActiveClickPayload | undefined) => void;
  isClickActive: ActiveClickPayload | undefined;
  dateRange: [Date, Date] | Readonly<[Date, Date]>;
  lineData: LineData[];
  referenceLines?: React.ReactNode;
  /**
   * Event markers (alerts, releases, …) drawn as dashed vertical lines with a
   * label above. Passed as data rather than pre-rendered elements so the chart
   * can clamp them to its own x-axis domain. Distinct from `referenceLines`
   * (threshold lines).
   */
  annotations?: ChartAnnotation[];
  displayType?: DisplayType;
  axisNumberFormat?: NumberFormat;
  fallbackNumberFormat?: NumberFormat;
  tooltipNumberFormatsByKey: Map<string, NumberFormat>;
  logReferenceTimestamp?: number;
  isLoading?: boolean;
  timestampKey?: string;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  showLegend?: boolean;
  previousPeriodOffsetSeconds?: number;
  selectedSeriesNames?: Set<string>;
  onToggleSeries?: (seriesName: string, isShiftKey?: boolean) => void;
  /** Clear the current series isolation; renders a "Show All Series" button when set. */
  onClearSeriesSelection?: () => void;
  granularity: string;
  dateRangeEndInclusive?: boolean;
  /**
   * When true, the y-axis lower bound is the minimum of the displayed data
   * (with padding) instead of zero.
   **/
  fitYAxisToData?: boolean;
}) {
  const _id = useId();
  const id = _id.replace(/:/g, '');

  // recharts sync group, scoped via context (see chartSync).
  const syncId = useChartSyncId();

  const [isHovered, setIsHovered] = useState(false);

  // Filled by each Area's active dot with the series' active-point pixel Y,
  // keyed by dataKey, so the tooltip can bold the series nearest the cursor.
  // Read during the same render that draws the active dots.
  const activePointYByKeyRef = useRef<Map<string, number>>(new Map());

  // Stable writer passed to the active-dot element instead of the ref itself.
  // Recharts freezes the props of graphical-item elements in its Immer store;
  // passing a callback (rather than the Map) keeps the mutation on the
  // closed-over ref, which is never frozen.
  const captureActivePointY = useCallback((dataKey: string, cy: number) => {
    activePointYByKeyRef.current.set(dataKey, cy);
  }, []);

  // Key of the series whose line is nearest the cursor, lifted into state so
  // the chart can emphasize that line (thicker stroke) and fade the rest.
  // Set from the chart's mouse-move using the pixel Y the active dots captured
  // on the prior frame; the one-frame lag is imperceptible and settles as soon
  // as the pointer stops. The tooltip derives the same nearest row itself,
  // same-frame, for its own bolding and dimming.
  const [nearestSeriesKey, setNearestSeriesKey] = useState<
    string | undefined
  >();

  const ChartComponent = useMemo(
    () => (displayType === DisplayType.StackedBar ? BarChart : AreaChart), // LineChart;
    [displayType],
  );

  const visibleLineData = useMemo(
    () => getVisibleLineData(lineData, selectedSeriesNames),
    [lineData, selectedSeriesNames],
  );

  // Series for the pinned tooltip's drill-down list: selection applied but NOT
  // clamped to HARD_LINES_LIMIT, so "load all series" reveals series that were
  // materialized (up to the render cap) yet not drawn. Kept separate from
  // visibleLineData so the drawn chart stays bounded at HARD_LINES_LIMIT.
  const tooltipLineData = useMemo(
    () => getSelectedLineData(lineData, selectedSeriesNames),
    [lineData, selectedSeriesNames],
  );

  const lines = useMemo(() => {
    return visibleLineData.map(ld => {
      const key = ld.dataKey;
      const color = ld.color;
      const strokeDasharray = ld.isDashed ? '4 3' : '0';
      const seriesName = getSeriesDisplayName(ld);

      return displayType === 'stacked_bar' ? (
        <Bar
          key={key}
          type="monotone"
          dataKey={key}
          name={seriesName}
          fill={color}
          opacity={1}
          stackId="1"
          isAnimationActive={false}
          shape={<StackedBarWithOverlap dataKey={key} />}
        />
      ) : (
        <Area
          key={key}
          dataKey={key}
          type="monotone"
          stroke={color}
          fillOpacity={1}
          // Stable per-series class so the nearest-cursor emphasis can be
          // applied via CSS (see nearestSeriesStyle) rather than by changing
          // these props — a prop change here rebuilds every <Area> on hover.
          className={seriesClassName(id, key)}
          activeDot={<CaptureActiveDot onCapture={captureActivePointY} />}
          // Fill is always the gradient. Hiding it on hover is a CSS class
          // toggle (styles.chartHovered), not a prop swap — swapping it here
          // re-created every <Area> on each hover enter/leave (hover churn).
          fill={`url(#time-chart-lin-grad-${id}-${color?.replace('#', '').toLowerCase()})`}
          strokeDasharray={strokeDasharray}
          name={seriesName}
          isAnimationActive={false}
          connectNulls
        />
      );
    });
  }, [visibleLineData, displayType, id, captureActivePointY]);

  // Nearest-cursor emphasis (thicken the nearest line, fade the rest) applied
  // via a tiny scoped <style> keyed to nearestSeriesKey, so hovering only swaps
  // this string instead of rebuilding all ~HARD_LINES_LIMIT <Area> elements.
  // Only meaningful with more than one line drawn; mirrors the tooltip's
  // bold/dim of the same series.
  const nearestSeriesStyle = useMemo(() => {
    if (nearestSeriesKey == null || visibleLineData.length <= 1) return null;
    const scope = `.${styles.chartRoot}[data-chart-id='${id}']`;
    const nearest = seriesClassName(id, nearestSeriesKey);
    return (
      <style>{`
        ${scope} .recharts-area-curve { stroke-opacity: 0.5; }
        ${scope} .${nearest} .recharts-area-curve { stroke-opacity: 1; stroke-width: 2.5px; }
      `}</style>
    );
  }, [nearestSeriesKey, visibleLineData.length, id]);

  const [containerWidth, setContainerWidth] = useState(0);

  // Axis domains and annotation elements — see useChartScales.
  const { yAxisDomain, xAxisDomain, annotationElements, laidOutAnnotations } =
    useChartScales({
      annotations,
      containerWidth,
      dateRange,
      granularity,
      dateRangeEndInclusive,
      displayType,
      fitYAxisToData,
      graphResults,
      lineData,
      selectedSeriesNames,
    });

  // The chart's outer positioned container. Used to convert a pointer's
  // viewport clientX into a stable container-relative X for measuring
  // drag-to-zoom distance — a single origin that is always defined, unlike the
  // chart's activeCoordinate (null off a data point) or a child SVG element's
  // offsetX (relative to whichever bar/path is under the pointer).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const getContainerX = useCallback((e?: { clientX?: number } | null) => {
    if (e?.clientX == null || containerRef.current == null) return undefined;
    return e.clientX - containerRef.current.getBoundingClientRect().left;
  }, []);

  // Build the pinned-tooltip payload for the clicked bucket from a recharts
  // chart event `state`, including the viewport coords Mantine anchors to.
  const buildActivePayloadFromState = useCallback(
    (state?: {
      activeCoordinate?: { x?: number; y?: number };
      activeLabel?: string | number;
    }): ActiveClickPayload | undefined => {
      const chartX = state?.activeCoordinate?.x;
      const chartY = state?.activeCoordinate?.y;
      const activeLabel = getActiveLabel(state);
      if (chartX == null || chartY == null || activeLabel == null) {
        return undefined;
      }
      const activeRow = graphResults.find(
        row => String(row[timestampKey]) === activeLabel,
      );
      // Build from tooltipLineData (uncapped), not visibleLineData: the pinned
      // drill-down list may show more series than are drawn.
      const activePayload = buildActiveClickSeries(tooltipLineData, activeRow);
      if (activePayload.length === 0) {
        return undefined;
      }
      const containerRect = containerRef.current?.getBoundingClientRect();
      const anchor = toViewportPoint(containerRect, { x: chartX, y: chartY });
      return {
        viewportX: anchor.x,
        viewportY: anchor.y,
        activeLabel,
        activePayload,
      };
    },
    [graphResults, timestampKey, tooltipLineData],
  );

  // Keep the pinned tooltip's frozen snapshot in sync with its series set.
  // The snapshot's rows are captured once at click time from `tooltipLineData`;
  // when that set changes underneath an open pin — most notably after "load all
  // series" materializes the previously-capped series — the frozen rows (and
  // the "+N more" overflow derived from them) would otherwise stay stale, so
  // clicking "load all" would leave a phantom "+N more" and never surface the
  // newly-loaded rows. Rebuild the rows for the same clicked bucket from the
  // current data while preserving the click-time anchor coords.
  useEffect(() => {
    if (isClickActive == null) return;
    const activeRow = graphResults.find(
      row => String(row[timestampKey]) === isClickActive.activeLabel,
    );
    const nextPayload = buildActiveClickSeries(tooltipLineData, activeRow);
    // No numeric value at the pinned bucket anymore (e.g. the series vanished);
    // leave the existing snapshot rather than dismissing a still-anchored pin.
    if (nextPayload.length === 0) return;
    // Only update when the series set actually changed, so ordinary re-renders
    // (hover, live-range ticks) don't churn state or reset scroll position.
    if (sameActiveClickSeries(isClickActive.activePayload, nextPayload)) return;
    // In-place refresh (no cross-chart pin-dismiss broadcast); fall back to
    // setIsClickActive when the refresh callback isn't wired.
    (refreshClickActive ?? setIsClickActive)({
      ...isClickActive,
      activePayload: nextPayload,
    });
  }, [
    isClickActive,
    graphResults,
    timestampKey,
    tooltipLineData,
    refreshClickActive,
    setIsClickActive,
  ]);

  // Recharts computes bar width from the smallest gap between ticks on a
  // numerical XAxis. With a single data point there are no gaps, so the
  // computed width is 0 and bars become invisible. Provide an explicit
  // barSize for that case, sized to most of the drawable width (the
  // xAxisDomain already spans exactly one granularity for StackedBar charts).
  const singlePointBarSize = useMemo(() => {
    if (displayType !== DisplayType.StackedBar) return undefined;
    if (graphResults.length !== 1) return undefined;
    const drawableWidth = Math.max(
      0,
      containerWidth - Y_AXIS_WIDTH - SINGLE_POINT_BAR_RIGHT_PADDING,
    );
    if (drawableWidth <= 0) return undefined;
    return Math.max(
      1,
      Math.floor(drawableWidth * SINGLE_POINT_BAR_WIDTH_RATIO),
    );
  }, [displayType, graphResults.length, containerWidth]);

  const formatTime = useFormatTime();
  const xTickFormatter = useCallback(
    (value: number, index: number) => {
      return formatTime(value * 1000, {
        format: index === 0 ? 'normal' : 'time',
      });
    },
    [formatTime],
  );

  const tickFormatter = useCallback(
    (value: number) => formatAxisTick(value, axisNumberFormat),
    [axisNumberFormat],
  );

  // Only overrides Recharts' own tick generation when the domain is a
  // concrete range - a bare 'auto' bound has no fixed interval to work from.
  const yAxisTicks = useMemo(() => {
    const [min, max] = yAxisDomain;
    if (typeof min !== 'number' || typeof max !== 'number') {
      return undefined;
    }
    return getYAxisTicks(min, max, tickFormatter);
  }, [yAxisDomain, tickFormatter]);

  const [highlightStart, setHighlightStart] = useState<string | undefined>();
  const [highlightEnd, setHighlightEnd] = useState<string | undefined>();
  const mouseDownPosRef = useRef<number | null>(null);

  // Tracks the time range that was displayed before the user brushed to zoom
  // in, so a "Reset zoom" control can restore it (mirrors Highcharts). It holds
  // the earliest pre-zoom range across consecutive zoom-ins so resetting jumps
  // all the way back to where zooming started.
  const [zoomOrigin, setZoomOrigin] = useState<[Date, Date] | null>(null);
  // Set right before we trigger our own brush-zoom so the dateRange effect can
  // tell an internal zoom apart from an external time-range change.
  const justZoomedRef = useRef(false);
  // Set on a completed brush-zoom so the synthetic click that follows mouseup
  // is swallowed (instead of freezing a stale drill-down tooltip). Kept
  // separate from justZoomedRef and consumed/cleared by onClick, because the
  // dateRange effect may never run when the post-zoom range is value-equal.
  const suppressNextClickRef = useRef(false);
  const prevDateRangeRef = useRef<[number, number] | null>(null);

  // Clear the reset-zoom affordance whenever the time range changes for a
  // reason other than our own brush-zoom (e.g. the time picker or live tail),
  // so the button never restores a stale range. Compared by value because
  // `dateRange` can be a fresh array reference even when unchanged.
  useEffect(() => {
    const from = dateRange[0].getTime();
    const to = dateRange[1].getTime();
    const prev = prevDateRangeRef.current;
    const changed = prev == null || prev[0] !== from || prev[1] !== to;
    prevDateRangeRef.current = [from, to];

    // A brush-zoom sets justZoomedRef; consume it here so the range change it
    // caused doesn't clear zoomOrigin. Clear it even when the range didn't
    // actually change (a value-equal zoom), so it can't leak into a later
    // unrelated range change and wrongly preserve a stale zoomOrigin.
    const wasInternalZoom = justZoomedRef.current;
    justZoomedRef.current = false;

    if (!changed) {
      return;
    }
    if (wasInternalZoom) {
      return;
    }
    setZoomOrigin(null);
  }, [dateRange]);

  const handleResetZoom = useCallback(() => {
    if (zoomOrigin == null) {
      return;
    }
    const [start, end] = zoomOrigin;
    setZoomOrigin(null);
    onTimeRangeSelect?.(new Date(start.getTime()), new Date(end.getTime()));
  }, [zoomOrigin, onTimeRangeSelect]);

  const lineDataMap = useMemo(() => {
    const map: { [key: string]: LineData } = {};
    lineData.forEach(ld => {
      map[ld.dataKey] = ld;
    });
    return map;
  }, [lineData]);

  // Memoize the tooltip `content` element: recharts re-evaluates it every hover
  // frame, so a fresh element each render defeats HDXLineChartTooltip's memo.
  // Refs are stable, so only the listed values are deps.
  const hoverTooltipContent = useMemo(
    () => (
      <HDXLineChartTooltip
        numberFormat={fallbackNumberFormat}
        numberFormatByKey={tooltipNumberFormatsByKey}
        lineDataMap={lineDataMap}
        previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
        activePointYByKeyRef={activePointYByKeyRef}
        containerRef={containerRef}
      />
    ),
    [
      fallbackNumberFormat,
      tooltipNumberFormatsByKey,
      lineDataMap,
      previousPeriodOffsetSeconds,
    ],
  );

  // Latest values the mouse handlers read, in a ref so the handlers below can
  // be stable useCallbacks. Recharts re-runs its event wiring when a handler
  // prop's identity changes, so a stable reference avoids that per-render churn.
  const handlerStateRef = useRef({
    isClickActive,
    highlightStart,
    highlightEnd,
    dateRange,
    onTimeRangeSelect,
  });
  // Updated in an effect (not during render); the one-commit lag is harmless
  // since these are only read in event handlers, which fire after commit.
  useEffect(() => {
    handlerStateRef.current = {
      isClickActive,
      highlightStart,
      highlightEnd,
      dateRange,
      onTimeRangeSelect,
    };
  }, [
    isClickActive,
    highlightStart,
    highlightEnd,
    dateRange,
    onTimeRangeSelect,
  ]);

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setNearestSeriesKey(undefined);
    setHighlightStart(undefined);
    setHighlightEnd(undefined);
    mouseDownPosRef.current = null;
  }, []);

  const handleMouseDown = useCallback(
    (state: ChartMouseState, e?: { nativeEvent?: { clientX?: number } }) => {
      // Record the drag start: the active bucket label and a container-relative
      // pointer X (always defined, single origin) for measuring drag distance.
      const chartX = getContainerX(e?.nativeEvent);
      const downLabel = getActiveLabel(state);
      if (downLabel != null && chartX != null) {
        setHighlightStart(downLabel);
        mouseDownPosRef.current = chartX;
      }
    },
    [getContainerX],
  );

  const handleMouseMove = useCallback(
    (state: ChartMouseState) => {
      setIsHovered(true);

      const { isClickActive, highlightStart } = handlerStateRef.current;

      // Track which series' line is nearest the cursor so the lines can
      // emphasize it. The active dots captured their pixel Y on the prior frame;
      // comparing the pointer's chartY picks the nearest line. Skip while a
      // click-frozen tooltip is shown, matching the tooltip, and only set state
      // when the key changes to keep re-renders rare.
      const chartY = state?.activeCoordinate?.y;
      const activePointYByKey = activePointYByKeyRef.current;
      const nextNearest =
        isClickActive == null && activePointYByKey.size > 1 && chartY != null
          ? findNearestSeriesKey(
              activePointYByKey,
              Array.from(activePointYByKey.keys()),
              chartY,
              NEAREST_SERIES_MAX_DISTANCE_PX,
            )
          : undefined;
      setNearestSeriesKey(prev => (prev === nextNearest ? prev : nextNearest));

      const moveLabel = getActiveLabel(state);
      if (highlightStart != null && moveLabel != null) {
        setHighlightEnd(moveLabel);
        setIsClickActive(undefined); // Clear out any click state as we're highlighting
      }
    },
    [setIsClickActive],
  );

  const handleMouseUp = useCallback(
    (state: ChartMouseState, e?: { nativeEvent?: { clientX?: number } }) => {
      const MIN_DRAG_DISTANCE = 20; // Minimum horizontal drag distance in pixels
      let dragDistance = 0;

      const { highlightStart, highlightEnd, dateRange, onTimeRangeSelect } =
        handlerStateRef.current;

      // Measure against the same container-relative origin recorded on mouse
      // down so the distance is never skewed or dropped when the pointer maps
      // to no data point.
      const chartX = getContainerX(e?.nativeEvent);
      if (mouseDownPosRef.current != null && chartX != null) {
        dragDistance = Math.abs(chartX - mouseDownPosRef.current);
      }

      const activeLabel = getActiveLabel(state);
      if (activeLabel != null && highlightStart === activeLabel) {
        // If it's just a click, don't zoom
        setHighlightStart(undefined);
        setHighlightEnd(undefined);
        mouseDownPosRef.current = null;
      } else if (
        highlightStart != null &&
        highlightEnd != null &&
        dragDistance >= MIN_DRAG_DISTANCE
      ) {
        try {
          // Remember the range we're zooming away from so "Reset zoom" can
          // restore it. Keep the earliest origin across consecutive zooms.
          const originStart = dateRange[0];
          const originEnd = dateRange[1];
          setZoomOrigin(prev => prev ?? [originStart, originEnd]);
          // The synthetic click after this drag must be swallowed regardless of
          // whether a range change follows; onClick consumes and clears this.
          suppressNextClickRef.current = true;
          // Only tell the [dateRange] effect to preserve zoomOrigin when a
          // range change will actually happen; without onTimeRangeSelect the
          // range never changes and the effect never runs.
          if (onTimeRangeSelect != null) {
            justZoomedRef.current = true;
          }
          // Order the range numerically — the labels are epoch-second strings,
          // so a lexicographic compare would misorder values of differing
          // digit length.
          const startSec = Number(highlightStart);
          const endSec = Number(highlightEnd);
          const lowSec = Math.min(startSec, endSec);
          const highSec = Math.max(startSec, endSec);
          onTimeRangeSelect?.(
            new Date(lowSec * 1000),
            new Date(highSec * 1000),
          );
        } catch (err) {
          console.error('failed to highlight range', err);
          justZoomedRef.current = false;
          setZoomOrigin(null);
        }
        setHighlightStart(undefined);
        setHighlightEnd(undefined);
        mouseDownPosRef.current = null;
      } else {
        // Drag was too short, clear the highlight
        setHighlightStart(undefined);
        setHighlightEnd(undefined);
        mouseDownPosRef.current = null;
      }
    },
    [getContainerX],
  );

  const handleClick = useCallback(
    (state: ChartMouseState, e: { stopPropagation: () => void }) => {
      // A brush-to-zoom ends with a synthetic click; skip that one click so we
      // don't freeze a drill-down tooltip with now-stale, pre-zoom data.
      // Consume-and-clear the flag here so a value-equal zoom (which never
      // triggers the dateRange effect) can't leave it stuck and suppress every
      // later click.
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        e.stopPropagation();
        return;
      }
      const { highlightStart } = handlerStateRef.current;
      // Freeze a tooltip at the clicked point. The builder mirrors the series
      // actually drawn (legend selection + HARD_LINES_LIMIT).
      const clickPayload =
        highlightStart == null ? buildActivePayloadFromState(state) : undefined;
      if (clickPayload != null) {
        setIsClickActive(clickPayload);
        // Pinned replaces hover; drop line emphasis to match.
        setNearestSeriesKey(undefined);
      } else {
        // We clicked on the chart but outside of a line
        setIsClickActive(undefined);
      }

      // TODO: Properly detect clicks outside of the fake tooltip
      e.stopPropagation();
    },
    [buildActivePayloadFromState, setIsClickActive],
  );

  const [hoveredAnnotation, setHoveredAnnotation] =
    useState<HoveredAnnotation | null>(null);

  return (
    <div
      ref={containerRef}
      // Hovering hides the area fills (leaving just lines) so overlapping series
      // stay readable. Done via a class toggle + CSS on the recharts fill paths
      // rather than swapping each <Area>'s fill prop, so the chart's ~N Area
      // elements are not re-created on every hover enter/leave.
      // `rr-block` tells the HyperDX/rrweb session-replay recorder to capture
      // this chart as a placeholder rather than serializing its (very large)
      // SVG DOM on every mutation — the dominant session-replay cost on
      // high-cardinality dashboards.
      className={cx(
        'rr-block',
        styles.chartRoot,
        isHovered && styles.chartHovered,
      )}
      // Scopes nearestSeriesStyle to this chart instance.
      data-chart-id={id}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {nearestSeriesStyle}
      {hoveredAnnotation != null && (
        <AnnotationTooltip hovered={hoveredAnnotation} />
      )}
      <ChartOverlayControls
        onClearSelection={
          onClearSeriesSelection != null &&
          hasSeriesSelection(selectedSeriesNames)
            ? onClearSeriesSelection
            : undefined
        }
        onResetZoom={
          onTimeRangeSelect != null && zoomOrigin != null
            ? handleResetZoom
            : undefined
        }
      />
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        // Debounce resize handling so a resize → re-render → resize cycle
        // can't thrash layout (which leaves surrounding form controls never
        // "stable"); the observer otherwise fires undebounced on every frame.
        debounce={RESPONSIVE_CONTAINER_DEBOUNCE_MS}
        onResize={width => {
          const w = width ?? 1;
          setContainerWidth(prev => (prev === w ? prev : w));
        }}
        className={isLoading ? 'effect-pulse' : ''}
      >
        <ChartComponent
          width={500}
          height={300}
          data={graphResults}
          margin={
            annotationElements != null
              ? { top: ANNOTATION_LABEL_HEADROOM, right: 5, bottom: 5, left: 5 }
              : undefined
          }
          syncId={syncId}
          syncMethod="value"
          barSize={singlePointBarSize}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        >
          <defs>
            {/* Gradient defs cover every hex that any <Area> fill may reference.
              `COLORS` (the unified categorical palette) is included up-front
              as a baseline; semantic colors returned by the
              `getChartColor{Info,Success,Warning,Error}` helpers can also
              appear in `lineData[].color` (e.g. info-level log series
              resolve to `--color-chart-info`, chart blue `#437eef`, on both
              brands, which matches categorical slot 0). Union them here so the
              referenced `url(#time-chart-lin-grad-…)` always exists. */}
            {collectMemoChartGradientHexes(lineData).map(c => {
              return (
                <linearGradient
                  key={c}
                  id={`time-chart-lin-grad-${id}-${c.replace('#', '').toLowerCase()}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={c} stopOpacity={0.15} />
                  <stop offset="10%" stopColor={c} stopOpacity={0.003} />
                </linearGradient>
              );
            })}
          </defs>
          {isHovered && (
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          )}
          <XAxis
            dataKey={timestampKey ?? 'ts_bucket'}
            domain={xAxisDomain}
            interval="preserveStartEnd"
            scale="time"
            type="number"
            tickFormatter={xTickFormatter}
            minTickGap={100}
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            width={Y_AXIS_WIDTH}
            minTickGap={25}
            tickFormatter={tickFormatter}
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
            domain={yAxisDomain}
            ticks={yAxisTicks}
          />
          {lines}
          {/* HOVER tooltip (also drives cross-chart shadow tooltips via syncId).
              Hidden once a point is clicked, where the pinned tooltip takes over.
              Portaled to body so HDXLineChartTooltip can self-position (see its
              docblock) and escape the chart's bounds near an edge. */}
          {isClickActive == null && (
            <Tooltip
              content={hoverTooltipContent}
              portal={typeof document !== 'undefined' ? document.body : null}
            />
          )}
          {referenceLines}
          {annotationElements}
          {laidOutAnnotations != null && (
            <Customized
              component={
                <AnnotationHitLayer
                  annotations={laidOutAnnotations}
                  onHover={setHoveredAnnotation}
                />
              }
            />
          )}
          {highlightStart && highlightEnd ? (
            <ReferenceArea
              // yAxisId="1"
              // Numeric x on the numeric time axis (same as the click marker
              // ReferenceLine); a string wouldn't position on scale="time".
              x1={Number(highlightStart)}
              x2={Number(highlightEnd)}
              strokeOpacity={0.3}
            />
          ) : null}
          {showLegend && (
            <Legend
              iconSize={10}
              verticalAlign="bottom"
              content={
                <LegendRenderer
                  lineDataMap={lineDataMap}
                  allLineData={lineData}
                  selectedSeries={selectedSeriesNames || new Set()}
                  onToggleSeries={onToggleSeries}
                />
              }
              offset={-100}
            />
          )}
          {/** Needs to be at the bottom to prevent re-rendering */}
          {isClickActive != null ? (
            // The x-axis is numeric (scale="time"); pass a number so the marker
            // positions without relying on the axis coercing a string.
            <ReferenceLine
              x={Number(isClickActive.activeLabel)}
              stroke="#ccc"
            />
          ) : null}
          {logReferenceTimestamp != null ? (
            <ReferenceLine
              x={logReferenceTimestamp}
              stroke="#ff5d5b"
              strokeDasharray="3 3"
              label="Event"
            />
          ) : null}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
});
