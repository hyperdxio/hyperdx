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
  const hasSelection = hasSeriesSelection(selectedSeriesNames);
  if (hasSelection) {
    return lineData
      .filter(ld => selectedSeriesNames.has(getSeriesDisplayName(ld)))
      .slice(0, HARD_LINES_LIMIT);
  }
  return lineData.slice(0, HARD_LINES_LIMIT);
}
