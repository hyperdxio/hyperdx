import { type LineData, MAX_TIME_CHART_SERIES } from '@/ChartUtils';
export const HARD_LINES_LIMIT = MAX_TIME_CHART_SERIES;

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
