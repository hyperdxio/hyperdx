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
import { add, isSameSecond, sub } from 'date-fns';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  BarProps,
  CartesianGrid,
  Legend,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AxisDomain } from 'recharts/types/util/types';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType, Exemplar } from '@hyperdx/common-utils/dist/types';
import { Button, Popover, Tooltip as MantineTooltip } from '@mantine/core';
import { IconZoomReset } from '@tabler/icons-react';

import type { NumberFormat } from '@/types';
import { COLORS, formatNumber, truncateMiddle } from '@/utils';

import {
  ChartAnnotation,
  getAnnotationElements,
} from './components/charts/chartAnnotations';
import {
  ChartTooltipContainer,
  ChartTooltipHeader,
  ChartTooltipItem,
  toViewportPoint,
  useChartTooltipZIndex,
} from './components/charts/ChartTooltip';
import { computeExemplarPoints, ExemplarDot } from './components/Exemplars';
import { useChartSyncId } from './chartSync';
import {
  findNearestSeriesKey,
  LineData,
  MAX_TIME_CHART_SERIES,
  toStartOfInterval,
} from './ChartUtils';
import { useFormatTime } from './useFormatTime';

import styles from '@styles/HDXLineChart.module.scss';

const MAX_LEGEND_ITEMS = 4;

// Vertical pixel distance within which a series' line counts as "near" the
// cursor for tooltip highlighting. Beyond this, no row is emphasized so the
// tooltip is not misleading when the pointer is in empty space.
const NEAREST_SERIES_MAX_DISTANCE_PX = 30;

// Gap below the data point for the hover tooltip. Kept equal to the pinned
// tooltip's Popover `offset` so both land in the same spot.
const TOOLTIP_POINT_OFFSET_PX = 12;

const Y_AXIS_WIDTH = 40;
const SINGLE_POINT_BAR_RIGHT_PADDING = 10;
const SINGLE_POINT_BAR_WIDTH_RATIO = 0.8;
// Top margin (px) reserved above the plot for annotation labels ("Alert"/"OK"),
// added only when a chart is showing annotations so other charts keep their
// tighter default headroom.
const ANNOTATION_LABEL_HEADROOM = 18;

type TooltipPayload = {
  dataKey: string;
  name: string;
  value: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  opacity?: number;
};

export const TooltipItem = memo(
  ({
    p,
    previous,
    numberFormat,
    highlighted,
    dimmed,
  }: {
    p: TooltipPayload;
    previous?: TooltipPayload;
    numberFormat?: NumberFormat;
    highlighted?: boolean;
    dimmed?: boolean;
  }) => {
    return (
      <ChartTooltipItem
        color={p.color ?? ''}
        name={p.name ?? p.dataKey}
        value={p.value}
        numberFormat={numberFormat}
        indicator="line"
        strokeDasharray={p.strokeDasharray}
        opacity={p.opacity}
        previous={previous?.value}
        highlighted={highlighted}
        dimmed={dimmed}
      />
    );
  },
);

type HDXLineChartTooltipProps = {
  lineDataMap: { [keyName: string]: LineData };
  previousPeriodOffsetSeconds?: number;
  numberFormat?: NumberFormat;
  numberFormatByKey: Map<string, NumberFormat>;
  /** Per-series active-point pixel Y, captured by the Area active dots. */
  activePointYByKeyRef: React.MutableRefObject<Map<string, number>>;
  /** The chart's outer container; its viewport rect anchors this tooltip. */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
} & Record<string, any>;

/**
 * The recharts `<Tooltip>` content used for the HOVER tooltip (on the hovered
 * chart and its synced followers). Clicking pins ChartSeriesTooltip instead.
 *
 * Because it's given `portal={document.body}`, recharts skips its own transform
 * positioning, so this content self-anchors at the active point with
 * `position: fixed` (container rect + `coordinate`) — matching the pinned
 * tooltip's anchor, and escaping the chart's bounds so edges aren't clipped.
 */
