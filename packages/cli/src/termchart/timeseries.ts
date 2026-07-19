/**
 * Time-series renderers: multi-series line chart and stacked bar
 * (column) chart. Pure functions — shaped data plus dimensions in, ANSI
 * string out.
 */

import chalk from 'chalk';

import {
  chalkColor,
  defaultFormatValue,
  FULL_BLOCK,
  NO_DATA_TEXT,
  PARTIAL_BLOCKS,
  PLOT_COLORS,
  renderLegend,
  renderTimeAxis,
  truncate,
} from '@/termchart/ansi';
import { plotLines } from '@/termchart/plot';
import { niceTicks, resampleLinear, resampleSeries } from '@/termchart/scale';
import type { TimeChartData, ValueFormatter } from '@/termchart/types';

export interface RenderTimeChartOptions {
  data: TimeChartData;
  width: number;
  height: number;
  /** Y-axis tick label formatter. Default: compact number formatting */
  formatTick?: ValueFormatter;
  showLegend?: boolean;
}

/**
 * Render a multi-series line chart with a nice-tick y-axis, time
 * x-axis, and colored legend.
 */
export function renderLineChart({
  data,
  width,
  height,
  formatTick = defaultFormatValue,
  showLegend = true,
}: RenderTimeChartOptions): string {
  const { graphResults, timestampColumn, series } = data;
  if (graphResults.length === 0 || series.length === 0) {
    return chalk.dim(NO_DATA_TEXT);
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

  // y-axis label gutter: the plotter pads labels via `format`
  const labelWidth = 10;
  const gutterWidth = labelWidth + 2; // label + ' ┤'
  const plotWidth = Math.max(10, width - gutterWidth);

  // The plotter renders one column per point — resample every series to
  // exactly plotWidth points so the chart fills the full width. Peak
  // preserving: bucket values are placed exactly, never blended away.
  // Missing / NULL cells become NaN and render as line gaps, not zeros.
  const seriesArrays = series.map(s =>
    resampleSeries(
      graphResults.map(r => {
        const v = r[s.dataKey];
        return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
      }),
      plotWidth,
    ),
  );
  const sampledTimestamps = resampleLinear(timestamps, plotWidth).map(ts =>
    Math.round(ts),
  );

  const plotColors = series.map(s => PLOT_COLORS[s.color] ?? PLOT_COLORS.blue);

  // Nice y-axis domain + sparse tick labels (~5 nice values, not every
  // row). Rows without a tick get a blank gutter.
  const finiteValues = seriesArrays.flat().filter(v => Number.isFinite(v));
  if (finiteValues.length === 0) {
    return chalk.dim(NO_DATA_TEXT);
  }
  const dataMin = Math.min(...finiteValues);
  const dataMax = Math.max(...finiteValues);
  const axisTicks = niceTicks(dataMin, dataMax);

  const pad = (s: string) => truncate(s, labelWidth).padStart(labelWidth);
  let plotConfig: {
    min?: number;
    max?: number;
    format: (x: number, i: number) => string;
  };
  if (axisTicks.ticks.length > 0) {
    const { niceMin, niceMax, ticks } = axisTicks;
    // Replicate the plotter's row math to know which row index each
    // tick lands on (row 0 = top = niceMax).
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
        labelByRow.set(row, formatTick(tick));
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
      format: (x: number) => pad(formatTick(x)),
    };
  }

  const plot = plotLines(seriesArrays, {
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

/**
 * Render a stacked bar (column) chart. One terminal column per time
 * bucket; series stack bottom-up with per-cell colors.
 */
export function renderStackedBarChart({
  data,
  width,
  height,
  formatTick = defaultFormatValue,
  showLegend = true,
}: RenderTimeChartOptions): string {
  const { graphResults, timestampColumn, series } = data;
  if (graphResults.length === 0 || series.length === 0) {
    return chalk.dim(NO_DATA_TEXT);
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
    return chalk.dim(NO_DATA_TEXT);
  }

  // Nice y-axis: scale bars against a rounded-up axis max and label the
  // rows nearest each nice tick (stacked bars are anchored at zero).
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
      labelByRow.set(row, formatTick(tick));
    }
  }

  // Map every terminal column to a bucket so the chart fills the full
  // plot width. Upscaling (the common case) is a nearest-neighbor
  // stretch. When downscaling, each column covers a bucket range — pick
  // the range's max-total bucket so spikes are never silently dropped.
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
