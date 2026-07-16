/**
 * Pure ANSI chart renderers.
 *
 * Each function takes shaped chart data (see chartData.ts) plus target
 * dimensions and returns a string containing ANSI escape codes. They
 * are consumed by both the Ink Tile components (interactive TUI) and
 * the non-interactive `hdx chart` command, so keep them free of Ink /
 * process / terminal dependencies.
 */

import * as asciichart from 'asciichart';
import chalk from 'chalk';

import type { NumberFormat } from '@hyperdx/common-utils/dist/types';

import type {
  CategoricalEntry,
  TableChartColumn,
  TimeChartData,
} from '@/shared/chartData';
import { formatNumber } from '@/shared/formatNumber';

// ---- Shared helpers --------------------------------------------------

// eslint-disable-next-line no-control-regex -- ANSI escape sequences are control chars by definition
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI color/style escape sequences from rendered chart output.
 * Used by `hdx chart` when stdout is not a TTY (or --color never) so
 * agents and pipelines get clean text without escape-code noise.
 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}

/** Map ANSI color names (chartData palette) to asciichart color codes. */
const ASCIICHART_COLORS: Record<string, string> = {
  blue: asciichart.blue,
  yellow: asciichart.yellow,
  red: asciichart.red,
  cyan: asciichart.cyan,
  green: asciichart.green,
  magenta: asciichart.magenta,
  blueBright: asciichart.lightblue,
  yellowBright: asciichart.lightyellow,
  redBright: asciichart.lightred,
  greenBright: asciichart.lightgreen,
};

