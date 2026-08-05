import { type LineData, MAX_TIME_CHART_SERIES } from '@/ChartUtils';
import type { NumberFormat } from '@/types';
import { formatNumber } from '@/utils';

export const HARD_LINES_LIMIT = MAX_TIME_CHART_SERIES;

// Debounce (ms) for the chart's ResponsiveContainer resize observer. Without
// it the observer fires on every frame, and a resize → re-render → resize
// cycle can keep the chart (and the form controls around it in the tile

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
export const getSeriesDisplayName = (ld: LineData) =>
  ld.displayName || ld.dataKey;

/**
 * Stable, CSS-safe class for a series' <Area>, unique per chart (`id`) and
 * series (`dataKey`). Lets the nearest-cursor emphasis target one line via CSS
 * without changing any <Area> prop (which would rebuild every line on hover).
 */
export const seriesClassName = (id: string, dataKey: string) =>
  `hdx-series-${id}-${dataKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

// The subset of recharts' loosely-typed chart mouse-event `state` we read.
export type ChartMouseState = {
  activeLabel?: string | number;
  activeCoordinate?: { x?: number; y?: number };
};

/** Normalize a chart event's active label (number | string) to a string. */
export const getActiveLabel = (state?: {
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
 * Whether a series selection is active. The single source of truth for the
 * "isolate to these series" predicate that gates line visibility, the y-axis
 * domain, legend dimming, and the "Show All Series" control — so those can't
 * drift out of sync.
 */
export function hasSeriesSelection(
  selectedSeriesNames: Set<string> | undefined,
): selectedSeriesNames is Set<string> {
  return !!selectedSeriesNames && selectedSeriesNames.size > 0;
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

/**
 * A tick under MAGNITUDE_THRESHOLD gets at most this many decimal places,
 * regardless of a chart's configured Decimals (which can go up to 10 - see
 * NumberFormat.tsx). A tick >= MAGNITUDE_THRESHOLD is always an integer (see
 * formatAxisTick) and so isn't governed by this - only a label under the
 * threshold, with its own decimals, can make it wide.
 *
 * `<YAxis width={Y_AXIS_WIDTH}>` leaves a few dozen px for the label itself
 * after Recharts' own tickSize + tickMargin. Measured in Chrome at 11px IBM
 * Plex Mono (the tick font, monospace): every character costs ~6.6px, and
 * 5 characters is the most that fits. At 2 decimals, "9.99" (4 chars) fits
 * with room to spare, and adding a single extra character - a negative
 * sign ("-9.99") or a percent suffix ("9.99%") - still exactly fits at 5.
 * A 2-digit integer part pushes either of those over (6 chars, e.g.
 * "-99.99"/"99.99%" both clip), which is why MAGNITUDE_THRESHOLD is 10, not
 * 100: it trades a wider decimal-preserving range for values that are both
 * negative and percent-formatted (out of scope here) for one that's safe
 * for plain positive numbers, percent, and negative numbers each on their
 * own - the only combination this codebase's charts have needed decimals
 * for so far. 2 decimals is also enough to keep any value >= 0.005
 * distinguishable from 0, the failure this cap exists to fix.
 */
const MAX_AXIS_MANTISSA = 2;

/** See MAX_AXIS_MANTISSA's comment for the width math behind this value. */
const MAGNITUDE_THRESHOLD = 10;

/**
 * Y-axis tick label formatter. Exported so a unit test can pin the
 * mantissa-precedence behavior without rendering recharts.
 *
 * `average` and `unit` are always forced (compact abbreviation like `1.2k`
 * reads better on an axis than a series' configured unit repeated on every
 * tick). For a tick at or past MAGNITUDE_THRESHOLD, mantissa is always 0 -
 * large numbers stay `200`/`1k`/`256 MB`, never `200.00`/`1.23k`/`256.0 MB`,
 * however many decimals the chart's Number Format configures. Below the
 * threshold, an explicit axisNumberFormat.mantissa is honored (capped at
 * MAX_AXIS_MANTISSA) rather than forced to 0. Without that, a chart whose
 * configured Decimals produces correct tooltip/legend values (e.g. `0.14`)
 * would still round every axis tick to `0` for any series whose values live
 * under 1 (fractional Prometheus gauges, ratios, etc.). A tick of exactly 0
 * always short-circuits to an integer too - it's already unambiguous, and
 * doesn't need the decimal rescue this formatter exists to provide.
 *
 * An explicit mantissa is the common case, not a rare one, which is why the
 * large-magnitude branch can't just honor it: HyperDX's own bundled
 * dashboard templates (go-runtime.json et al.) set mantissa on lines/byte/
 * percent tiles for tooltip readability, with values well above the
 * near-zero problem this formatter fixes.
 *
 * `formatNumber` multiplies a percent-output value by 100 before applying
 * mantissa (a percent tile's raw value is a 0-1 ratio, e.g. `0.25` for
 * "25%"), so the magnitude check runs against that same displayed value,
 * not the raw one - otherwise every percent tile would take the small-
 * magnitude branch regardless of how large the rendered percentage is.
 *
 * This diverges from DBHeatmapChart's tickFormatter (magnitude-aware at a
 * >= 1 threshold, but ignoring configured mantissa entirely for values
 * under it) - a deliberate difference in both the threshold and whether
 * configured mantissa is honored at all, not an oversight.
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

  const displayed = axisNumberFormat.output === 'percent' ? value * 100 : value;

  return formatNumber(value, {
    ...axisNumberFormat,
    mantissa:
      displayed === 0 || Math.abs(displayed) >= MAGNITUDE_THRESHOLD
        ? 0
        : Math.min(axisNumberFormat.mantissa ?? 0, MAX_AXIS_MANTISSA),
    average: true,
    unit: undefined,
  });
}