const HDXLineChartTooltip = withErrorBoundary(
  memo((props: HDXLineChartTooltipProps) => {
    const {
      active,
      payload,
      label,
      numberFormat,
      numberFormatByKey,
      lineDataMap,
      previousPeriodOffsetSeconds,
      activePointYByKeyRef,
      containerRef,
    } = props;
    const typedPayload = payload as TooltipPayload[];

    const tooltipZIndex = useChartTooltipZIndex();

    const payloadByKey = useMemo(
      () => new Map(typedPayload.map(p => [p.dataKey, p])),
      [typedPayload],
    );

    if (active && payload && payload.length) {
      // No onClose: hover renders the X hidden (kept for layout parity).
      const header = (
        <ChartTooltipHeader
          labelSeconds={label}
          previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
        />
      );

      // Bold the line nearest the cursor by comparing pointer Y to each series'
      // active-dot Y. The dots write their positions earlier in this same render
      // (Recharts draws graphical items before the tooltip), so it's current.
      const pointerY: number | undefined = props.coordinate?.y;
      // eslint-disable-next-line react-hooks/refs
      const activePointYByKey = activePointYByKeyRef?.current ?? undefined;
      const nearestSeriesKey =
        typedPayload.length > 1
          ? findNearestSeriesKey(
              activePointYByKey,
              typedPayload.map(p => p.dataKey),
              pointerY,
              NEAREST_SERIES_MAX_DISTANCE_PX,
            )
          : undefined;

      // Anchor at the active point (see the component docblock for why fixed).
      const pointX = props.coordinate?.x;
      const pointY = props.coordinate?.y;
      // eslint-disable-next-line react-hooks/refs
      const containerRect = containerRef?.current?.getBoundingClientRect();
      const anchor =
        typeof pointX === 'number' &&
        typeof pointY === 'number' &&
        containerRect != null
          ? toViewportPoint(containerRect, { x: pointX, y: pointY })
          : undefined;
      const anchorStyle: React.CSSProperties =
        anchor != null
          ? {
              position: 'fixed',
              left: anchor.x,
              top: anchor.y + TOOLTIP_POINT_OFFSET_PX,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              // z-index must live here: recharts leaves the portaled wrapper
              // `position: static`, where z-index has no effect.
              zIndex: tooltipZIndex,
            }
          : {};

      return (
        <div style={anchorStyle}>
          <ChartTooltipContainer header={header}>
            {/* Copy before sorting: Recharts 3 freezes the payload, so an
                in-place sort throws "this object has been frozen". */}
            {[...payload]
              .sort((a: TooltipPayload, b: TooltipPayload) => b.value - a.value)
              .map((p: TooltipPayload) => {
                const previousKey = lineDataMap[p.dataKey]?.previousPeriodKey;
                const isPreviousPeriod = previousKey === p.dataKey;
                const previousPayload =
                  !isPreviousPeriod && previousKey
                    ? payloadByKey.get(previousKey)
                    : undefined;
                const valueColumnName =
                  lineDataMap[p.dataKey]?.valueColumnName ?? p.dataKey;
                const numberFormatForKey =
                  numberFormatByKey.get(valueColumnName) ?? numberFormat;

                return (
                  <TooltipItem
                    key={p.dataKey}
                    p={p}
                    numberFormat={numberFormatForKey}
                    previous={previousPayload}
                    highlighted={p.dataKey === nearestSeriesKey}
                    dimmed={
                      nearestSeriesKey != null && p.dataKey !== nearestSeriesKey
                    }
                  />
                );
              })}
          </ChartTooltipContainer>
        </div>
      );
    }
    return null;
  }),
  {
    onError: console.error,
    fallback: (
      <div className="text-danger px-2 py-1 m-2 fs-8 font-monospace bg-danger-transparent">
        An error occurred while rendering the tooltip.
      </div>
    ),
  },
);

function ExpandableLegendItem({
  entry,
  expanded,
  isSelected,
  isDisabled,
  onToggle,
}: {
  entry: any;
  expanded?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
  onToggle?: (isShiftKey: boolean) => void;
}) {
  const [_expanded, setExpanded] = useState(false);
  const isExpanded = _expanded || expanded;

  return (
    <span
      className={`d-flex gap-1 items-center justify-center ${styles.legendItem}`}
      style={{
        color: entry.color,
        opacity: isDisabled ? 0.3 : 1,
        fontWeight: isSelected ? 600 : 400,
        cursor: 'pointer',
      }}
      role="button"
      onClick={e => {
        if (onToggle) {
          onToggle(e.shiftKey);
        } else {
          setExpanded(v => !v);
        }
      }}
      title={
        isSelected
          ? 'Click to show all (Shift+click to deselect)'
          : 'Click to show only this (Shift+click for multi-select)'
      }
    >
      <div>
        <svg width="12" height="4">
          <line
            x1="0"
            y1="2"
            x2="12"
            y2="2"
            stroke={entry.color}
            opacity={isDisabled ? 0.3 : 1}
            strokeDasharray={entry.payload?.strokeDasharray}
            strokeWidth={isSelected ? 2.5 : 1.5}
          />
        </svg>
      </div>
      {isExpanded || isSelected
        ? entry.value
        : truncateMiddle(`${entry.value}`, 35)}
    </span>
  );
}

