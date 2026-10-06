import type uPlot from 'uplot';

import {
  gridToPlotData,
  HeatmapCellKind,
} from '@/components/DBHeatmapChart/heatmapGrid';
import { highlightDataPlugin } from '@/components/DBHeatmapChart/highlightDataPlugin';

// Identity x positions; y pixels grow downward (pixel = 100 - 10 * value).
const valToPos = (v: number, axis: 'x' | 'y') =>
  axis === 'x' ? v : 100 - 10 * v;
const posToVal = (p: number, axis: 'x' | 'y') =>
  axis === 'x' ? p : (100 - p) / 10;

function hover(
  cursor: { left: number; top: number },
  cells = [2, 6],
  cellKind: HeatmapCellKind = 'count',
) {
  const onPointHighlight = jest.fn();
  const plugin = highlightDataPlugin({
    margin: 20,
    cellKind,
    onPointHighlight,
  });
  const u = {
    cursor,
    over: { offsetLeft: 5, offsetTop: 7 },
    valToPos,
    posToVal,
    data: [
      [],
      gridToPlotData({
        times: [100],
        stepMs: 10,
        yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 3] },
        cells,
      }),
    ],
  };
  const setCursor = plugin.hooks.setCursor;
  if (typeof setCursor !== 'function') throw new Error('no setCursor hook');
  setCursor(u as unknown as uPlot);
  return onPointHighlight;
}

const reported = (onPointHighlight: jest.Mock) =>
  onPointHighlight.mock.calls.at(-1)?.[0];

describe('highlightDataPlugin', () => {
  it('reports the cell under the cursor with its own size', () => {
    expect(reported(hover({ left: 100, top: 80 }))).toEqual({
      xVal: 100,
      yVal: 2,
      countVal: 6,
      closestDistance: 0,
      closestIndex: 1,
      xCoord: 105,
      yCoord: 87,
      xSize: 10,
      ySize: 20,
    });
  });

  it('prefers the cell under the cursor over a nearby one', () => {
    // Just inside row 0, a pixel from row 1's edge
    expect(reported(hover({ left: 100, top: 91 }))).toMatchObject({
      closestIndex: 0,
      closestDistance: 0,
    });
  });

  it('reports a cell within the margin of its edge', () => {
    expect(reported(hover({ left: 110, top: 80 }))).toMatchObject({
      closestIndex: 1,
      closestDistance: 5,
    });
  });

  it('reaches past an empty cell to a neighbor within the margin', () => {
    // Inside the empty row 0, 5px below row 1
    expect(reported(hover({ left: 100, top: 95 }, [0, 6]))).toMatchObject({
      closestIndex: 1,
      closestDistance: 5,
    });
  });

  it('reports zero and negative value cells', () => {
    expect(
      reported(hover({ left: 100, top: 95 }, [0, -6], 'value')),
    ).toMatchObject({ closestIndex: 0, closestDistance: 0, countVal: 0 });
    expect(
      reported(hover({ left: 100, top: 80 }, [0, -6], 'value')),
    ).toMatchObject({ closestIndex: 1, countVal: -6 });
  });

  it('reaches past a value cell with no data', () => {
    expect(
      reported(hover({ left: 100, top: 95 }, [NaN, 6], 'value')),
    ).toMatchObject({ closestIndex: 1, closestDistance: 5 });
  });

  it('reports nothing when no cell is within the margin', () => {
    const onPointHighlight = hover({ left: 130, top: 80 });
    expect(onPointHighlight).toHaveBeenCalledWith(undefined);
  });
});
