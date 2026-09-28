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
  Customized,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getTickValuesFixedDomain } from 'recharts/lib/util/scale/getNiceTickValues';
import { AxisDomain } from 'recharts/types/util/types';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Popover } from '@mantine/core';

import type { NumberFormat } from '@/types';
import {
  COLORS,
  formatDurationMsCompact,
  formatNumber,
  isFixedNumericUnit,
  truncateMiddle,
} from '@/utils';

import {
  AnnotationHitLayer,
  type HoveredAnnotation,
} from './components/charts/AnnotationHitLayer';
import { AnnotationTooltip } from './components/charts/AnnotationTooltip';
import {
  ChartAnnotation,
  getAnnotationElements,
  layoutAnnotations,
  resolveAnnotationSeries,
} from './components/charts/chartAnnotations';
import { ChartOverlayControls } from './components/charts/ChartOverlayControls';
import {
  ChartTooltipContainer,
  ChartTooltipHeader,
  ChartTooltipItem,
  toViewportPoint,
  useChartTooltipZIndex,
} from './components/charts/ChartTooltip';
import { useChartSyncId } from './chartSync';
import {
  findNearestSeriesKey,
  getSeriesColorForGroup,
  LineData,
  MAX_TIME_CHART_SERIES,
  toStartOfInterval,
} from './ChartUtils';
import { useFormatTime } from './useFormatTime';

import styles from '@styles/HDXLineChart.module.scss';

const MAX_LEGEND_ITEMS = 4;