/** Map ANSI color names to chalk functions for legend / bar text. */
function chalkColor(color: string): (s: string) => string {
  const fn = (chalk as unknown as Record<string, unknown>)[color];
  return typeof fn === 'function' ? (fn as (s: string) => string) : s => s;
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/** Compact value label for axes / bars. */
function formatValue(value: number, numberFormat?: NumberFormat): string {
  if (numberFormat) {
    return formatNumber(value, numberFormat);
  }
  // Default: abbreviate large numbers like the web y-axis does
  if (Math.abs(value) >= 1000) {
    return formatNumber(value, {
      output: 'number',
      average: true,
      mantissa: 1,
    });
  }
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

/** Format a unix-seconds timestamp for the x-axis based on range span. */
function formatTimeLabel(tsSeconds: number, rangeMs: number): string {
  const d = new Date(tsSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const monthDay = `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
  if (rangeMs <= 24 * 3600_000) {
    return hhmm;
  }
  if (rangeMs <= 7 * 24 * 3600_000) {
    return `${monthDay} ${hhmm}`;
  }
  return monthDay;
}

/** Build the x-axis line + tick labels under a plot area. */
function renderTimeAxis({
  timestamps,
  gutterWidth,
  plotWidth,
}: {
  timestamps: number[];
  gutterWidth: number;
  plotWidth: number;
}): string {
  if (timestamps.length === 0) return '';
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const rangeMs = (last - first) * 1000;

  const startLabel = formatTimeLabel(first, rangeMs);
  const endLabel = formatTimeLabel(last, rangeMs);

  let labels: string;
  const midIdx = Math.floor(timestamps.length / 2);
  const midLabel = formatTimeLabel(timestamps[midIdx], rangeMs);
  const spaceForMid =
    plotWidth - startLabel.length - endLabel.length - midLabel.length - 4;
  if (spaceForMid > 0 && timestamps.length > 2) {
    const leftPad = Math.max(
      1,
      Math.floor(plotWidth / 2) -
        startLabel.length -
        Math.ceil(midLabel.length / 2),
    );
    const rightPad = Math.max(
      1,
      plotWidth -
        startLabel.length -
        leftPad -
        midLabel.length -
        endLabel.length,
    );
    labels =
      startLabel +
      ' '.repeat(leftPad) +
      midLabel +
      ' '.repeat(rightPad) +
      endLabel;
  } else {
    const midPad = Math.max(1, plotWidth - startLabel.length - endLabel.length);
    labels = startLabel + ' '.repeat(midPad) + endLabel;
  }

  return ' '.repeat(gutterWidth) + chalk.dim(labels);
}

/** Render the series legend (colored ● + name), capped to the width. */
function renderLegend(
  series: { displayName: string; color: string }[],
  width: number,
  maxLines = 2,
): string {
  const lines: string[] = [];
  let current = '';
  let currentLen = 0;
  let shown = 0;

  for (const s of series) {
    const label = `● ${truncate(s.displayName, 40)}`;
    const sep = currentLen > 0 ? '  ' : '';
    if (currentLen + sep.length + label.length > width) {
      lines.push(current);
      if (lines.length >= maxLines) {
        const remaining = series.length - shown;
        if (remaining > 0) {
          lines[lines.length - 1] += chalk.dim(`  +${remaining} more`);
        }
        return lines.join('\n');
      }
      current = '';
      currentLen = 0;
    }
    current += (currentLen > 0 ? '  ' : '') + chalkColor(s.color)(label);
    currentLen += (currentLen > 0 ? 2 : 0) + label.length;
    shown++;
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

/**
 * Linearly resample a numeric series to exactly `targetLen` points.
 * Only used for the timestamp axis, which is linear by construction —
 * data series must go through {@link resampleSeries} instead so peaks
 * are preserved exactly.
 */
function resampleLinear(values: number[], targetLen: number): number[] {
  if (values.length === 0 || targetLen <= 0) return [];
  if (values.length === 1) return new Array(targetLen).fill(values[0]);
  if (values.length === targetLen) return values;

  const out = new Array<number>(targetLen);
  const scale = (values.length - 1) / (targetLen - 1);
  for (let i = 0; i < targetLen; i++) {
    const pos = i * scale;
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = values[lo] * (1 - frac) + values[hi] * frac;
  }
  return out;
}

/**
 * Resample a data series to exactly `targetLen` points, preserving
 * peaks — unlike plain linear resampling, which samples *between*
 * buckets and attenuates narrow spikes (a 0→1→0 spike would render as
 * ~0.94, and sub-row bumps vanish entirely).
 *
 * - Upsampling (buckets ≤ columns, the auto-granularity case): every
 *   original value is placed exactly at its nearest column — matching
 *   the web (recharts), where each bucket is an exact vertex — and the
 *   columns in between are linearly interpolated.
 * - Downsampling (explicit fine granularity): each column takes the
 *   max-magnitude value of the bucket range it covers, so spikes are
 *   never dropped.
 */
export function resampleSeries(values: number[], targetLen: number): number[] {
  if (values.length === 0 || targetLen <= 0) return [];
  if (values.length === 1) return new Array(targetLen).fill(values[0]);
  if (values.length === targetLen) return values;

  const out = new Array<number>(targetLen);

  if (values.length < targetLen) {
    // Upsample: pin each bucket to its nearest column, interpolate between
    const scale = (targetLen - 1) / (values.length - 1);
    let prevCol = 0;
    out[0] = values[0];
    for (let j = 1; j < values.length; j++) {
      const col = Math.round(j * scale);
      out[col] = values[j];
      const prevVal = values[j - 1];
      const span = col - prevCol;
      for (let c = prevCol + 1; c < col; c++) {
        const frac = (c - prevCol) / span;
        out[c] = prevVal * (1 - frac) + values[j] * frac;
      }
      prevCol = col;
    }
    return out;
  }

  // Downsample: keep the max-magnitude value in each column's bucket range
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor((i * values.length) / targetLen);
    const end = Math.max(
      start + 1,
      Math.floor(((i + 1) * values.length) / targetLen),
    );
    let extremum = values[start];
    for (let j = start + 1; j < end; j++) {
      if (Math.abs(values[j]) > Math.abs(extremum)) {
        extremum = values[j];
      }
    }
    out[i] = extremum;
  }
  return out;
}

// ---- Nice y-axis ticks -------------------------------------------------

interface NiceAxis {
  niceMin: number;
  niceMax: number;
  /** Ascending tick values, niceMin..niceMax inclusive. Empty for flat data. */
  ticks: number[];
}

/** Round `x` to the nearest "nice" step: 1/2/2.5/5 ×10ⁿ. */
function niceNum(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const frac = x / 10 ** exp;
  const nice =
    frac < 1.5 ? 1 : frac < 2.25 ? 2 : frac < 3.75 ? 2.5 : frac < 7.5 ? 5 : 10;
  return nice * 10 ** exp;
}

/**
 * Compute a "nice" y-axis domain and tick values (Graphics Gems nice
 * numbers, steps of 1/2/2.5/5 ×10ⁿ). Mirrors what the web charts get
 * from recharts' `domain={[0, 'auto']}` + auto tick generation: the
 * axis is pinned at zero (extended downward for negative data) and the
 * top is rounded up to a tick boundary, so labels read 0/5/10/…30
 * instead of raw fractions of the data range like 21.73/19.92/…
 *
 * @source packages/app/src/HDXMultiSeriesTimeChart.tsx (yAxisDomain +
 *   recharts YAxis tick generation).
 */
export function niceTicks(
  dataMin: number,
  dataMax: number,
  maxTicks = 5,
): NiceAxis {
  const lo = Math.min(0, dataMin);
  const hi = dataMax;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { niceMin: lo, niceMax: hi, ticks: [] };
  }
  const step = niceNum((hi - lo) / (maxTicks - 1));
  const clean = (v: number) => Number(v.toPrecision(12));
  const niceMin = clean(Math.floor(lo / step) * step);
  const niceMax = clean(Math.ceil(hi / step) * step);
  const count = Math.round((niceMax - niceMin) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) =>
    clean(niceMin + i * step),
  );
  return { niceMin, niceMax, ticks };
}

/**
 * Format a y-axis tick value the way the web's tick formatter does:
 * compact, no decimals from the configured format.
 *
 * @source packages/app/src/HDXMultiSeriesTimeChart.tsx (tickFormatter)
 */
function formatTick(value: number, numberFormat?: NumberFormat): string {
  return numberFormat
    ? formatNumber(value, {
        ...numberFormat,
        average: true,
        mantissa: 0,
        unit: undefined,
      })
    : formatValue(value);
}

// ---- Line chart ------------------------------------------------------

export interface RenderTimeChartOptions {
  data: TimeChartData;
  width: number;
  height: number;
  numberFormat?: NumberFormat;
  showLegend?: boolean;
}

/**
 * Render a multi-series line chart via asciichart with a time x-axis
 * and colored legend.
 */
export function renderLineChart({
  data,
  width,
  height,
  numberFormat,
  showLegend = true,
}: RenderTimeChartOptions): string {
  const { graphResults, timestampColumn, series } = data;
  if (graphResults.length === 0 || series.length === 0) {
    return chalk.dim('No data found within time range.');
  }

  const timestamps = graphResults.map(
    r => (r[timestampColumn.name] ?? 0) as number,
  );

  const legendLines =
    showLegend && (series.length > 1 || series[0].displayName)
      ? renderLegend(series, width)
      : '';
  const legendHeight = legendLines ? legendLines.split('\n').length + 1 : 0;

  // Reserve rows: x-axis (1) + legend
  const plotHeight = Math.max(2, height - 1 - legendHeight);

  // y-axis label gutter: asciichart pads labels via `format`
  const labelWidth = 10;
  const gutterWidth = labelWidth + 2; // label + ' ┤'
  const plotWidth = Math.max(10, width - gutterWidth);

  // asciichart renders one column per point — resample every series to
  // exactly plotWidth points so the chart fills the full width. Peak
  // preserving: bucket values are placed exactly, never blended away.
  const seriesArrays = series.map(s =>
    resampleSeries(
      graphResults.map(r => {
        const v = r[s.dataKey];
        // asciichart cannot render NaN gaps — draw missing points at 0
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      }),
      plotWidth,
    ),
  );
  const sampledTimestamps = resampleLinear(timestamps, plotWidth).map(ts =>
    Math.round(ts),
  );

  const plotColors = series.map(
    s => ASCIICHART_COLORS[s.color] ?? asciichart.blue,
  );

  // Nice y-axis domain + sparse tick labels, mirroring the web charts
  // (recharts labels ~5 nice values, not every pixel row). Rows without
  // a tick get a blank gutter.
  const flatValues = seriesArrays.flat();
  const dataMin = Math.min(...flatValues);
  const dataMax = Math.max(...flatValues);
  const axisTicks = niceTicks(dataMin, dataMax);

  const pad = (s: string) => truncate(s, labelWidth).padStart(labelWidth);
  let plotConfig: {
    min?: number;
    max?: number;
    format: (x: number, i: number) => string;
  };
  if (axisTicks.ticks.length > 0) {
    const { niceMin, niceMax, ticks } = axisTicks;
    // Replicate asciichart's row math to know which row index each tick
    // lands on (row 0 = top = niceMax).
    const ratio = (plotHeight - 1) / (niceMax - niceMin);
    const axisRows = Math.abs(
      Math.round(niceMax * ratio) - Math.round(niceMin * ratio),
    );
    const labelByRow = new Map<number, string>();
    for (const tick of ticks) {
      const row = Math.round(
        ((niceMax - tick) / (niceMax - niceMin)) * axisRows,
      );
      if (!labelByRow.has(row)) {
        labelByRow.set(row, formatTick(tick, numberFormat));
      }
    }
    plotConfig = {
      min: niceMin,
      max: niceMax,
      format: (_x: number, i: number) => pad(labelByRow.get(i) ?? ''),
    };
  } else {
    // Flat data (single distinct value) — label the rows directly
    plotConfig = {
      format: (x: number) => pad(formatValue(x, numberFormat)),
    };
  }

  const plot = asciichart.plot(seriesArrays, {
    height: plotHeight - 1,
    colors: plotColors,
    ...plotConfig,
  });

  const axis = renderTimeAxis({
    timestamps: sampledTimestamps,
    gutterWidth,
    plotWidth,
  });

  return [plot, axis, legendLines ? '' : undefined, legendLines || undefined]
    .filter(part => part !== undefined)
    .join('\n');
}

// ---- Stacked bar chart -----------------------------------------------

const FULL_BLOCK = '█';
const PARTIAL_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Render a stacked bar (column) chart. One terminal column per time
 * bucket; series stack bottom-up with per-cell colors.
 */
export function renderStackedBarChart({
  data,
  width,
  height,
  numberFormat,
  showLegend = true,
}: RenderTimeChartOptions): string {
  const { graphResults, timestampColumn, series } = data;
  if (graphResults.length === 0 || series.length === 0) {
    return chalk.dim('No data found within time range.');
  }

  const legendLines = showLegend ? renderLegend(series, width) : '';
  const legendHeight = legendLines ? legendLines.split('\n').length + 1 : 0;

  const labelWidth = 10;
  const gutterWidth = labelWidth + 2;
  const plotHeight = Math.max(2, height - 1 - legendHeight);
  const plotWidth = Math.max(10, width - gutterWidth);

  const buckets = graphResults;

  const totals = buckets.map(b =>
    series.reduce((acc, s) => {
      const v = b[s.dataKey];
      return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0),
  );
  const maxTotal = Math.max(...totals, 0);
  if (maxTotal <= 0) {
    return chalk.dim('No data found within time range.');
  }

  // Nice y-axis: scale bars against a rounded-up axis max and label the
  // rows nearest each nice tick, mirroring the web's recharts axis
  // (stacked bars are always anchored at zero).
  const axisTicks = niceTicks(0, maxTotal);
  const axisMax = axisTicks.ticks.length > 0 ? axisTicks.niceMax : maxTotal;
  const labelByRow = new Map<number, string>();
  for (const tick of axisTicks.ticks) {
    if (tick <= 0) continue; // row 0 spans (0, 1] — no zero baseline row
    const row = Math.min(
      plotHeight - 1,
      Math.max(0, Math.round((tick / axisMax) * plotHeight) - 1),
    );
    if (!labelByRow.has(row)) {
      labelByRow.set(row, formatTick(tick, numberFormat));
    }
  }

  // Map every terminal column to a bucket so the chart fills the full
  // plot width. Upscaling (the common case — granularity quantization
  // yields fewer buckets than columns) is a nearest-neighbor stretch.
  // When downscaling (explicit fine granularity on a narrow terminal),
  // each column covers a bucket range — pick the range's max-total
  // bucket so spikes are never silently dropped.
  const colToBucket = Array.from({ length: plotWidth }, (_, col) => {
    const start = Math.min(
      buckets.length - 1,
      Math.floor((col * buckets.length) / plotWidth),
    );
    const end = Math.max(
      start + 1,
      Math.min(
        buckets.length,
        Math.floor(((col + 1) * buckets.length) / plotWidth),
      ),
    );
    let best = start;
    for (let j = start + 1; j < end; j++) {
      if (totals[j] > totals[best]) best = j;
    }
    return best;
  });

  // Build the grid row by row (top row first)
  const rows: string[] = [];
  for (let row = plotHeight - 1; row >= 0; row--) {
    let line = '';
    for (let col = 0; col < plotWidth; col++) {
      const bucketIdx = colToBucket[col];
      const bucket = buckets[bucketIdx];
      // Total stacked height of this column, in rows
      const totalRows = (totals[bucketIdx] / axisMax) * plotHeight;
      if (totalRows <= row) {
        line += ' ';
        continue;
      }

      // Which series occupies this row? Find via cumulative heights.
      let cum = 0;
      let cellColor = series[series.length - 1].color;
      const target = Math.min(row + 0.5, totalRows - 0.001);
      for (const s of series) {
        const v = bucket[s.dataKey];
        const sv = typeof v === 'number' && Number.isFinite(v) ? v : 0;
        cum += (sv / axisMax) * plotHeight;
        if (cum > target) {
          cellColor = s.color;
          break;
        }
      }

      if (totalRows >= row + 1) {
        line += chalkColor(cellColor)(FULL_BLOCK);
      } else {
        const fraction = totalRows - row;
        const idx = Math.max(0, Math.min(7, Math.round(fraction * 8) - 1));
        line += chalkColor(cellColor)(PARTIAL_BLOCKS[idx]);
      }
    }

    // y-axis label on nice tick rows
    const label = labelByRow.has(row)
      ? truncate(labelByRow.get(row) as string, labelWidth).padStart(labelWidth)
      : ' '.repeat(labelWidth);
    rows.push(`${chalk.dim(label)} ${chalk.dim('┤')}${line}`);
  }

  const timestamps = resampleLinear(
    buckets.map(r => (r[timestampColumn.name] ?? 0) as number),
    plotWidth,
  ).map(ts => Math.round(ts));
  const axis = renderTimeAxis({
    timestamps,
    gutterWidth,
    plotWidth,
  });

  return [
    rows.join('\n'),
    axis,
    legendLines ? '' : undefined,
    legendLines || undefined,
  ]
    .filter(part => part !== undefined)
    .join('\n');
}

// ---- Categorical bar chart (bar + pie) --------------------------------

export function renderCategoricalChart({
  entries,
  width,
  height,
  numberFormat,
  showPercentages = false,
}: {
  entries: CategoricalEntry[];
  width: number;
  height: number;
  numberFormat?: NumberFormat;
  /** Pie charts show each slice's share of the total */
  showPercentages?: boolean;
}): string {
  if (entries.length === 0) {
    return chalk.dim('No data found within time range.');
  }

  const visible = entries.slice(0, Math.max(1, height - 1));
  const hiddenCount = entries.length - visible.length;

  const total = entries.reduce((acc, e) => acc + e.value, 0);
  const maxValue = Math.max(...visible.map(e => e.value), 0);

  const labelWidth = Math.min(
    Math.max(...visible.map(e => e.label.length), 5),
    Math.max(10, Math.floor(width * 0.3)),
  );

  const valueLabels = visible.map(e => {
    const v = formatValue(e.value, numberFormat);
    return showPercentages && total > 0
      ? `${v} (${((e.value / total) * 100).toFixed(1)}%)`
      : v;
  });
  const valueWidth = Math.max(...valueLabels.map(v => v.length));

  const barWidth = Math.max(5, width - labelWidth - valueWidth - 4);

  const lines = visible.map((e, i) => {
    const label = truncate(e.label, labelWidth).padEnd(labelWidth);
    const barLen =
      maxValue > 0
        ? Math.max(1, Math.round((e.value / maxValue) * barWidth))
        : 0;
    const bar = chalkColor(e.color)(FULL_BLOCK.repeat(barLen));
    return `${chalk.dim(label)} ${bar} ${valueLabels[i]}`;
  });

  if (hiddenCount > 0) {
    lines.push(chalk.dim(`… +${hiddenCount} more`));
  }

  return lines.join('\n');
}

// ---- Number chart ----------------------------------------------------

export function renderNumberChart({
  value,
  width,
  height,
  numberFormat,
}: {
  value: number | string | undefined;
  width: number;
  height: number;
  numberFormat?: NumberFormat;
}): string {
  const formatted = formatNumber(
    value as number | string | undefined,
    numberFormat,
  );
  // Center vertically and horizontally within the tile area
  const padTop = Math.max(0, Math.floor((height - 1) / 2));
  const padLeft = Math.max(0, Math.floor((width - formatted.length) / 2));
  return '\n'.repeat(padTop) + ' '.repeat(padLeft) + chalk.bold(formatted);
}

// ---- Table chart -----------------------------------------------------

export function renderTableChart({
  rows,
  columns,
  width,
  height,
  formatByColumn,
  defaultNumberFormat,
}: {
  rows: Record<string, unknown>[];
  columns: TableChartColumn[];
  width: number;
  height: number;
  formatByColumn?: Map<string, NumberFormat>;
  defaultNumberFormat?: NumberFormat;
}): string {
  if (rows.length === 0 || columns.length === 0) {
    return chalk.dim('No data found within time range.');
  }

  const visibleRows = rows.slice(0, Math.max(1, height - 2));
  const hiddenCount = rows.length - visibleRows.length;

  // Format cell values first so widths account for formatting
  const formatCell = (col: TableChartColumn, raw: unknown): string => {
    if (raw == null) return '';
    if (!col.isGroupColumn) {
      const nf = formatByColumn?.get(col.dataKey) ?? defaultNumberFormat;
      const asNumber = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(asNumber)) {
        return nf ? formatNumber(asNumber, nf) : formatValue(asNumber);
      }
    }
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  };

  const table: string[][] = visibleRows.map(row =>
    columns.map(col => formatCell(col, row[col.dataKey])),
  );

  // Column widths: fit content, then shrink the widest columns to fit
  const colWidths = columns.map((col, i) =>
    Math.max(col.displayName.length, ...table.map(r => r[i].length), 3),
  );
  const sepWidth = 2;
  const totalWidth = () =>
    colWidths.reduce((a, b) => a + b, 0) + sepWidth * (columns.length - 1);
  while (totalWidth() > width) {
    const widest = colWidths.indexOf(Math.max(...colWidths));
    if (colWidths[widest] <= 5) break;
    colWidths[widest] -= 1;
  }

  const isNumericColumn = columns.map(
    (col, i) =>
      !col.isGroupColumn &&
      table.some(
        r =>
          r[i] !== '' && Number.isFinite(Number(r[i].replace(/[^0-9.-]/g, ''))),
      ),
  );

  const renderRow = (cells: string[], styler?: (s: string) => string) =>
    cells
      .map((cell, i) => {
        const truncated = truncate(cell, colWidths[i]);
        const padded = isNumericColumn[i]
          ? truncated.padStart(colWidths[i])
          : truncated.padEnd(colWidths[i]);
        return styler ? styler(padded) : padded;
      })
      .join(' '.repeat(sepWidth));

  const lines: string[] = [];
  lines.push(
    renderRow(
      columns.map(c => c.displayName),
      s => chalk.bold.underline(s),
    ),
  );
  for (const row of table) {
    lines.push(renderRow(row));
  }
  if (hiddenCount > 0) {
    lines.push(chalk.dim(`… +${hiddenCount} more rows`));
  }

  return lines.join('\n');
}

// ---- Markdown --------------------------------------------------------

/** Minimal markdown → terminal text (headers bolded, rest passed through). */
export function renderMarkdown(markdown: string, width: number): string {
  return markdown
    .split('\n')
    .map(line => {
      const header = line.match(/^#{1,6}\s+(.*)$/);
      if (header) {
        return chalk.bold(truncate(header[1], width));
      }
      return line;
    })
    .join('\n');
}
