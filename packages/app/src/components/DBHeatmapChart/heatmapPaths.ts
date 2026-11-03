import uPlot from 'uplot';

import type { HeatmapCellKind, HeatmapPlotData } from './heatmapGrid';
import { makeCellsToFills } from './palette';

// Adapted from: https://github.com/leeoniya/uPlot/blob/a4edb297a9b80baf781f4d05a40fb52fae737bff/demos/latency-heatmap.html#L436
// Each cell is drawn from its own extent (x0..x1, y0..y1) rather than from a
// bin size inferred from the data layout, so rows may have uneven heights.
export function heatmapPaths(opts: {
  disp: { fill: { lookup: string[]; values: any } };
}) {
  const { disp } = opts;

  return (u: uPlot, seriesIdx: number, _idx0: number, _idx1: number) => {
    uPlot.orient(
      u,
      seriesIdx,
      (
        _series,
        _dataX,
        _dataY,
        scaleX,
        scaleY,
        valToPosX,
        valToPosY,
        xOff,
        yOff,
        xDim,
        yDim,
        _moveTo,
        _lineTo,
        rect,
        _arc,
      ) => {
        // mode 2 data format is not supported in types properly
        const d = u.data[seriesIdx] as unknown as HeatmapPlotData;
        const [xs, ys, , x0s, x1s, y0s, y1s] = d;

        // fill colors are mapped from interpolating densities / counts along some gradient
        // (should be quantized to 64 colors/levels max. e.g. 16)
        const fills = disp.fill.values(u, seriesIdx);
        const fillPalette = disp.fill.lookup ?? [...new Set(fills)];
        const fillPaths = fillPalette.map(() => new Path2D());

        for (let i = 0; i < xs.length; i++) {
          // filter out empty cells (no palette index) and out of view
          if (
            fills[i] >= 0 &&
            xs[i] >= (scaleX.min ?? -Infinity) &&
            xs[i] <= (scaleX.max ?? Infinity) &&
            ys[i] >= (scaleY.min ?? -Infinity) &&
            ys[i] <= (scaleY.max ?? Infinity)
          ) {
            const left = valToPosX(x0s[i], scaleX, xDim, xOff);
            const right = valToPosX(x1s[i], scaleX, xDim, xOff);
            const bottom = valToPosY(y0s[i], scaleY, yDim, yOff);
            const top = valToPosY(y1s[i], scaleY, yDim, yOff);

            // Snap both edges (not just the origin) so adjacent cells share a
            // pixel boundary; a fractional size leaves antialiased seams.
            const x0 = Math.round(left);
            const y0 = Math.round(bottom);
            rect(
              fillPaths[fills[i]],
              x0,
              y0,
              Math.round(right) - x0,
              Math.round(top) - y0,
            );
          }
        }

        u.ctx.save();

        u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
        u.ctx.clip();

        fillPaths.forEach((p, i) => {
          u.ctx.fillStyle = fillPalette[i];
          u.ctx.fill(p);
        });
        u.ctx.restore();
      },
    );

    return null;
  };
}

export const HEATMAP_AXIS_FONT = '12px IBM Plex Mono, monospace';

const axis: uPlot.Axis = {
  stroke: 'rgba(102,102,102,1)', // color of the axis line
  font: HEATMAP_AXIS_FONT,
  grid: {
    show: true, // show grid lines
    stroke: 'rgba(52,58,64)', // grid line color
    dash: [3, 3],
    width: 1,
  },
  border: {
    show: true,
    // stroke: 'rgba(82,82,82)', // grid line color
    stroke: 'rgba(102,102,102,1)', // color of the axis line
    width: 1,
  },
};

export const baseHeatmapOptions: uPlot.Options = {
  width: 1500,
  height: 600,
  mode: 2,
  ms: 1,
  padding: [8, 8, 0, 4],
  legend: {
    show: false,
  },
  scales: {
    x: {
      time: true,
    },
  },
  axes: [
    {
      ...axis,
      gap: 10,
      space: 60,
    },
    {
      ...axis,
    },
  ],
  series: [
    {},
    {
      label: 'Latency',
      // paths and fill colors are set dynamically per theme in the
      // HeatmapPlot component's useMemo — see buildSeriesForPalette().
      facets: [
        {
          scale: 'x',
          auto: true,
          sorted: 1,
        },
        {
          scale: 'y',
          auto: true,
        },
      ],
    },
  ],
};

/** Build the series[1] overrides for a given palette. */
export function buildSeriesForPalette(
  colors: string[],
  cellKind: HeatmapCellKind,
): Partial<uPlot.Series> {
  return {
    paths: heatmapPaths({
      disp: {
        fill: {
          lookup: colors,
          values: makeCellsToFills(colors, cellKind),
        },
      },
    }),
  };
}