const LegendRenderer = memo<{
  payload?: {
    dataKey: string;
    value: string;
    color: string;
  }[];
  lineDataMap: { [key: string]: LineData };
  allLineData?: LineData[];
  selectedSeries?: Set<string>;
  onToggleSeries?: (seriesName: string, isShiftKey?: boolean) => void;
}>(props => {
  const { payload, lineDataMap, allLineData, selectedSeries, onToggleSeries } =
    props;

  const hasSelection = !!selectedSeries && selectedSeries.size > 0;

  // Use allLineData to ensure all series are always shown in legend
  const allSeriesPayload = useMemo(() => {
    if (allLineData?.length) {
      return allLineData.map(ld => ({
        dataKey: ld.dataKey,
        value: ld.displayName || ld.dataKey,
        color: ld.color,
        payload: { strokeDasharray: ld.isDashed ? '4 3' : '0' },
      }));
    }
    return payload ?? [];
  }, [allLineData, payload]);

  const sortedLegendItems = useMemo(() => {
    // Order items such that current and previous period lines are consecutive
    const currentPeriodKeyIndex = new Map<string, number>();
    allSeriesPayload.forEach((line, index) => {
      const currentPeriodKey =
        lineDataMap[line.dataKey]?.currentPeriodKey || '';
      if (!currentPeriodKeyIndex.has(currentPeriodKey)) {
        currentPeriodKeyIndex.set(currentPeriodKey, index);
      }
    });

    // Copy before sorting: when this comes from Recharts' legend payload it is
    // kept in the Immer-backed store and frozen, so an in-place sort throws.
    return [...allSeriesPayload].sort((a, b) => {
      const keyA = lineDataMap[a.dataKey]?.currentPeriodKey ?? '';
      const keyB = lineDataMap[b.dataKey]?.currentPeriodKey ?? '';

      const indexA = currentPeriodKeyIndex.get(keyA) ?? 0;
      const indexB = currentPeriodKeyIndex.get(keyB) ?? 0;

      return indexB - indexA || a.dataKey.localeCompare(b.dataKey);
    });
  }, [allSeriesPayload, lineDataMap]);

  const shownItems = sortedLegendItems.slice(0, MAX_LEGEND_ITEMS);
  const restItems = sortedLegendItems.slice(MAX_LEGEND_ITEMS);

  return (
    <div className={styles.legend}>
      {shownItems.map((entry, index) => {
        const isSelected = !!selectedSeries?.has(entry.value);
        const isDisabled = hasSelection && !isSelected;
        return (
          <ExpandableLegendItem
            key={`item-${index}`}
            entry={entry}
            isSelected={isSelected}
            isDisabled={isDisabled}
            onToggle={isShiftKey => onToggleSeries?.(entry.value, isShiftKey)}
          />
        );
      })}
      {restItems.length ? (
        <Popover withinPortal withArrow closeOnEscape closeOnClickOutside>
          <Popover.Target>
            <div className={cx(styles.legendItem, styles.legendMoreLink)}>
              +{restItems.length} more
            </div>
          </Popover.Target>
          <Popover.Dropdown p="xs">
            <div className={styles.legendTooltipContent}>
              {restItems.map((entry, index) => {
                const isSelected = !!selectedSeries?.has(entry.value);
                const isDisabled = hasSelection && !isSelected;
                return (
                  <ExpandableLegendItem
                    key={`item-${index}`}
                    entry={entry}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    onToggle={isShiftKey =>
                      onToggleSeries?.(entry.value, isShiftKey)
                    }
                  />
                );
              })}
            </div>
          </Popover.Dropdown>
        </Popover>
      ) : null}
    </div>
  );
});

export const HARD_LINES_LIMIT = MAX_TIME_CHART_SERIES;

