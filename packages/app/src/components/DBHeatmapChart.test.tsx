import type uPlot from 'uplot';

import { applySelectionToChart, SelectionBounds } from './DBHeatmapChart';

type StubU = {
  scales: {
    x?: { min?: number; max?: number };
    y?: { min?: number; max?: number };
  };
  valToPos: jest.Mock<number, [number, 'x' | 'y']>;
  setSelect: jest.Mock<
    void,
    [{ left: number; top: number; width: number; height: number }, boolean]
  >;
};

function makeStubU(opts?: {
  yScale?: { min?: number; max?: number };
  xScale?: { min?: number; max?: number };
  valToPos?: (val: number, axis: 'x' | 'y') => number;
}): StubU {
  const yScale = opts?.yScale === undefined ? { min: 0, max: 10 } : opts.yScale;
  const xScale =
    opts?.xScale === undefined ? { min: 0, max: 1_000_000 } : opts.xScale;
  // Default: identity passthrough so callers can verify exact arguments.
  const valToPos = jest.fn(
    opts?.valToPos ?? ((val: number, _axis: 'x' | 'y') => val),
  );
  const setSelect = jest.fn();
  return {
    scales: { x: xScale, y: yScale },
    valToPos,
    setSelect,
  };
}

describe('applySelectionToChart', () => {
  it('clears the selection when bounds is null', () => {
    const u = makeStubU();
    applySelectionToChart(u as unknown as uPlot, null, 'linear');
    expect(u.setSelect).toHaveBeenCalledTimes(1);
    expect(u.setSelect).toHaveBeenCalledWith(
      { left: 0, top: 0, width: 0, height: 0 },
      false,
    );
    expect(u.valToPos).not.toHaveBeenCalled();
  });

  it('clears the selection when bounds is undefined', () => {
    const u = makeStubU();
    applySelectionToChart(u as unknown as uPlot, undefined, 'linear');
    expect(u.setSelect).toHaveBeenCalledWith(
      { left: 0, top: 0, width: 0, height: 0 },
      false,
    );
  });

  it('returns early without calling setSelect when y scale is unpopulated', () => {
    const u = makeStubU({ yScale: { min: undefined, max: undefined } });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 1, yMax: 5 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    expect(u.setSelect).not.toHaveBeenCalled();
  });

  it('converts xMin/xMax from seconds to ms before calling valToPos', () => {
    const u = makeStubU();
    const bounds: SelectionBounds = { xMin: 5, xMax: 10, yMin: 1, yMax: 9 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    expect(u.valToPos).toHaveBeenCalledWith(5_000, 'x');
    expect(u.valToPos).toHaveBeenCalledWith(10_000, 'x');
  });

  it('passes raw y values through under linear scale', () => {
    const u = makeStubU({ yScale: { min: 0, max: 100 } });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 5, yMax: 50 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    // y values must NOT be log-transformed under linear scale.
    expect(u.valToPos).toHaveBeenCalledWith(50, 'y');
    expect(u.valToPos).toHaveBeenCalledWith(5, 'y');
  });

  it('applies Math.log to y values under log scale', () => {
    const u = makeStubU({ yScale: { min: 0, max: 100 } });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 1, yMax: Math.E };
    applySelectionToChart(u as unknown as uPlot, bounds, 'log');
    // Math.log(1) === 0, Math.log(Math.E) === 1
    expect(u.valToPos).toHaveBeenCalledWith(0, 'y');
    expect(u.valToPos).toHaveBeenCalledWith(1, 'y');
  });

  it('clamps yMin === 0 to the chart-floor (yScaleMin) under linear scale', () => {
    const u = makeStubU({ yScale: { min: 2, max: 100 } });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 50 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    // yMin=0 should clamp UP to yScale.min (2), not pass through.
    expect(u.valToPos).toHaveBeenCalledWith(2, 'y');
    expect(u.valToPos).not.toHaveBeenCalledWith(0, 'y');
  });

  it('clamps yMin === 0 to the chart-floor (yScaleMin) under log scale', () => {
    const u = makeStubU({ yScale: { min: -1, max: 5 } });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: Math.E };
    applySelectionToChart(u as unknown as uPlot, bounds, 'log');
    // yMin=0 (or any non-positive) bypasses Math.log and clamps to yScale.min.
    expect(u.valToPos).toHaveBeenCalledWith(-1, 'y');
  });

  it('clamps yMax above the chart ceiling to yScaleMax under linear', () => {
    const u = makeStubU({ yScale: { min: 0, max: 10 } });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 1, yMax: 999 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    expect(u.valToPos).toHaveBeenCalledWith(10, 'y');
  });

  it('handles reversed xMin > xMax via Math.min/max for left/right', () => {
    const u = makeStubU();
    const bounds: SelectionBounds = { xMin: 10, xMax: 5, yMin: 1, yMax: 9 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    // valToPos identity: xMin*1000=10000, xMax*1000=5000
    // left should be Math.min(10000, 5000) = 5000, width = 10000-5000 = 5000
    const call = u.setSelect.mock.calls[0][0];
    expect(call.left).toBe(5_000);
    expect(call.width).toBe(5_000);
  });

  it('produces non-negative height when yLowPx < yHighPx', () => {
    // valToPos returns inverse: smaller y-data = larger pixel-y (uPlot semantics).
    const u = makeStubU({
      yScale: { min: 0, max: 10 },
      // Force yLowPx < yHighPx by inverting the mapping
      valToPos: (val, axis) => (axis === 'y' ? 100 - val : val),
    });
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 2, yMax: 8 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    const call = u.setSelect.mock.calls[0][0];
    // yHighPx = 100-8 = 92, yLowPx = 100-2 = 98, height = max(0, 98-92) = 6
    expect(call.top).toBe(92);
    expect(call.height).toBe(6);
  });

  it('passes fireHook=false to setSelect to avoid re-entering the setSelect hook', () => {
    const u = makeStubU();
    const bounds: SelectionBounds = { xMin: 0, xMax: 1, yMin: 1, yMax: 9 };
    applySelectionToChart(u as unknown as uPlot, bounds, 'linear');
    const fireHook = u.setSelect.mock.calls[0][1];
    expect(fireHook).toBe(false);
  });
});
