import React from 'react';

import { Sparkline, type SparklinePoint } from '@/components/Sparkline';

// recharts `ResponsiveContainer` sizes itself from its parent via a
// ResizeObserver, which is a no-op in jsdom (see setupTests), so it never
// reports a size and the chart never paints. Swap it for a fixed-size
// pass-through so the SVG renders and the variant can be asserted, and record
// the requested height so its forwarding can be asserted. The `mock` prefix
// lets the hoisted jest.mock factory reference it.
const mockResponsiveContainerHeights: Array<number | string | undefined> = [];

jest.mock('recharts', () => {
  const actual = jest.requireActual<typeof import('recharts')>('recharts');
  const { cloneElement } = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
      height?: number | string;
    }) => {
      mockResponsiveContainerHeights.push(height);
      return cloneElement(children, { width: 300, height: 80 });
    },
  };
});

const COLOR = '#abcdef';

const POINTS: SparklinePoint[] = [
  { x: 1, y: 3 },
  { x: 2, y: 7 },
  { x: 3, y: 5 },
];

describe('Sparkline', () => {
  beforeEach(() => {
    mockResponsiveContainerHeights.length = 0;
  });

  it('renders a line trend in the given color', () => {
    const { container } = renderWithMantine(
      <Sparkline points={POINTS} type="line" color={COLOR} />,
    );
    expect(container.querySelector('.recharts-line')).toBeInTheDocument();
    expect(container.innerHTML).toContain(COLOR);
  });

  it('renders an area trend in the given color', () => {
    const { container } = renderWithMantine(
      <Sparkline points={POINTS} type="area" color={COLOR} />,
    );
    expect(container.querySelector('.recharts-area')).toBeInTheDocument();
    expect(container.innerHTML).toContain(COLOR);
  });

  it('renders a bar trend in the given color', () => {
    const { container } = renderWithMantine(
      <Sparkline points={POINTS} type="bar" color={COLOR} />,
    );
    expect(container.querySelector('.recharts-bar')).toBeInTheDocument();
    expect(container.innerHTML).toContain(COLOR);
  });

  it('renders nothing for fewer than two points', () => {
    const { container } = renderWithMantine(
      <Sparkline points={[{ x: 1, y: 3 }]} type="line" color={COLOR} />,
    );
    const surface = container.querySelector('.recharts-surface');
    expect(surface).not.toBeInTheDocument();
  });

  it('fills its parent height by default', () => {
    renderWithMantine(<Sparkline points={POINTS} type="line" color={COLOR} />);
    expect(mockResponsiveContainerHeights).toContain('100%');
  });

  it('forwards an explicit numeric height (table-cell usage)', () => {
    const { container } = renderWithMantine(
      <Sparkline points={POINTS} type="line" color={COLOR} height={24} />,
    );
    expect(container.querySelector('.recharts-line')).toBeInTheDocument();
    expect(mockResponsiveContainerHeights).toContain(24);
  });
});
