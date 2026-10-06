import { act, renderHook } from '@testing-library/react';

import { useSeriesAxisHover } from '@/components/DBHeatmapChart/SeriesAxisTooltip';

const LONG = 'a-very-long-service-name-that-is-truncated';

// Plot area at x 100..300, y 0..200; two rows of 100px each, row 0 at the
// bottom.
const fakeUplot = {
  over: {
    getBoundingClientRect: () => ({
      left: 100,
      right: 300,
      top: 0,
      bottom: 200,
    }),
  },
  posToVal: (px: number) => (200 - px) / 100,
  valToPos: (val: number) => 200 - val * 100,
};

const moveTo = (clientX: number, clientY: number) => ({
  clientX,
  clientY,
  currentTarget: {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  },
});

const renderHover = (labels: string[] | undefined) =>
  renderHook(() => useSeriesAxisHover({ current: fakeUplot }, labels));

describe('useSeriesAxisHover', () => {
  it('shows the full name of a truncated label under the cursor', () => {
    const { result } = renderHover(['api', LONG]);

    act(() => result.current.onMouseMove(moveTo(50, 50)));

    expect(result.current.hover).toEqual({ label: LONG, left: 50, top: 50 });
  });

  it('shows a label that fits too', () => {
    const { result } = renderHover(['api', LONG]);

    act(() => result.current.onMouseMove(moveTo(50, 150)));

    expect(result.current.hover).toEqual({ label: 'api', left: 50, top: 150 });
  });

  it('names an empty label "(blank)"', () => {
    const { result } = renderHover(['', LONG]);

    act(() => result.current.onMouseMove(moveTo(50, 150)));

    expect(result.current.hover).toEqual({
      label: '(blank)',
      left: 50,
      top: 150,
    });
  });

  it('clears once the cursor leaves the axis', () => {
    const { result } = renderHover(['api', LONG]);

    act(() => result.current.onMouseMove(moveTo(50, 50)));
    act(() => result.current.onMouseMove(moveTo(150, 50)));

    expect(result.current.hover).toBeNull();
  });

  it('shows nothing on a numeric axis', () => {
    const { result } = renderHover(undefined);

    act(() => result.current.onMouseMove(moveTo(50, 50)));

    expect(result.current.hover).toBeNull();
  });
});
