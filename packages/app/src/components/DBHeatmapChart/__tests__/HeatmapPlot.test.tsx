import { act, fireEvent, screen } from '@testing-library/react';

import {
  gridToPlotData,
  HeatmapGrid,
} from '@/components/DBHeatmapChart/heatmapGrid';
import { HeatmapPlot } from '@/components/DBHeatmapChart/HeatmapPlot';
import type { HighlightedPoint } from '@/components/DBHeatmapChart/highlightDataPlugin';

type PlotOptions = {
  cursor?: { drag?: { x?: boolean; y?: boolean } };
  axes?: { splits?: unknown }[];
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
  cellKind: 'count',
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