// Max rows rendered in a series tooltip (hover and pinned). Each row mounts a
// DOM node (the pinned one also a Mantine Tooltip), so an uncapped busy bucket
// was a jank source; the rest collapse into a "+N more" line (see
// getVisibleTooltipRows). Exported so the pinned tooltip shares the cap.
export const MAX_TOOLTIP_ROWS = 20;

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

      // Copy before sorting: Recharts 3 freezes the payload, so an in-place
      // sort throws "this object has been frozen".
      const sortedPayload = [...typedPayload].sort(
        (a: TooltipPayload, b: TooltipPayload) => b.value - a.value,
      );

      // Cap how many rows are rendered per frame (see getVisibleTooltipRows).
      const { rows: visiblePayload, hiddenCount: hiddenRowCount } =
        getVisibleTooltipRows(
          sortedPayload,
          nearestSeriesKey,
          MAX_TOOLTIP_ROWS,
        );

      return (
        <div style={anchorStyle}>
          <ChartTooltipContainer
            header={header}
            contentClassName={styles.chartTooltipContentClipped}
          >
            {visiblePayload.map((p: TooltipPayload) => {
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
            {hiddenRowCount > 0 && (
              <div
                style={{ opacity: 0.6, fontStyle: 'italic', paddingTop: 2 }}
                data-testid="chart-tooltip-hidden-rows"
              >
                +{hiddenRowCount.toLocaleString()} more
              </div>
            )}
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

  const hasSelection = hasSeriesSelection(selectedSeries);

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

/**
 * Stable, CSS-safe class for a series' <Area>, unique per chart (`id`) and
 * series (`dataKey`). Lets the nearest-cursor emphasis target one line via CSS
 * without changing any <Area> prop (which would rebuild every line on hover).
 */
const seriesClassName = (id: string, dataKey: string) =>
  `hdx-series-${id}-${dataKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

// The subset of recharts' loosely-typed chart mouse-event `state` we read.
type ChartMouseState = {
  activeLabel?: string | number;
  activeCoordinate?: { x?: number; y?: number };
};

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
    // Exclude non-finite values (NaN/±Infinity) — e.g. a ratio chart's
    // zero-denominator bucket yields NaN. The tooltip already drops these
    // (ChartSeriesTooltip filters on Number.isFinite), and admitting them here
    // would also break the sameActiveClickSeries equality guard (NaN !== NaN).
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
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
 * Shallow structural equality for two click-frozen payloads, used to decide
 * whether an open pin's snapshot needs rebuilding. Compares the drawn set
 * (length + per-row dataKey) and the value/previousValue at the pinned bucket;
 * a change in any means the tooltip's rows or its "+N more" overflow would
 * differ. Cheap and order-sensitive — `buildActiveClickSeries` derives both
 * sides from the same `tooltipLineData` ordering, so positions stay aligned.
 *
 * Uses `Object.is` for the numeric fields so a `NaN` value compares equal to
 * itself (a plain `!==` would report NaN-holding snapshots as perpetually
 * changed and drive the resync effect into an infinite update loop).
 */
export function sameActiveClickSeries(
  a: ActiveClickSeries[] | undefined,
  b: ActiveClickSeries[],
): boolean {
  if (a == null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].dataKey !== b[i].dataKey ||
      !Object.is(a[i].value, b[i].value) ||
      !Object.is(a[i].previousValue, b[i].previousValue)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The series actually drawn on the chart. Without a selection, the first
 * HARD_LINES_LIMIT of lineData. With a selection (legend isolate, checkbox
 * filter, or table search), the selection is applied FIRST and then capped, so
 * an explicitly chosen series always draws even if it ranks beyond the limit.
 * Applying the cap first would slice out a chosen low-ranked series, leaving an
 * empty chart while its stats still show in the legend table. The rendered
 * lines and the drill-down click payload both derive from this same set so they
 * never diverge. Exported for unit testing.
 */
/**
 * Whether a series selection is active. The single source of truth for the
 * "isolate to these series" predicate that gates line visibility, the y-axis
 * domain, legend dimming, and the "Show All Series" control — so those can't
 * drift out of sync.
 */
function hasSeriesSelection(
  selectedSeriesNames: Set<string> | undefined,
): selectedSeriesNames is Set<string> {
  return !!selectedSeriesNames && selectedSeriesNames.size > 0;
}

export function getVisibleLineData(
  lineData: LineData[],
  selectedSeriesNames: Set<string> | undefined,
): LineData[] {
  return getSelectedLineData(lineData, selectedSeriesNames).slice(
    0,
    HARD_LINES_LIMIT,
  );
}

/**
 * The series that survive the legend/table selection, WITHOUT the
 * HARD_LINES_LIMIT draw cap. Same selection semantics as getVisibleLineData
 * (selection applied first), so an explicitly chosen series is always kept.
 * The pinned tooltip's rows derive from this so the "load all series" escape
 * hatch can list series that were materialized but not drawn — the draw cap
 * (getVisibleLineData) exists to keep the chart readable/fast, not to bound the
 * scrollable drill-down list. Exported for unit testing.
 */
export function getSelectedLineData(
  lineData: LineData[],
  selectedSeriesNames: Set<string> | undefined,
): LineData[] {
  const hasSelection = hasSeriesSelection(selectedSeriesNames);
  if (hasSelection) {
    return lineData.filter(ld =>
      selectedSeriesNames.has(getSeriesDisplayName(ld)),
    );
  }
  return lineData;
}

/**
 * The series-tooltip rows to render (hover or pinned). `rows` must be sorted by
 * value descending. Keeps the top `limit`; if the cursor-nearest series ranks
 * past it, that series replaces the lowest kept row so it still shows (pass
 * `undefined` for the pinned tooltip, which has no cursor). `hiddenCount`
 * drives the "+N more" line. Exported for unit testing.
 */
export function getVisibleTooltipRows<T extends { dataKey?: string }>(
  rows: T[],
  nearestSeriesKey: string | undefined,
  limit: number,
): { rows: T[]; hiddenCount: number } {
  if (rows.length <= limit) {
    return { rows, hiddenCount: 0 };
  }
  const visible = rows.slice(0, limit);
  if (
    nearestSeriesKey != null &&
    !visible.some(r => r.dataKey === nearestSeriesKey)
  ) {
    const nearest = rows.find(r => r.dataKey === nearestSeriesKey);
    if (nearest != null) {
      visible[visible.length - 1] = nearest;
    }
  }
  return { rows: visible, hiddenCount: rows.length - visible.length };
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

// Cap on the axis mantissa search - configured Decimals can go up to 10
// (NumberFormat.tsx), but 2 already distinguishes values >= 0.005 from 0.
const MAX_AXIS_MANTISSA = 2;

/** Base width ceiling for a bare signed number - see MAX_AXIS_MANTISSA's comment. */
const AXIS_CHAR_BUDGET = 5;

// Flat, not suffix-length-scaled - IBM Plex Mono is monospace, so a longer
// suffix costs the same per character as a digit and earns no extra room.
const SEPARATOR_CHAR_ALLOWANCE = 1;

// Trims insignificant trailing zeros ("1.00k" -> "1k") and a sign left
// over from a value that rounded to zero ("-0"/"-0%" -> "0"/"0%").
function trimTrailingZeros(formatted: string): string {
  const trimmed = formatted
    .replace(/(\.\d*?)0+(?=\D*$)/, '$1')
    .replace(/\.(?=\D*$)/, '');
  return trimmed.replace(/^-(0%?)$/, '$1');
}

// A space-separated unit suffix gets its own allowance - an overflowing
// right-anchored SVG label clips off-canvas, so there's no safe rescue here.
function axisLabelBudget(formatted: string): number {
  const spaceIndex = formatted.indexOf(' ');
  if (spaceIndex !== -1) {
    return AXIS_CHAR_BUDGET + SEPARATOR_CHAR_ALLOWANCE;
  }
  const isNegativePercent =
    formatted.startsWith('-') && formatted.endsWith('%');
  return AXIS_CHAR_BUDGET + (isNegativePercent ? 1 : 0);
}

/**
 * Searches downward from the configured mantissa for the tightest fit
 * (axisLabelBudget); diverges from DBHeatmapChart's tickFormatter deliberately.
 */
export function formatAxisTick(
  value: number,
  axisNumberFormat?: NumberFormat,
): string {
  if (!axisNumberFormat) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      compactDisplay: 'short',
    }).format(value);
  }

  // formatNumber returns early for 'duration', before the mantissa/width
  // safety below ever runs, and formatDurationMs has no width budget of its
  // own - use the compact formatter instead, as DBHeatmapChart's axis does.
  if (axisNumberFormat.output === 'duration') {
    const factor = axisNumberFormat.factor ?? 1;
    return formatDurationMsCompact(value * factor * 1000);
  }

  const maxMantissa = Math.max(
    0,
    Math.min(axisNumberFormat.mantissa ?? 0, MAX_AXIS_MANTISSA),
  );
  // A fixed unit's suffix is identical on every tick, so it's dropped here
  // (unlike an auto-scale one) to spend the whole budget on precision.
  const isFixedUnit = isFixedNumericUnit(axisNumberFormat.numericUnit);
  for (let mantissa = maxMantissa; mantissa >= 0; mantissa--) {
    const candidate = trimTrailingZeros(
      isFixedUnit
        ? value.toFixed(mantissa)
        : formatNumber(value, {
            ...axisNumberFormat,
            mantissa,
            average: true,
            unit: undefined,
          }),
    );
    if (mantissa === 0 || candidate.length <= axisLabelBudget(candidate)) {
      return candidate;
    }
  }
  // Unreachable: the mantissa === 0 case above always returns.
  return '';
}

// Retries with fewer ticks until every label is distinct, so survivors
// stay evenly spaced instead of an uneven subset of a fixed-size set.
export function getYAxisTicks(
  min: number,
  max: number,
  formatTick: (value: number) => string,
): number[] {
  for (let tickCount = 5; tickCount >= 2; tickCount--) {
    const candidates = getTickValuesFixedDomain([min, max], tickCount, true);
    const labels = candidates.map(formatTick);
    if (new Set(labels).size === labels.length) {
      return candidates;
    }
  }
  // Nothing distinguishes this range at this mantissa - fall back to the
  // full set, redundant labels and all, rather than misrepresent it as flat.
  return getTickValuesFixedDomain([min, max], 5, true);
}

// Rounds off float dust (e.g. 3 * 1.05 giving 3.1500000000000004).
const cleanNumber = (v: number) => Number(v.toPrecision(12));

// A format with no decimals to spend forces every tick to an integer,
// where a 2.5x10^n step (n <= 0) rounds unevenly - see niceStepsNear.
function forcesIntegerTicks(axisNumberFormat?: NumberFormat): boolean {
  if (!axisNumberFormat) return true;
  if (axisNumberFormat.output === 'duration') return false;
  return (axisNumberFormat.mantissa ?? 0) === 0;
}

// Every 1/2/5 x10^n step, plus 2.5x10^n for n > 0 (integers like 250 are
// always safe; 2.5, 0.25, ... round unevenly with no decimals to spare).
function niceStepsNear(
  target: number,
  axisNumberFormat?: NumberFormat,
): number[] {
  const exp = Math.floor(Math.log10(target));
  const excludeSmall2_5 = forcesIntegerTicks(axisNumberFormat);
  return [exp - 1, exp, exp + 1]
    .flatMap(e => {
      const includeQuarterStep = e > 0 || !excludeSmall2_5;
      const multipliers = includeQuarterStep
        ? [1, 2, 2.5, 5, 10]
        : [1, 2, 5, 10];
      return multipliers.map(m => m * 10 ** e);
    })
    .filter(step => step > 0)
    .sort((a, b) => a - b);
}

// null means the step is unusable at this magnitude (see below), which
// getNiceYAxisTicks must treat as a rejection, not as a short tick list.
function ticksWithinRange(
  step: number,
  min: number,
  max: number,
): number[] | null {
  const ticks: number[] = [];
  let t = cleanNumber(Math.ceil(min / step) * step);
  while (t <= max + step * 1e-9) {
    ticks.push(t);
    const next = cleanNumber(t + step);
    // At extreme magnitudes, float precision can make this step a no-op -
    // reject it rather than accept a truncated, collapsed tick list.
    if (next <= t) {
      return null;
    }
    t = next;
  }
  return ticks;
}

// Escalates precision past the configured mantissa, bypassing
// formatAxisTick's own selection (which can force 0 regardless).
function formatTickAtMantissa(
  value: number,
  axisNumberFormat: NumberFormat,
  mantissa: number,
): string {
  // Mirrors formatAxisTick's fixed-unit handling - re-adding the suffix it
  // drops would make budget checks reject a label that never actually renders that wide.
  if (isFixedNumericUnit(axisNumberFormat.numericUnit)) {
    return trimTrailingZeros(value.toFixed(mantissa));
  }
  return trimTrailingZeros(
    formatNumber(value, {
      ...axisNumberFormat,
      mantissa,
      average: true,
      unit: undefined,
    }),
  );
}

// Ticks must never carry duplicate labels.
const MAX_TICK_MANTISSA_ESCALATION = 4;

function isDistinct(
  ticks: number[],
  formatTick: (value: number) => string,
): boolean {
  return new Set(ticks.map(formatTick)).size === ticks.length;
}

// Reuses formatAxisTick's own per-label budget (axisLabelBudget already
// accounts for a space-separated unit suffix or a negative percent sign).
function fitsLabelBudget(
  ticks: number[],
  formatTick: (value: number) => string,
): boolean {
  return ticks.every(t => {
    const label = formatTick(t);
    return label.length <= axisLabelBudget(label);
  });
}

// Prefers formatAxisTick's normal output, but escalates precision past the
// configured mantissa when that's the only way to keep labels distinct.
function resolveDistinctTickLabels(
  ticks: number[],
  axisNumberFormat: NumberFormat | undefined,
): ((value: number) => string) | null {
  const base = (value: number) => formatAxisTick(value, axisNumberFormat);
  if (isDistinct(ticks, base)) {
    return base;
  }
  if (!axisNumberFormat) {
    // No configured mantissa to escalate - fall back to full, non-compact
    // precision, which always distinguishes any two different numbers.
    const fullPrecision = (value: number) =>
      new Intl.NumberFormat('en-US').format(value);
    return isDistinct(ticks, fullPrecision) &&
      fitsLabelBudget(ticks, fullPrecision)
      ? fullPrecision
      : null;
  }
  if (axisNumberFormat.output === 'duration') {
    // formatDurationMsCompact has no mantissa - escalate its own fixed
    // 2-3 significant digits instead, past whichever unit it picks.
    const factor = axisNumberFormat.factor ?? 1;
    for (let p = 3; p <= 3 + MAX_TICK_MANTISSA_ESCALATION; p++) {
      const escalated = (value: number) =>
        formatDurationMsCompact(value * factor * 1000, p);
      if (isDistinct(ticks, escalated) && fitsLabelBudget(ticks, escalated)) {
        return escalated;
      }
    }
    return null;
  }
  // formatAxisTick can force mantissa down to 0 regardless of what's
  // configured, so escalation must start from 1, not the configured value.
  for (let m = 1; m <= MAX_TICK_MANTISSA_ESCALATION; m++) {
    const escalated = (value: number) =>
      formatTickAtMantissa(value, axisNumberFormat, m);
    if (isDistinct(ticks, escalated) && fitsLabelBudget(ticks, escalated)) {
      return escalated;
    }
  }
  return null;
}

export interface NiceYAxisTicks {
  ticks: number[];
  tickFormatter?: (value: number) => string;
}

// Ported from packages/cli/src/termchart/scale.ts's niceTicks: the smallest
// step that fits within [min, max]/maxTicks and formats to distinct labels.
export function getNiceYAxisTicks(
  min: number,
  max: number,
  maxTicks = 5,
  axisNumberFormat?: NumberFormat,
): NiceYAxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { ticks: [] };
  }
  const steps = niceStepsNear((max - min) / (maxTicks - 1), axisNumberFormat);
  for (const step of steps) {
    const ticks = ticksWithinRange(step, min, max);
    // A single tick conveys no scale at all - never accept it, even
    // though its "labels" are trivially distinct from one another.
    if (!ticks || ticks.length < 2 || ticks.length > maxTicks) {
      continue;
    }
    const tickFormatter = resolveDistinctTickLabels(ticks, axisNumberFormat);
    if (tickFormatter) {
      return { ticks, tickFormatter };
    }
  }
  return { ticks: [] };
}

export interface ExpandableYAxisTicks {
  max: number;
  ticks: number[];
  tickFormatter?: (value: number) => string;
}

// For the plain default branch (domain may expand, as [0,'auto'] did
// pre-PR): rounds the upper bound up to fill slack under maxTicks.
export function getExpandableYAxisTicks(
  min: number,
  max: number,
  maxTicks = 5,
  axisNumberFormat?: NumberFormat,
): ExpandableYAxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { max, ticks: [] };
  }
  const steps = niceStepsNear((max - min) / (maxTicks - 1), axisNumberFormat);
  for (const step of steps) {
    const tightTicks = ticksWithinRange(step, min, max);
    // A single tick conveys no scale at all - never accept it, even
    // though its "labels" are trivially distinct from one another.
    if (!tightTicks || tightTicks.length < 2 || tightTicks.length > maxTicks) {
      continue;
    }
    const tightFormatter = resolveDistinctTickLabels(
      tightTicks,
      axisNumberFormat,
    );
    if (!tightFormatter) {
      continue;
    }
    const expandedMax = cleanNumber(Math.ceil(max / step) * step);
    // Filling a step's worth of dead space is fine, but not at the cost
    // of a large fraction of the range - keep the tight result instead.
    if (expandedMax - max <= (max - min) * 0.25) {
      const expandedTicks = ticksWithinRange(step, min, expandedMax);
      if (expandedTicks && expandedTicks.length <= maxTicks) {
        const expandedFormatter = resolveDistinctTickLabels(
          expandedTicks,
          axisNumberFormat,
        );
        if (expandedFormatter) {
          return {
            max: expandedMax,
            ticks: expandedTicks,
            tickFormatter: expandedFormatter,
          };
        }
      }
    }
    return { max, ticks: tightTicks, tickFormatter: tightFormatter };
  }
  return { max, ticks: [] };
}

// Shared by every yAxisDomain branch below. Callers pass only the series
// actually drawn (already selection- and HARD_LINES_LIMIT-filtered).
export function scanYAxisValueRange(
  graphResults: any[],
  lineData: LineData[],
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  graphResults.forEach(dataPoint => {
    lineData.forEach(ld => {
      const value = dataPoint[ld.dataKey];
      if (typeof value === 'number' && !isNaN(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
  });
  return { min, max };
}

export interface YAxisBounds {
  domain: AxisDomain;
  ticks: number[] | undefined;
  tickFormatter?: (value: number) => string;
}

// Stable identity for the referenceLineValues default - a fresh `[]` literal
// as a default prop value defeats memoization and can loop React's compiler.
const EMPTY_REFERENCE_LINE_VALUES: number[] = [];

const DEFAULT_Y_AXIS_BOUNDS: YAxisBounds = {
  domain: [0, 'auto'],
  ticks: undefined,
};
const FIT_Y_AXIS_BOUNDS: YAxisBounds = {
  domain: ['auto', 'auto'],
  ticks: undefined,
};

// A stacked bar's rendered height sums its series at each timestamp - leave
// that entirely to Recharts, regardless of selection/fit-to-data state.
export function computeYAxisBounds(
  graphResults: any[],
  visibleLineData: LineData[],
  hasSelection: boolean,
  fitYAxisToData: boolean,
  displayType: DisplayType,
  referenceLineValues: number[],
  axisNumberFormat?: NumberFormat,
): YAxisBounds {
  if (displayType === DisplayType.StackedBar) {
    return DEFAULT_Y_AXIS_BOUNDS;
  }
  const shouldFitYAxis = fitYAxisToData;

  if (!hasSelection && !shouldFitYAxis) {
    // A fully numeric domain skips Recharts' own nice rounding, and a
    // reference line can extend it further - defer to Recharts entirely.
    if (referenceLineValues.length > 0) {
      return DEFAULT_Y_AXIS_BOUNDS;
    }
    const { min, max } = scanYAxisValueRange(graphResults, visibleLineData);
    if (max === -Infinity) {
      return DEFAULT_Y_AXIS_BOUNDS;
    }
    // Recharts widens an explicit domain to fit out-of-range data, so
    // negative data must be reflected here, not just pinned at zero.
    const lowerBound = cleanNumber(Math.min(0, min));
    // max * 1.05 would shrink the upper bound below max for negative data;
    // padding away from zero keeps headroom regardless of max's sign.
    const upperBound = cleanNumber(max + Math.abs(max) * 0.05);
    if (upperBound <= lowerBound) {
      return DEFAULT_Y_AXIS_BOUNDS;
    }
    const expanded = getExpandableYAxisTicks(
      lowerBound,
      upperBound,
      5,
      axisNumberFormat,
    );
    // No nice step fits - fall back to getYAxisTicks' reduce-tick-count
    // dedup instead of Recharts' raw, collision-prone default.
    if (expanded.ticks.length === 0) {
      const baseFormat = (value: number) =>
        formatAxisTick(value, axisNumberFormat);
      return {
        domain: [lowerBound, upperBound],
        ticks: getYAxisTicks(lowerBound, upperBound, baseFormat),
        tickFormatter: baseFormat,
      };
    }
    return {
      domain: [lowerBound, expanded.max],
      ticks: expanded.ticks,
      tickFormatter: expanded.tickFormatter,
    };
  }

  // A selection with fit-to-data off still keeps the zero-pinned fallback,
  // not the unpinned fit fallback - only fitting itself opts out of it.
  const degenerateFallback = shouldFitYAxis
    ? FIT_Y_AXIS_BOUNDS
    : DEFAULT_Y_AXIS_BOUNDS;
  const { min, max } = scanYAxisValueRange(graphResults, visibleLineData);
  if (min === Infinity || max === -Infinity) {
    return degenerateFallback;
  }
  const padding = (max - min) * 0.05;
  // Recharts widens the domain to actual negative data regardless of fit
  // mode, so the lower bound must follow it whenever min itself is negative.
  const lowerBound = cleanNumber(
    min < 0 ? min - padding : Math.max(0, min - padding),
  );
  const upperBound = cleanNumber(max + padding);
  if (upperBound <= lowerBound) {
    return degenerateFallback;
  }
  // A reference line can widen the domain (extendDomain) - extend it up
  // front and nice-step the result, instead of ticking a stale domain.
  if (referenceLineValues.length > 0) {
    const extendedLower = cleanNumber(
      Math.min(lowerBound, ...referenceLineValues),
    );
    const extendedUpper = cleanNumber(
      Math.max(upperBound, ...referenceLineValues),
    );
    const expanded = getExpandableYAxisTicks(
      extendedLower,
      extendedUpper,
      5,
      axisNumberFormat,
    );
    if (expanded.ticks.length > 0) {
      return {
        domain: [extendedLower, expanded.max],
        ticks: expanded.ticks,
        tickFormatter: expanded.tickFormatter,
      };
    }
    const baseFormat = (value: number) =>
      formatAxisTick(value, axisNumberFormat);
    return {
      domain: [extendedLower, extendedUpper],
      ticks: getYAxisTicks(extendedLower, extendedUpper, baseFormat),
      tickFormatter: baseFormat,
    };
  }
  const { ticks, tickFormatter } = getNiceYAxisTicks(
    lowerBound,
    upperBound,
    5,
    axisNumberFormat,
  );
  // Same fallback as the default branch above - reduce tick count via
  // getYAxisTicks rather than leaving this to Recharts' raw default.
  if (ticks.length === 0) {
    const baseFormat = (value: number) =>
      formatAxisTick(value, axisNumberFormat);
    return {
      domain: [lowerBound, upperBound],
      ticks: getYAxisTicks(lowerBound, upperBound, baseFormat),
      tickFormatter: baseFormat,
    };
  }
  return {
    domain: [lowerBound, upperBound],
    ticks,
    tickFormatter,
  };
}

export const MemoChart = memo(function MemoChart({
  graphResults,
  setIsClickActive,
  refreshClickActive,
  isClickActive,
  dateRange,
  lineData,
  referenceLines,
  referenceLineValues = EMPTY_REFERENCE_LINE_VALUES,
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
  graphResults: any[];
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
  // Raw numeric value(s) backing referenceLines (pre-rendered JSX the axis
  // math can't read), used to size the Y-axis domain around them.
  referenceLineValues?: number[];
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

  const yAxisBounds = useMemo(
    () =>
      computeYAxisBounds(
        graphResults,
        visibleLineData,
        hasSeriesSelection(selectedSeriesNames),
        fitYAxisToData,
        displayType,
        referenceLineValues,
        axisNumberFormat,
      ),
    [
      graphResults,
      visibleLineData,
      selectedSeriesNames,
      fitYAxisToData,
      displayType,
      referenceLineValues,
      axisNumberFormat,
    ],
  );
  const yAxisDomain = yAxisBounds.domain;

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

  const yAxisTicks = yAxisBounds.ticks;
  // computeYAxisBounds already resolves ticks+formatter together per domain.
  const yAxisTickFormatter = yAxisBounds.tickFormatter ?? tickFormatter;

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

  // Typed as the tuple it actually is (assignable to AxisDomain) so the
  // annotation helpers can take it without an unsafe cast.
  const xAxisDomain: [number, number] = useMemo(() => {
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
  // Tint each marker to match the series it describes and drop the ones that
  // can't be tied to anything on this chart — see `resolveAnnotationSeries`.
  const coloredAnnotations = useMemo(() => {
    if (!annotations?.length) {
      return annotations;
    }
    return resolveAnnotationSeries(annotations, group =>
      getSeriesColorForGroup(lineData, group),
    );
  }, [annotations, lineData]);

  // Same geometry the hit layer positions against, so the hover bands can't
  // drift from the lines they belong to.
  const laidOutAnnotations = useMemo(() => {
    if (!coloredAnnotations?.length) {
      return null;
    }
    return layoutAnnotations(coloredAnnotations, {
      domain: xAxisDomain,
      plotWidth: Math.max(0, containerWidth - Y_AXIS_WIDTH),
    });
  }, [coloredAnnotations, xAxisDomain, containerWidth]);

  const [hoveredAnnotation, setHoveredAnnotation] =
    useState<HoveredAnnotation | null>(null);

  const annotationElements = useMemo(() => {
    if (!coloredAnnotations?.length) {
      return null;
    }
    return getAnnotationElements(coloredAnnotations, {
      domain: xAxisDomain,
      // Drawable width, so markers too close together share one label. Zero on
      // the first paint (before ResponsiveContainer measures), which the
      // renderer treats as "label everything".
      plotWidth: Math.max(0, containerWidth - Y_AXIS_WIDTH),
    });
  }, [coloredAnnotations, xAxisDomain, containerWidth]);

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
            tickFormatter={yAxisTickFormatter}
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
