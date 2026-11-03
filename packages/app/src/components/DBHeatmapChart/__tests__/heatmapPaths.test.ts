import type uPlot from 'uplot';

import {
  gridToPlotData,
  HeatmapGrid,
} from '@/components/DBHeatmapChart/heatmapGrid';
import { heatmapPaths } from '@/components/DBHeatmapChart/heatmapPaths';

const mockRect = jest.fn();
const scaleX = { min: 0, max: 10_000 };
const scaleY = { min: -100, max: 100 };

// Hand the painter identity x positions and an inverted y axis
// (pixel = 100 - 10 * value), the way uPlot orients a canvas.
jest.mock('uplot', () => ({
  __esModule: true,
  default: {
    orient: (
      _u: unknown,
      _seriesIdx: number,
      draw: (...args: unknown[]) => void,
    ) =>
      draw(
        null,
        null,
        null,
        scaleX,
        scaleY,
        (v: number) => v,
        (v: number) => 100 - 10 * v,
        0,
        0,
        0,
        0,
        null,
        null,
        mockRect,
        null,
      ),
  },
}));

class StubPath2D {}

function paint(grid: HeatmapGrid, fills: number[]) {
  const u = {
    data: [[], gridToPlotData(grid)],
    bbox: { left: 0, top: 0, width: 100, height: 100 },
    ctx: {
      save: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      fill: jest.fn(),
      restore: jest.fn(),
    },
  };
  const paths = heatmapPaths({
    disp: { fill: { lookup: ['#000', '#fff'], values: () => fills } },
  });
  paths(u as unknown as uPlot, 1, 0, 0);
  return u;
}

describe('heatmapPaths', () => {
  beforeAll(() => {
    (globalThis as { Path2D?: unknown }).Path2D = StubPath2D;
  });

  beforeEach(() => {
    mockRect.mockReset();
  });

  it('draws each cell from its own extent, so uneven rows keep their heights', () => {
    paint(
      {
        times: [1000],
        stepMs: 1000,
        yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 3] },
        cells: [1, 5],
      },
      [0, 1],
    );

    expect(mockRect.mock.calls.map(([, ...rect]) => rect)).toEqual([
      [500, 100, 1000, -10], // row 0: y 0..1
      [500, 90, 1000, -20], // row 1: y 1..3, twice as tall
    ]);
  });

  it('skips empty cells and cells outside the visible scale', () => {
    paint(
      {
        times: [1000, 20_000],
        stepMs: 1000,
        yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 2] },
        cells: [0, 3, 4, 4],
      },
      [-1, 0, 1, 1],
    );

    // Only (t=1000, row 1): row 0 is empty and t=20000 is past scaleX.max
    expect(mockRect).toHaveBeenCalledTimes(1);
    expect(mockRect.mock.calls[0].slice(1)).toEqual([500, 90, 1000, -10]);
  });

  it('fills each cell into the path for its palette color', () => {
    const u = paint(
      {
        times: [1000],
        stepMs: 1000,
        yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 2] },
        cells: [1, 1],
      },
      [1, 1],
    );

    const [firstPath] = mockRect.mock.calls[0];
    expect(mockRect.mock.calls[1][0]).toBe(firstPath);
    expect(u.ctx.fill).toHaveBeenCalledTimes(2); // one per palette color
  });
});
