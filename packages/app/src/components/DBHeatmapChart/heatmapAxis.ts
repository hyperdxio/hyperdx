import type uPlot from 'uplot';

import { NumberFormat } from '@/types';
import { formatDurationMsCompact, formatNumber, truncateMiddle } from '@/utils';

import type { HeatmapScaleType } from './heatmapGrid';

/** Number format for a heatmap of trace durations in ms. */
export const HEATMAP_DURATION_NUMBER_FORMAT = {
  output: 'duration',
  factor: 0.001,
} as const satisfies NumberFormat;

/** Format a plot-space y value as a y-axis / tooltip label. */
export function formatHeatmapTick(
  value: number,
  scaleType: HeatmapScaleType,
  numberFormat: NumberFormat | undefined,
) {
  // y-values are stored in log space for log scale; exponentiate back
  // to the actual value before formatting.
  const actualValue = scaleType === 'log' ? Math.exp(value) : value;

  if (numberFormat?.unit === 'ms' || numberFormat?.output === 'duration') {
    const msValue =
      numberFormat?.output === 'duration'
        ? actualValue * (numberFormat?.factor ?? 1) * 1000
        : actualValue;
    return formatDurationMsCompact(msValue);
  }

  return numberFormat
    ? formatNumber(actualValue, {
        ...numberFormat,
        average: true,
        mantissa: Math.abs(actualValue) >= 1 ? 0 : 2,
      })
    : new Intl.NumberFormat('en-US', {
        notation: 'compact',
        compactDisplay: 'short',
      }).format(actualValue);
}

/**
 * Log-scale y-axis splits at powers of 10 (0.01, 0.1, 1, 10, 100…) so labels
 * are clean round numbers instead of arbitrary positions in log space.
 * `yMin`/`yMax` and the returned splits are natural-log values.
 */
export function logScaleSplits(yMin: number, yMax: number): number[] {
  const realMin = Math.exp(yMin);
  const realMax = Math.exp(yMax);
  const splits: number[] = [];
  // Generate powers of 10 within range
  const startExp = Math.floor(Math.log10(realMin));
  const endExp = Math.ceil(Math.log10(realMax));
  for (let e = startExp; e <= endExp; e++) {
    const v = Math.pow(10, e);
    const logV = Math.log(v);
    if (logV >= yMin && logV <= yMax) {
      splits.push(logV);
    }
  }
  // If too few splits, add intermediate values (×3)
  if (splits.length < 3) {
    for (let e = startExp; e <= endExp; e++) {
      for (const mult of [1, 3]) {
        const v = mult * Math.pow(10, e);
        const logV = Math.log(v);
        if (logV >= yMin && logV <= yMax) {
          splits.push(logV);
        }
      }
    }
    // Deduplicate and sort
    return [...new Set(splits)].sort((a, b) => a - b);
  }
  return splits;
}

const SERIES_LABEL_MAX_LENGTH = 24;

/** Series-axis ticks, one centered on each row. */
function seriesRowSplits(rowCount: number): number[] {
  return Array.from({ length: rowCount }, (_, r) => r + 0.5);
}

function formatSeriesTick(labels: string[], value: number) {
  return truncateMiddle(
    labels[Math.floor(value)] ?? '',
    SERIES_LABEL_MAX_LENGTH,
  );
}

/**
 * uPlot y scale and y axis overrides for a heatmap's y axis. A series axis is
 * pinned to its rows with one label centered on each; a numeric axis formats
 * its ticks, placed at powers of 10 on a log scale.
 */
export function heatmapYAxisOptions(
  seriesLabels: string[] | undefined,
  scaleType: HeatmapScaleType,
  tickFormatter: (value: number) => string,
): { scale?: uPlot.Scale; axis: Pick<uPlot.Axis, 'values' | 'splits'> } {
  if (seriesLabels != null) {
    return {
      scale: { auto: false, range: [0, Math.max(1, seriesLabels.length)] },
      axis: {
        values: (_u: uPlot, vals: number[]) =>
          vals.map(v => formatSeriesTick(seriesLabels, v)),
        splits: () => seriesRowSplits(seriesLabels.length),
      },
    };
  }

  return {
    axis: {
      values: (_u: uPlot, vals: number[]) => vals.map(tickFormatter),
      ...(scaleType === 'log'
        ? {
            splits: (u: uPlot) => {
              const [yMin, yMax] =
                u.scales.y!.min != null
                  ? [u.scales.y!.min, u.scales.y!.max!]
                  : [0, 1];
              return logScaleSplits(yMin, yMax);
            },
          }
        : {}),
    },
  };
}

/** Format a series-mode cell value for the tooltip. */
export function formatHeatmapValue(
  value: number,
  numberFormat: NumberFormat | undefined,
) {
  return numberFormat
    ? formatNumber(value, numberFormat)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        value,
      );
}
