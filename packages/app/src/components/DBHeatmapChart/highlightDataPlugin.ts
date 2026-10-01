import type { Plugin } from 'uplot';
import type uPlot from 'uplot';

import type { HeatmapPlotData } from './heatmapGrid';

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

export function highlightDataPlugin({
  proximity,
  onPointHighlight,
}: {
  proximity: number;
  onPointHighlight: (point: HighlightedPoint) => void;
}): Plugin {
  let lastDataPointIndex = -1; // Used to prevent duplicate calls
  return {
    hooks: {
      setCursor: (u: uPlot) => {
        const { top, left } = u.cursor;
        if (top == null || left == null) {
          return;
        }

        const [xs, ys, counts, x0s, x1s, y0s, y1s] = u
          .data[1] as unknown as HeatmapPlotData;

        let closestIndex = 0;
        let closestDistance = Infinity;

        for (let i = 0; i < xs.length; i++) {
          const xPx = u.valToPos(xs[i], 'x');
          const yPx = u.valToPos(ys[i], 'y');

          const distance = Math.sqrt((xPx - left) ** 2 + (yPx - top) ** 2);

          if (distance < closestDistance && counts[i] > 0) {
            closestIndex = i;
            closestDistance = distance;
          }
        }

        const xSize = Math.abs(
          u.valToPos(x1s[closestIndex], 'x') -
            u.valToPos(x0s[closestIndex], 'x'),
        );
        const ySize = Math.abs(
          u.valToPos(y1s[closestIndex], 'y') -
            u.valToPos(y0s[closestIndex], 'y'),
        );

        const xCoord = u.valToPos(xs[closestIndex], 'x');
        const yCoord = u.valToPos(ys[closestIndex], 'y');

        const { offsetLeft, offsetTop } = u.over;

        if (
          closestDistance < proximity &&
          closestIndex !== lastDataPointIndex
        ) {
          lastDataPointIndex = closestIndex;
          onPointHighlight({
            xVal: xs[closestIndex],
            yVal: ys[closestIndex],
            countVal: counts[closestIndex],
            closestDistance,
            closestIndex,
            xCoord: xCoord + offsetLeft,
            yCoord: yCoord + offsetTop,
            xSize,
            ySize,
          });
        }
      },
    },
  };
}
