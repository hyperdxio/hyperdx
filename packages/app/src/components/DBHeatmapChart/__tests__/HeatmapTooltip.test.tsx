import { screen } from '@testing-library/react';

import { HeatmapTooltip } from '@/components/DBHeatmapChart/HeatmapTooltip';

jest.mock('@/useFormatTime', () => ({
  FormatTime: ({ value }: { value: number }) => <span>time:{value}</span>,
}));

const point = {
  xVal: 1000,
  yVal: 2,
  countVal: 1234,
  closestDistance: 0,
  closestIndex: 0,
  xCoord: 10,
  yCoord: 10,
  xSize: 5,
  ySize: 5,
};

const renderTooltip = (
  props: Partial<React.ComponentProps<typeof HeatmapTooltip>> = {},
) =>
  renderWithMantine(
    <HeatmapTooltip
      point={point}
      width={400}
      height={300}
      showDragHint={false}
      formatY={v => `y=${v}`}
      percentile={undefined}
      {...props}
    />,
  );

describe('HeatmapTooltip', () => {
  it('shows the time, formatted y value and count', () => {
    renderTooltip();

    expect(screen.getByText('time:1000')).toBeInTheDocument();
    expect(screen.getByText('y=2')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('appends the percentile when known', () => {
    renderTooltip({ percentile: 95.25 });

    expect(screen.getByText(/y=2 \(p95\.3\)/)).toBeInTheDocument();
  });

  it('centers the cell highlight on the hovered cell', () => {
    const { container } = renderTooltip({
      point: { ...point, xCoord: 100, yCoord: 50, xSize: 20, ySize: 40 },
    });

    const highlight = container.querySelector<HTMLElement>(
      'div[style*="pointer-events: none"]',
    );
    expect(highlight?.style).toMatchObject({
      top: '30px',
      left: '90px',
      width: '20px',
      height: '40px',
    });
  });

  it('shows the drag hint only when filtering is enabled', () => {
    const { unmount } = renderTooltip();
    expect(screen.queryByText(/Drag to Compare/)).not.toBeInTheDocument();
    unmount();

    renderTooltip({ showDragHint: true });
    expect(screen.getByText(/Drag to Compare/)).toBeInTheDocument();
  });
});