// Debounce (ms) for the chart's ResponsiveContainer resize observer. Without
// it the observer fires on every frame, and a resize → re-render → resize
// cycle can keep the chart (and the form controls around it in the tile
// editor) from ever settling.
const RESPONSIVE_CONTAINER_DEBOUNCE_MS = 50;

/** One series entry in a tooltip's per-bucket payload (hover or click-frozen). */
export type ActiveClickSeries = {
  value?: number;
  dataKey?: string;
  name?: string;
  /** Series color, matching the legend swatch. */
  color?: string;
  /** Previous-period value at the same bucket, for the percent-change chip. */
  previousValue?: number;
  /** Whether this series is a dashed previous-period line. */
  isPreviousPeriod?: boolean;
  /** Result column the values came from, for per-column number formatting. */
  valueColumnName?: string;
};

/**
 * State for the pinned (click-locked) tooltip. Produced by MemoChart's onClick
 * and rendered by DBTimeChart via ChartSeriesTooltip. (Hover uses recharts' own
 * <Tooltip>; recharts' <Tooltip> is also kept for its synced cursor.)
 */
export type ActiveClickPayload = {
  /** Active point in viewport coords; the Popover anchor. */
  viewportX: number;
  viewportY: number;
  activeLabel: string;
  activePayload?: ActiveClickSeries[];
};

/** Series label shown in the legend, tooltip, and line `name`. */
const getSeriesDisplayName = (ld: LineData) => ld.displayName || ld.dataKey;

/** Normalize a chart event's active label (number | string) to a string. */
const getActiveLabel = (state?: {
  activeLabel?: string | number;
}): string | undefined =>
  state?.activeLabel != null ? String(state.activeLabel) : undefined;

/**
 * Build the per-series payload for a click-frozen tooltip from the data row at
 * the clicked bucket. Only the visible series (legend selection +
 * HARD_LINES_LIMIT) with a numeric value at that bucket are included, so the
 * drill-down popover mirrors exactly what is drawn. Exported for unit testing.
 */
export function buildActiveClickSeries(
  visibleLineData: LineData[],
  activeRow: Record<string, unknown> | undefined,
): ActiveClickSeries[] {
  if (activeRow == null) return [];
  return visibleLineData.flatMap(ld => {
    const value = activeRow[ld.dataKey];
    if (typeof value !== 'number') return [];
    const isPreviousPeriod = ld.previousPeriodKey === ld.dataKey;
    // Pair each current-period series with its previous-period value for the
    // percent-change chip. Only current-period rows carry a comparison.
    const previousRaw =
      !isPreviousPeriod && ld.previousPeriodKey
        ? activeRow[ld.previousPeriodKey]
        : undefined;
    return [
      {
        dataKey: ld.dataKey,
        name: getSeriesDisplayName(ld),
        value,
        color: ld.color,
        isPreviousPeriod,
        valueColumnName: ld.valueColumnName,
        previousValue:
          typeof previousRaw === 'number' ? previousRaw : undefined,
      },
    ];
  });
}

/**
 * The series actually drawn on the chart: the first HARD_LINES_LIMIT of
 * lineData, narrowed to the legend selection when one is active. The rendered
 * lines and the drill-down click payload both derive from this same set so
 * they never diverge. Exported for unit testing.
 */
export function getVisibleLineData(
  lineData: LineData[],
  selectedSeriesNames: Set<string> | undefined,
): LineData[] {
  const hasSelection = !!selectedSeriesNames && selectedSeriesNames.size > 0;
  return lineData
    .slice(0, HARD_LINES_LIMIT)
    .filter(
      ld => !hasSelection || selectedSeriesNames.has(getSeriesDisplayName(ld)),
    );
}

const StackedBarWithOverlap = (props: BarProps) => {
  const { x, y, width, fill } = props;
  // `height` may arrive as a string, so coerce it to a number before the
  // arithmetic below.
  const height =
    typeof props.height === 'number' ? props.height : Number(props.height ?? 0);
  // Add a tiny bit to the height to create overlap. Otherwise there's a gap
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height > 0 ? height + 0.5 : 0}
      fill={fill}
    />
  );
};

