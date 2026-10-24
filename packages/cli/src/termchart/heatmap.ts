/**
 * Heatmap renderer: time across, value buckets down, each cell shaded by
 * how many events landed in it.
 */

import chalk from 'chalk';

import {
  chalkColor,
  defaultFormatValue,
  NO_DATA_TEXT,
  renderTimeAxis,
  truncate,
} from '@/termchart/ansi';
import { resampleLinear } from '@/termchart/scale';
import type { HeatmapData, ValueFormatter } from '@/termchart/types';

const SHADES = ['░', '▒', '▓', '█'];
const SHADE_COLORS = ['blue', 'cyan', 'yellow', 'red'];
const LABEL_WIDTH = 10;

/** The source index range each of `length` output slots covers, summed when shrinking. */
function slotRange(slot: number, length: number, from: number, count: number) {
  const start = from + Math.floor((slot * count) / length);
  const end = Math.max(
    start + 1,
    from + Math.floor(((slot + 1) * count) / length),
  );
  return [start, end] as const;
}

export function renderHeatmapChart({
  data,
  width,
  height,
  formatTick = defaultFormatValue,
}: {
  data: HeatmapData;
  width: number;
  height: number;
  formatTick?: ValueFormatter;
}): string {
  const { times, rowEdges, counts } = data;
  const rowCount = rowEdges.length - 1;
  const populated = Array.from({ length: rowCount }, (_, r) =>
    counts.some(column => (column[r] ?? 0) > 0),
  );
  const first = populated.indexOf(true);
  const last = populated.lastIndexOf(true);
  if (first === -1 || times.length === 0) return chalk.dim(NO_DATA_TEXT);

  const gutterWidth = LABEL_WIDTH + 2;
  const plotWidth = Math.max(10, width - gutterWidth);
  const plotHeight = Math.max(2, height - 3);
  const visibleRows = last - first + 1;

  const cells = Array.from({ length: plotHeight }, (_, row) => {
    const [r0, r1] = slotRange(row, plotHeight, first, visibleRows);
    return Array.from({ length: plotWidth }, (_, col) => {
      const [t0, t1] = slotRange(col, plotWidth, 0, times.length);
      let sum = 0;
      for (let t = t0; t < t1; t++)
        for (let r = r0; r < r1; r++) sum += counts[t]?.[r] ?? 0;
      return sum;
    });
  });
  const max = Math.max(...cells.flat());

  // Event counts are heavy-tailed, so shade on a log scale or one dense
  // bucket washes out everything else.
  const shade = (v: number) => {
    if (v <= 0) return ' ';
    const level = Math.min(
      3,
      Math.floor((Math.log1p(v) / Math.log1p(max)) * 4 - 1e-9),
    );
    return chalkColor(SHADE_COLORS[level])(SHADES[level]);
  };

  const labels = new Map([
    [plotHeight - 1, rowEdges[last + 1]],
    [Math.floor(plotHeight / 2), rowEdges[first + Math.round(visibleRows / 2)]],
    [0, rowEdges[first]],
  ]);
  const lines = cells
    .map((columns, row) => {
      const value = labels.get(row);
      const label =
        value === undefined
          ? ' '.repeat(LABEL_WIDTH)
          : truncate(formatTick(value), LABEL_WIDTH).padStart(LABEL_WIDTH);
      return `${chalk.dim(label)} ${chalk.dim('┤')}${columns.map(shade).join('')}`;
    })
    .reverse();

  const axis = renderTimeAxis({
    timestamps: resampleLinear(times, plotWidth).map(Math.round),
    gutterWidth,
    plotWidth,
  });
  const legend = `${SHADES.map((s, i) => chalkColor(SHADE_COLORS[i])(s)).join('')} ${chalk.dim(
    `events per cell, max ${defaultFormatValue(max)}`,
  )}`;

  return [...lines, axis, '', legend].join('\n');
}
