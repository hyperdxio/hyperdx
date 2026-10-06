import { act, fireEvent, screen } from '@testing-library/react';

import {
  gridToPlotData,
  HeatmapGrid,
} from '@/components/DBHeatmapChart/heatmapGrid';
import { HeatmapPlot } from '@/components/DBHeatmapChart/HeatmapPlot';
import type { HighlightedPoint } from '@/components/DBHeatmapChart/highlightDataPlugin';

type PlotOptions = {
  cursor?: { drag?: { x?: boolean; y?: boolean } };
  axes?: {
    splits?: (...args: unknown[]) => number[];
    values?: (u: unknown, vals: number[]) => string[];
  }[];
  scales?: { y?: { range?: unknown } };
};

const mockPlot = jest.fn();
jest.mock('uplot-react', () => ({
  __esModule: true,
  default: ({
    data,
    options,
  }: {
    data: [unknown, unknown];
    options: PlotOptions;
  }) => {
    mockPlot(data[1], options);
    return <div data-testid="heatmap-plot" />;
  },
}));

let onPointHighlight: (point: HighlightedPoint | undefined) => void;
jest.mock('@/components/DBHeatmapChart/highlightDataPlugin', () => ({
  highlightDataPlugin: (opts: {
    onPointHighlight: typeof onPointHighlight;
  }) => {
    onPointHighlight = opts.onPointHighlight;
    return {};
  },
}));

const grid: HeatmapGrid = {
  times: [1000, 2000],
  stepMs: 1000,
  yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 2] },
  cells: [1, 2, 3, 4],
};

const lastData = () => mockPlot.mock.calls.at(-1)?.[0];
const lastOptions = (): PlotOptions => mockPlot.mock.calls.at(-1)?.[1];

const renderPlot = (
  props: Partial<React.ComponentProps<typeof HeatmapPlot>> = {},
) =>
  renderWithMantine(<HeatmapPlot grid={grid} palette={['#000']} {...props} />);

describe('HeatmapPlot', () => {
  beforeEach(() => {
    mockPlot.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('plots the grid as uPlot mode-2 data with cell extents', () => {
    renderPlot();

    expect(lastData()).toEqual(gridToPlotData(grid));
  });

  it('enables drag-select only when the caller can filter', () => {
    const { unmount } = renderPlot();
    expect(lastOptions().cursor?.drag).toMatchObject({ x: false, y: false });
    unmount();

    renderPlot({ onFilter: jest.fn() });
    expect(lastOptions().cursor?.drag).toMatchObject({ x: true, y: true });
  });

  it('labels a series axis with one tick centered on each row', () => {
    renderPlot({
      grid: {
        ...grid,
        yAxis: {
          type: 'series',
          labels: ['api', 'a-very-long-service-name-that-is-truncated'],
        },
      },
      scaleType: 'log',
    });

    const yAxis = lastOptions().axes?.[1];
    const splits = yAxis?.splits?.();
    expect(splits).toEqual([0.5, 1.5]);
    expect(yAxis?.values?.(undefined, splits ?? [])).toEqual([
      'api',
      'a-very-long..s-truncated',
    ]);
    expect(lastOptions().scales?.y?.range).toEqual([0, 2]);
  });

  it('places log-scale ticks at powers of 10', () => {
    const { unmount } = renderPlot({ scaleType: 'linear' });
    expect(lastOptions().axes?.[1]?.splits).toBeUndefined();
    unmount();

    renderPlot({ scaleType: 'log' });
    expect(lastOptions().axes?.[1]?.splits).toEqual(expect.any(Function));
  });

  it('clears the selection on click only when the caller can filter', () => {
    // Clicks within 300ms of the last drag are ignored
    jest.spyOn(performance, 'now').mockReturnValue(10_000);
    const onClearFilter = jest.fn();

    const { unmount } = renderPlot({ onClearFilter });
    fireEvent.click(screen.getByTestId('heatmap-plot'));
    expect(onClearFilter).not.toHaveBeenCalled();
    unmount();

    renderPlot({ onFilter: jest.fn(), onClearFilter });
    fireEvent.click(screen.getByTestId('heatmap-plot'));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  const point: HighlightedPoint = {
    xVal: 1000,
    yVal: 0.5,
    countVal: 1,
    closestDistance: 0,
    closestIndex: 0,
    xCoord: 10,
    yCoord: 20,
    xSize: 10,
    ySize: 10,
  };

  it('shows the tooltip only once the mouse moves over the plot', () => {
    renderPlot();

    // uPlot reports a point on init, before any hover
    act(() => onPointHighlight(point));
    expect(screen.queryByText('Count Value:')).not.toBeInTheDocument();

    // No mouseenter: the plot can mount under a cursor that never re-enters
    fireEvent.mouseMove(screen.getByTestId('heatmap-plot'));
    act(() => onPointHighlight(point));
    expect(screen.getByText('Count Value:')).toBeInTheDocument();
  });

  it('updates the tooltip when the same cell index reports new values', () => {
    renderPlot();
    fireEvent.mouseMove(screen.getByTestId('heatmap-plot'));

    act(() => onPointHighlight(point));
    expect(screen.getByText('Count Value:').parentElement).toHaveTextContent(
      'Count Value: 1',
    );

    act(() => onPointHighlight({ ...point, countVal: 7, xCoord: 30 }));
    expect(screen.getByText('Count Value:').parentElement).toHaveTextContent(
      'Count Value: 7',
    );
  });
});
