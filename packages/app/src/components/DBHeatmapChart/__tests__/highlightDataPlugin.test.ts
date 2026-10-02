import type uPlot from 'uplot';

import { gridToPlotData } from '@/components/DBHeatmapChart/heatmapGrid';
import { highlightDataPlugin } from '@/components/DBHeatmapChart/highlightDataPlugin';

// Identity x positions; y pixels grow downward (pixel = 100 - 10 * value).
const valToPos = (v: number, axis: 'x' | 'y') =>
  axis === 'x' ? v : 100 - 10 * v;

function hover(cursor: { left: number; top: number }) {
  const onPointHighlight = jest.fn();
  const plugin = highlightDataPlugin({ proximity: 20, onPointHighlight });
  const u = {
    cursor,
    over: { offsetLeft: 5, offsetTop: 7 },
    valToPos,
    data: [
      [],
      gridToPlotData({
        times: [100],
        stepMs: 10,
        yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 3] },
        cells: [2, 6],
        cellKind: 'count',
      }),
    ],
  };
  const setCursor = plugin.hooks.setCursor;
  if (typeof setCursor !== 'function') throw new Error('no setCursor hook');
  setCursor(u as unknown as uPlot);
  return onPointHighlight;
}

describe('highlightDataPlugin', () => {
  it('reports the nearest non-empty cell with its own size', () => {
    // Row 1 spans y 1..3, centered at y=2 -> pixel 80
    const onPointHighlight = hover({ left: 100, top: 80 });

    expect(onPointHighlight).toHaveBeenCalledWith(
      expect.objectContaining({
        xVal: 100,
        yVal: 2,
        countVal: 6,
        closestIndex: 1,
        xCoord: 105,
        yCoord: 87,
        xSize: 10,
        ySize: 20,
      }),
    );
  });

  it('ignores the cursor when no cell is within the proximity', () => {
    expect(hover({ left: 500, top: 80 })).not.toHaveBeenCalled();
  });
});
