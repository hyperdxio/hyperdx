import { ComponentProps, ReactElement } from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { waitFor } from '@testing-library/react';

import {
  getAnnotationElements,
  layoutAnnotations,
} from '@/components/charts/chartAnnotations';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';

let mockContainerWidth = 500;
jest.mock('recharts', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('recharts'),
    // jsdom has no layout engine; only supply the container's measured size.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width: number; height: number }>;
    }) =>
      React.createElement(children.type, {
        ...children.props,
        width: mockContainerWidth,
        height: 300,
      }),
  };
});
jest.mock('@/components/charts/chartAnnotations', () => ({
  ...jest.requireActual('@/components/charts/chartAnnotations'),
  layoutAnnotations: jest.fn(
    jest.requireActual('@/components/charts/chartAnnotations')
      .layoutAnnotations,
  ),
  getAnnotationElements: jest.fn(
    jest.requireActual('@/components/charts/chartAnnotations')
      .getAnnotationElements,
  ),
}));
jest.mock('@/useFormatTime', () => ({ useFormatTime: () => String }));

const props = {
  graphResults: [{ ts_bucket: 100, value: 1 }],
  lineData: [
    {
      dataKey: 'value',
      currentPeriodKey: 'value',
      previousPeriodKey: 'previous',
      displayName: 'Traffic',
      valueColumnName: 'value',
      color: 'var(--color-chart-blue)',
    },
  ],
  dateRange: [new Date(0), new Date(200000)],
  granularity: '1 minute',
  displayType: DisplayType.StackedBar,
  isClickActive: undefined,
  setIsClickActive: jest.fn(),
  tooltipNumberFormatsByKey: new Map(),
  showLegend: false,
  annotations: [{ time: 100000, label: 'Alert' }],
} satisfies ComponentProps<typeof MemoChart>;

describe('time chart plot geometry', () => {
  beforeEach(() => {
    mockContainerWidth = 500;
    jest.clearAllMocks();
  });

  it('uses the real Recharts plot area for single bars and annotations after resize', async () => {
    const { container, rerender } = renderWithMantine(<MemoChart {...props} />);
    const assertGeometry = async () => {
      await waitFor(() => {
        const plot = container.querySelector('clipPath rect');
        expect(plot).not.toBeNull();
        const width = Number(plot?.getAttribute('width'));
        expect(width).toBeGreaterThan(0);
        expect(width).toBeLessThan(mockContainerWidth);
        const bar = container.querySelector('.recharts-bar-rectangle rect');
        expect(bar).not.toBeNull();
        expect(Number(bar?.getAttribute('width'))).toBe(
          Math.floor(width * 0.8),
        );
        expect(layoutAnnotations).toHaveBeenLastCalledWith(
          expect.any(Array),
          expect.objectContaining({ plotWidth: width }),
        );
        expect(getAnnotationElements).toHaveBeenLastCalledWith(
          expect.any(Array),
          expect.objectContaining({ plotWidth: width }),
        );
      });
    };
    await assertGeometry();
    mockContainerWidth = 350;
    rerender(<MemoChart {...props} graphResults={[...props.graphResults]} />);
    await assertGeometry();
  });
});
