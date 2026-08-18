/**
 * Public data types for the termchart renderers.
 *
 * Data producers shape query results into these structures; renderers
 * turn them into ANSI strings. Keep this module free of any
 * application-specific imports.
 */

/** Formats a numeric value for display (axis ticks, bar values, cells). */
export type ValueFormatter = (value: number) => string;

/**
 * A named series color. Any chalk foreground color name works for
 * legends and bars; line plots support: blue, yellow, red, cyan, green,
 * magenta, blueBright, yellowBright, redBright, greenBright.
 */
export type SeriesColor = string;

export interface TimeChartSeries {
  /** Key into each graph result row holding this series' value */
  dataKey: string;
  /** Human-readable series name shown in the legend */
  displayName: string;
  /** ANSI color name for terminal rendering */
  color: SeriesColor;
}

export interface TimeChartData {
  /**
   * One row per time bucket, sorted by timestamp ascending. Keys: the
   * timestamp column (unix seconds) plus one key per series dataKey.
   */
  graphResults: Record<string, number | undefined>[];
  /** Which key in graphResults holds the bucket timestamp */
  timestampColumn: { name: string };
  series: TimeChartSeries[];
}

/** One bar/slice of a categorical (bar / pie) chart. */
export interface CategoricalEntry {
  label: string;
  value: number;
  /** ANSI color name */
  color: SeriesColor;
}

/** A column of a rendered table. */
export interface TableColumn {
  dataKey: string;
  displayName: string;
  /** Group-by columns render left-aligned and skip numeric formatting */
  isGroupColumn: boolean;
}