type CaptureActiveDotProps = {
  /**
   * Called with each series' active-point pixel Y. This is a stable callback
   * (not the ref itself) so Recharts, which stores this element's props in its
   * Immer-backed store and freezes them, never freezes the underlying Map —
   * the write happens on the ref captured in the callback's closure instead.
   */
  onCapture: (dataKey: string, cy: number) => void;
  cx?: number;
  cy?: number;
  dataKey?: string | number;
  r?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

/**
 * Active dot for an Area series. Records the active point's pixel Y (`cy`)
 * via `onCapture`, keyed by dataKey, then draws the same dot Recharts
 * renders by default. Recharts clones this element with the active-point
 * props (cx, cy, dataKey, r, fill, stroke, strokeWidth) during the render
 * that precedes the tooltip, so the capture is current when the tooltip reads
 * it to find the series nearest the cursor.
 */
function CaptureActiveDot({
  onCapture,
  cx,
  cy,
  dataKey,
  r,
  fill,
  stroke,
  strokeWidth,
}: CaptureActiveDotProps) {
  if (dataKey != null && typeof cy === 'number' && Number.isFinite(cy)) {
    // Written synchronously during render so the tooltip, which Recharts
    // renders after the graphical items in the same commit, reads the
    // current frame's positions rather than the previous frame's.
    onCapture(String(dataKey), cy);
  }
  if (typeof cx !== 'number' || typeof cy !== 'number') {
    return null;
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

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
  granularity,
  dateRangeEndInclusive = true,
  fitYAxisToData = false,
  exemplars,
  maxExemplars = 12,
  onExemplarHover,
  onExemplarHoverEnd,
}: {
  graphResults: any[];
  setIsClickActive: (v: ActiveClickPayload | undefined) => void;
  isClickActive: ActiveClickPayload | undefined;
  dateRange: [Date, Date] | Readonly<[Date, Date]>;
  lineData: LineData[];
  referenceLines?: React.ReactNode;
  /**
   * Event markers (alerts, deploys, …) drawn as dashed vertical lines with a
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
  granularity: string;
  dateRangeEndInclusive?: boolean;
  /**
   * When true, the y-axis lower bound is the minimum of the displayed data
   * (with padding) instead of zero.
   **/
  fitYAxisToData?: boolean;
  /** Exemplar markers to overlay on the chart (linked to traces). */
  exemplars?: Exemplar[];
  /** Target number of exemplar markers to show (0 = unlimited). */
  maxExemplars?: number;
  /** Invoked when the cursor enters an exemplar marker, with its pixel coords. */
  onExemplarHover?: (exemplar: Exemplar, cx: number, cy: number) => void;
  /** Invoked when the cursor leaves an exemplar marker. */
  onExemplarHoverEnd?: () => void;
}) {
  const rawId = useId();
  const id = rawId.replace(/:/g, '');

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

  const lines = useMemo(() => {
    // When a series is nearest the cursor (only meaningful with more than one
    // line shown), thicken its line and fade the others so the eye lands on
    // the same series the tooltip bolds. Mirrors the legend's selected style
    // (thicker stroke) with a gentle fade that keeps the rest readable.
    const hasNearest =
      visibleLineData.length > 1 &&
      nearestSeriesKey != null &&
      visibleLineData.some(ld => ld.dataKey === nearestSeriesKey);

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
          strokeWidth={hasNearest && key === nearestSeriesKey ? 2.5 : undefined}
          strokeOpacity={
            hasNearest && key !== nearestSeriesKey ? 0.5 : undefined
          }
          activeDot={<CaptureActiveDot onCapture={captureActivePointY} />}
          {...(isHovered
            ? { fill: 'none', strokeDasharray }
            : {
                fill: `url(#time-chart-lin-grad-${id}-${color?.replace('#', '').toLowerCase()})`,
                strokeDasharray,
              })}
          name={seriesName}
          isAnimationActive={false}
          connectNulls
        />
      );
    });
  }, [
    visibleLineData,
    displayType,
    id,
    isHovered,
    nearestSeriesKey,
    captureActivePointY,
  ]);

  // Max value across the visible series. Exemplar markers are clamped to this so
  // a single slow-trace outlier (which can be 100x the p99 line) can't stretch
  // the y-axis and crush the series flat — the marker pins to the top of the
  // series range while its hover card still shows the true duration.
  const visibleSeriesMax = useMemo(() => {
    const hasSelection = selectedSeriesNames && selectedSeriesNames.size > 0;
    let max = -Infinity;
    graphResults.forEach(dataPoint => {
      lineData.forEach(ld => {
        const seriesName = ld.displayName || ld.dataKey;
        if (!hasSelection || selectedSeriesNames.has(seriesName)) {
          const value = dataPoint[ld.dataKey];
          if (typeof value === 'number' && !isNaN(value)) {
            max = Math.max(max, value);
          }
        }
      });
    });
    return max;
  }, [graphResults, lineData, selectedSeriesNames]);

  const yAxisDomain: AxisDomain = useMemo(() => {
    const hasSelection = selectedSeriesNames && selectedSeriesNames.size > 0;

    // Fitting the y-axis lower bound to the data only applies to line charts.
    // Bar charts are always anchored at zero so the bar lengths stay
    // proportional to their values.
    const shouldFitYAxis =
      fitYAxisToData && displayType !== DisplayType.StackedBar;

    // The domain follows the visible series only — exemplar markers are clamped
    // to the series max at render, so they never need to widen the axis. When
    // there's no selection or fit, let Recharts auto-scale (lower pinned to 0).
    if (!hasSelection && !shouldFitYAxis) {
      return [0, 'auto'];
    }

    // Calculate domain based on visible series (all series when there's no
    // explicit selection).
    let minValue = Infinity;
    let maxValue = -Infinity;

    graphResults.forEach(dataPoint => {
      lineData.forEach(ld => {
        const seriesName = ld.displayName || ld.dataKey;
        // Only consider visible series
        if (!hasSelection || selectedSeriesNames.has(seriesName)) {
          const value = dataPoint[ld.dataKey];
          if (typeof value === 'number' && !isNaN(value)) {
            minValue = Math.min(minValue, value);
            maxValue = Math.max(maxValue, value);
          }
        }
      });
    });

    // If we found valid values, return them with some padding
    if (minValue !== Infinity && maxValue !== -Infinity) {
      const padding = (maxValue - minValue) * 0.05; // 5% padding
      // When fitting to data, allow the lower bound to follow the data
      // minimum; otherwise keep it pinned at zero. The 5% padding must not
      // drag the axis below zero unless the data itself is negative, so
      // clamp at zero whenever the minimum is non-negative.
      const lowerBound =
        shouldFitYAxis && minValue < 0
          ? minValue - padding
          : Math.max(0, minValue - padding);
      const upperBound = maxValue + padding;
      return [lowerBound, upperBound];
    }

    return ['auto', 'auto'];
  }, [
    graphResults,
    lineData,
    selectedSeriesNames,
    fitYAxisToData,
    displayType,
  ]);

  const [containerWidth, setContainerWidth] = useState(0);

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
      const activePayload = buildActiveClickSeries(visibleLineData, activeRow);
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
    [graphResults, timestampKey, visibleLineData],
  );

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
    (value: number) => {
      return axisNumberFormat
        ? formatNumber(value, {
            ...axisNumberFormat,
            average: true,
            mantissa: 0,
            unit: undefined,
          })
        : new Intl.NumberFormat('en-US', {
            notation: 'compact',
            compactDisplay: 'short',
          }).format(value);
    },
    [axisNumberFormat],
  );

  const [highlightStart, setHighlightStart] = useState<string | undefined>();
  const [highlightEnd, setHighlightEnd] = useState<string | undefined>();
  const mouseDownPosRef = useRef<number | null>(null);

  // While the cursor is over an exemplar marker, the exemplar hover card owns
  // the tooltip real estate — suppress the series hover tooltip so the two don't
  // overlap. Wraps the parent's exemplar-hover callbacks to also track it here.
  // Track the hovered marker by key (not just a boolean) so we can detect when a
  // refetch/re-thinning unmounts it — React fires no mouseleave in that case, so
  // the boolean would otherwise stick `true` and permanently suppress the series
  // tooltip. The reset effect lives after `exemplarPoints` is computed.
  const [hoveredExemplarKey, setHoveredExemplarKey] = useState<string | null>(
    null,
  );
  const isExemplarHovered = hoveredExemplarKey != null;
  const handleExemplarHoverStart = useCallback(
    (exemplar: Exemplar, cx: number, cy: number) => {
      setHoveredExemplarKey(
        `exemplar-${exemplar.traceId}-${exemplar.timestamp}`,
      );
      onExemplarHover?.(exemplar, cx, cy);
    },
    [onExemplarHover],
  );
  const handleExemplarHoverEnd = useCallback(() => {
    setHoveredExemplarKey(null);
    onExemplarHoverEnd?.();
  }, [onExemplarHoverEnd]);

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

  // Place each exemplar at its own value (the trace/span's actual measurement),
  // never remapped onto the series line — the marker's height must match what
  // the linked trace reports. Thinned to keep ~maxExemplars markers across the
  // visible range: the highest-value (most notable, e.g. slowest) trace per
  // window. The window is coarser than the chart granularity so the count stays
  // readable even when every fine-grained bucket has an exemplar.
  // maxExemplars <= 0 means "unlimited" — show every exemplar (deduped).
  const exemplarPoints = useMemo(
    () =>
      computeExemplarPoints(exemplars, {
        maxExemplars,
        granularity,
        dateRange,
      }),
    [exemplars, maxExemplars, granularity, dateRange],
  );

  // If a refetch/re-thinning drops the hovered marker from the rendered set, its
  // <g> unmounts without a mouseleave. Reset the hover here (against the actual
  // rendered points) so the series tooltip un-suppresses and the parent's hover
  // card closes via onExemplarHoverEnd.
  useEffect(() => {
    if (
      hoveredExemplarKey != null &&
      !exemplarPoints.some(p => p.key === hoveredExemplarKey)
    ) {
      setHoveredExemplarKey(null);
      onExemplarHoverEnd?.();
    }
  }, [exemplarPoints, hoveredExemplarKey, onExemplarHoverEnd]);

  const xAxisDomain: AxisDomain = useMemo(() => {
    let startTime = toStartOfInterval(dateRange[0], granularity);
    let endTime = toStartOfInterval(dateRange[1], granularity);
    const endTimeIsBoundaryAligned = isSameSecond(dateRange[1], endTime);
    if (endTimeIsBoundaryAligned && !dateRangeEndInclusive) {
      endTime = sub(endTime, {
        seconds: convertGranularityToSeconds(granularity),
      });
    }

    // For bar charts, extend the domain in both directions by half a granularity unit
    // so that the full bar width is within the bounds of the chart
    if (displayType === DisplayType.StackedBar) {
      const halfGranularitySeconds =
        convertGranularityToSeconds(granularity) / 2;
      startTime = sub(startTime, { seconds: halfGranularitySeconds });
      endTime = add(endTime, { seconds: halfGranularitySeconds });
    }

    return [startTime.getTime() / 1000, endTime.getTime() / 1000];
  }, [dateRange, granularity, dateRangeEndInclusive, displayType]);

  // Alert/event markers as dashed lines, clamped to the chart's x-axis domain so
  // an edge marker (e.g. an alert already firing at window open) stays visible
  // instead of being dropped. Labels float in the reserved top headroom.
  const annotationElements = useMemo(() => {
    if (!annotations?.length) {
      return null;
    }
    // xAxisDomain is a [min, max] tuple at runtime (declared as AxisDomain).
    return getAnnotationElements(annotations, {
      domain: xAxisDomain as [number, number],
    });
  }, [annotations, xAxisDomain]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {onTimeRangeSelect != null && zoomOrigin != null ? (
        <MantineTooltip label="Reset to the range before zooming in" withArrow>
          <Button
            variant="secondary"
            size="compact-xs"
            leftSection={<IconZoomReset size={14} />}
            onClick={handleResetZoom}
            style={{
              position: 'absolute',
              top: 4,
              right: 8,
              zIndex: 2,
            }}
          >
            Reset zoom
          </Button>
        </MantineTooltip>
      ) : null}
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
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            setIsHovered(false);
            setNearestSeriesKey(undefined);

            setHighlightStart(undefined);
            setHighlightEnd(undefined);
            mouseDownPosRef.current = null;
          }}
          onMouseDown={(state, e) => {
            // Record the drag start: the active bucket label and a
            // container-relative pointer X (always defined, single origin) for
            // measuring drag distance on mouse up.
            const chartX = getContainerX(e?.nativeEvent);
            const downLabel = getActiveLabel(state);
            if (downLabel != null && chartX != null) {
              setHighlightStart(downLabel);
              mouseDownPosRef.current = chartX;
            }
          }}
          onMouseMove={state => {
            setIsHovered(true);

            // Track which series' line is nearest the cursor so the lines can
            // emphasize it. The active dots captured their pixel Y on the prior
            // frame; comparing the pointer's chartY picks the nearest line. Skip
            // while a click-frozen tooltip is shown, matching the tooltip, and
            // only set state when the key changes to keep re-renders rare.
            const chartY = state?.activeCoordinate?.y;
            const activePointYByKey = activePointYByKeyRef.current;
            const nextNearest =
              isClickActive == null &&
              activePointYByKey.size > 1 &&
              chartY != null
                ? findNearestSeriesKey(
                    activePointYByKey,
                    Array.from(activePointYByKey.keys()),
                    chartY,
                    NEAREST_SERIES_MAX_DISTANCE_PX,
                  )
                : undefined;
            setNearestSeriesKey(prev =>
              prev === nextNearest ? prev : nextNearest,
            );

            const moveLabel = getActiveLabel(state);
            if (highlightStart != null && moveLabel != null) {
              setHighlightEnd(moveLabel);
              setIsClickActive(undefined); // Clear out any click state as we're highlighting
            }
          }}
          onMouseUp={(state, e) => {
            const MIN_DRAG_DISTANCE = 20; // Minimum horizontal drag distance in pixels
            let dragDistance = 0;

            // Measure against the same container-relative origin recorded on
            // mouse down so the distance is never skewed or dropped when the
            // pointer maps to no data point.
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
                // The synthetic click after this drag must be swallowed
                // regardless of whether a range change follows; onClick
                // consumes and clears this itself.
                suppressNextClickRef.current = true;
                // Only tell the [dateRange] effect to preserve zoomOrigin when a
                // range change will actually happen; without onTimeRangeSelect
                // the range never changes and the effect never runs.
                if (onTimeRangeSelect != null) {
                  justZoomedRef.current = true;
                }
                // Order the range numerically — the labels are epoch-second
                // strings, so a lexicographic compare would misorder values of
                // differing digit length.
                const startSec = Number(highlightStart);
                const endSec = Number(highlightEnd);
                const lowSec = Math.min(startSec, endSec);
                const highSec = Math.max(startSec, endSec);
                onTimeRangeSelect?.(
                  new Date(lowSec * 1000),
                  new Date(highSec * 1000),
                );
              } catch (e) {
                console.error('failed to highlight range', e);
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
          }}
          onClick={(state, e) => {
            // A brush-to-zoom ends with a synthetic click; skip that one click
            // so we don't freeze a drill-down tooltip with now-stale, pre-zoom
            // data. Consume-and-clear the flag here so a value-equal zoom (which
            // never triggers the dateRange effect) can't leave it stuck and
            // suppress every later click.
            if (suppressNextClickRef.current) {
              suppressNextClickRef.current = false;
              e.stopPropagation();
              return;
            }
            // Freeze a tooltip at the clicked point. The builder mirrors the
            // series actually drawn (legend selection + HARD_LINES_LIMIT).
            const clickPayload =
              highlightStart == null
                ? buildActivePayloadFromState(state)
                : undefined;
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
          }}
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
          />
          {lines}
          {/* HOVER tooltip (also drives cross-chart shadow tooltips via syncId).
              Hidden once a point is clicked, where the pinned tooltip takes over.
              Portaled to body so HDXLineChartTooltip can self-position (see its
              docblock) and escape the chart's bounds near an edge. */}
          {isClickActive == null && !isExemplarHovered && (
            <Tooltip
              content={
                <HDXLineChartTooltip
                  numberFormat={fallbackNumberFormat}
                  numberFormatByKey={tooltipNumberFormatsByKey}
                  lineDataMap={lineDataMap}
                  previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
                  activePointYByKeyRef={activePointYByKeyRef}
                  containerRef={containerRef}
                />
              }
              portal={typeof document !== 'undefined' ? document.body : null}
            />
          )}
          {referenceLines}
          {annotationElements}
          {exemplarPoints.map(p => (
            <ReferenceDot
              key={p.key}
              x={p.x}
              // Clamp to the series max so an outlier pins to the top of the
              // series range instead of stretching the axis (and getting
              // discarded by recharts' default ifOverflow). The hover card
              // still shows the exemplar's true value.
              y={
                Number.isFinite(visibleSeriesMax)
                  ? Math.min(p.y, visibleSeriesMax)
                  : p.y
              }
              shape={
                <ExemplarDot
                  exemplar={p.exemplar}
                  onHoverStart={handleExemplarHoverStart}
                  onHoverEnd={handleExemplarHoverEnd}
                />
              }
            />
          ))}
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
