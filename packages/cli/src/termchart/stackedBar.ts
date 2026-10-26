/**
 * Stacked bar (column) renderer: one column per time bucket, series
 * stacked largest first.
 */

import chalk from 'chalk';

import {
  chalkColor,
  defaultFormatValue,
  FULL_BLOCK,
  NO_DATA_TEXT,
  PARTIAL_BLOCKS,
  renderLegend,
  renderTimeAxis,
  truncate,
} from '@/termchart/ansi';
import { niceTicks, resampleLinear } from '@/termchart/scale';
import type { RenderTimeChartOptions } from '@/termchart/timeseries';

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

  // Sized for every series; the drawn legend lists only those that show up.
  const fullLegend = showLegend ? renderLegend(series, width) : '';
  const legendHeight = fullLegend ? fullLegend.split('\n').length + 1 : 0;

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

  // Adjacent bars of similar height read as one block, so leave a gap
  // column between buckets once each is wide enough to spare one.
  const isGap = (col: number) =>
    plotWidth >= buckets.length * 3 &&
    col + 1 < plotWidth &&
    colToBucket[col + 1] !== colToBucket[col];

  // Build the grid row by row (top row first)
  const drawn = new Set<string>();
  const rows: string[] = [];
  for (let row = plotHeight - 1; row >= 0; row--) {
    let line = '';
    for (let col = 0; col < plotWidth; col++) {
      if (isGap(col)) {
        line += ' ';
        continue;
      }
      const bucketIdx = colToBucket[col];
      const bucket = buckets[bucketIdx];
      // Total stacked height of this column, in rows
      const totalRows = (totals[bucketIdx] / axisMax) * plotHeight;
      if (totalRows <= row) {
        line += ' ';
        continue;
      }

      // The series covering most of the cell's filled part takes it, so a
      // partial top cell isn't handed to a thin series stacked on top.
      const cellTop = Math.min(row + 1, totalRows);
      let cum = 0;
      let cellSeries = series[series.length - 1];
      let bestOverlap = 0;
      for (const s of series) {
        const v = bucket[s.dataKey];
        const sv = typeof v === 'number' && Number.isFinite(v) ? v : 0;
        const start = cum;
        cum += (sv / axisMax) * plotHeight;
        const overlap = Math.min(cum, cellTop) - Math.max(start, row);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          cellSeries = s;
        }
        if (cum >= cellTop) break;
      }
      drawn.add(cellSeries.dataKey);
      const cellColor = cellSeries.color;

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

  // Series can go undrawn when they are too thin for a cell or when buckets
  // are merged to fit the width; the legend counts them instead of listing them.
  const shownSeries = series.filter(s => drawn.has(s.dataKey));
  const legendLines = showLegend
    ? renderLegend(
        shownSeries,
        width,
        Math.max(1, legendHeight - 1),
        series.length - shownSeries.length,
      )
    : '';

  return [
    rows.join('\n'),
    axis,
    legendLines ? '' : undefined,
    legendLines || undefined,
  ]
    .filter(part => part !== undefined)
    .join('\n');
}
