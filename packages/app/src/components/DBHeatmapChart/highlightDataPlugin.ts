import type { Plugin } from 'uplot';
import type uPlot from 'uplot';

import {
  type HeatmapCellKind,
  type HeatmapPlotData,
  isEmptyHeatmapCell,
} from './heatmapGrid';

export type HighlightedPoint = {
  // data point values
  xVal: number;
  yVal: number;
  countVal: number;
  // distance data
  closestDistance: number;
  closestIndex: number;
  // bounding box for data point in css parent unit
  xCoord: number;
  yCoord: number;
  xSize: number;
  ySize: number;
};

/** Pixel distance from a point to a rectangle; 0 when the point is inside. */
function distanceToRect(
  x: number,
  y: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  const dx = Math.max(left - x, 0, x - right);
  const dy = Math.max(top - y, 0, y - bottom);
  return Math.hypot(dx, dy);
}

/**
 * Reports the non-empty cell under the cursor, or the closest one within
 * `margin` pixels of its edge. Reports `undefined` when there is none.
 */
export function highlightDataPlugin({
  margin,
  cellKind,
  onPointHighlight,
}: {
  margin: number;
  cellKind: HeatmapCellKind;
  onPointHighlight: (point: HighlightedPoint | undefined) => void;
}): Plugin {
  return {
    hooks: {
      setCursor: (u: uPlot) => {
        const { top, left } = u.cursor;
        if (top == null || left == null) {
          return;
        }

        const [xs, ys, counts, x0s, x1s, y0s, y1s] = u
          .data[1] as unknown as HeatmapPlotData;

        // Cells outside the margin box around the cursor can't be within
        // `margin`, so skip them with data-space comparisons before paying
        // for pixel conversions.
        const xLo = u.posToVal(left - margin, 'x');
        const xHi = u.posToVal(left + margin, 'x');
        const yA = u.posToVal(top - margin, 'y');
        const yB = u.posToVal(top + margin, 'y');
        const yLo = Math.min(yA, yB);
        const yHi = Math.max(yA, yB);

        // Edge cells extend past the plot area (the first and last columns
        // are centered on the range bounds). The canvas clips them, so clip
        // the reported box to match.
        const plotWidth = u.over.clientWidth;
        const plotHeight = u.over.clientHeight;
        const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

        let closestIndex = -1;
        let closestDistance = Infinity;
        let box = { left: 0, right: 0, top: 0, bottom: 0 };

        for (let i = 0; i < xs.length && closestDistance > 0; i++) {
          if (isEmptyHeatmapCell(counts[i], cellKind)) continue;
          if (x1s[i] < xLo || x0s[i] > xHi || y1s[i] < yLo || y0s[i] > yHi) {
            continue;
          }

          const x0 = u.valToPos(x0s[i], 'x');
          const x1 = u.valToPos(x1s[i], 'x');
          const y0 = u.valToPos(y0s[i], 'y');
          const y1 = u.valToPos(y1s[i], 'y');
          const cell = {
            left: clamp(Math.min(x0, x1), plotWidth),
            right: clamp(Math.max(x0, x1), plotWidth),
            top: clamp(Math.min(y0, y1), plotHeight),
            bottom: clamp(Math.max(y0, y1), plotHeight),
          };
          const distance = distanceToRect(
            left,
            top,
            cell.left,
            cell.right,
            cell.top,
            cell.bottom,
          );

          if (distance < closestDistance) {
            closestIndex = i;
            closestDistance = distance;
            box = cell;
          }
        }

        if (closestIndex < 0 || closestDistance > margin) {
          onPointHighlight(undefined);
          return;
        }

        const { offsetLeft, offsetTop } = u.over;

        onPointHighlight({
          xVal: xs[closestIndex],
          yVal: ys[closestIndex],
          countVal: counts[closestIndex],
          closestDistance,
          closestIndex,
          xCoord: (box.left + box.right) / 2 + offsetLeft,
          yCoord: (box.top + box.bottom) / 2 + offsetTop,
          xSize: box.right - box.left,
          ySize: box.bottom - box.top,
        });
      },
    },
  };
}
