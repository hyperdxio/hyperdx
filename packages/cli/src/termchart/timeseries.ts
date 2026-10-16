/**
 * Time-series line chart renderer. Pure function: shaped data plus
 * dimensions in, ANSI string out. Stacked bars live in stackedBar.ts.
 */

import chalk from 'chalk';

import {
  defaultFormatValue,
  NO_DATA_TEXT,
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
