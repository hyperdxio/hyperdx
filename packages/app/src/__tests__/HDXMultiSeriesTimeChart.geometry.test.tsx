import { ComponentProps, ReactNode } from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import {
  getAnnotationElements,
  layoutAnnotations,
} from '@/components/charts/chartAnnotations';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';

let mockPlotWidth = 240;
jest.mock('recharts', () => {
  const React = jest.requireActual('react');
  const Chart = ({
    children,
    barSize,
  }: {
    children: ReactNode;
    barSize?: number;
  }) => (
    <svg data-testid="chart" data-bar-size={barSize}>
      {children}
    </svg>
  );
  return {
    ...jest.requireActual('recharts'),
    AreaChart: Chart,
    BarChart: Chart,
    Area: () => null,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
    Customized: () => null,
    usePlotArea: () => ({ x: 255, y: 5, width: mockPlotWidth, height: 250 }),
    ResponsiveContainer: ({
      children,
      onResize,
    }: {
      children: ReactNode;
      onResize?: (width: number) => void;
    }) => {
      React.useEffect(() => {
        onResize?.(500);
      }, [onResize]);
      return children;
    },
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
  lineData: [],
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
    mockPlotWidth = 240;
    jest.clearAllMocks();
  });

  it('uses the measured plot width for bars and annotation layout', () => {
    renderWithMantine(<MemoChart {...props} />);
    expect(screen.getByTestId('chart')).toHaveAttribute('data-bar-size', '192');
    expect(layoutAnnotations).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ plotWidth: 240 }),
    );
    expect(getAnnotationElements).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ plotWidth: 240 }),
    );
  });

  it('updates geometry when the automatic axis grows without a container resize', () => {
    const { rerender } = renderWithMantine(<MemoChart {...props} />);
    mockPlotWidth = 180;
    rerender(<MemoChart {...props} graphResults={[...props.graphResults]} />);
    expect(screen.getByTestId('chart')).toHaveAttribute('data-bar-size', '144');
    expect(layoutAnnotations).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ plotWidth: 180 }),
    );
    expect(getAnnotationElements).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ plotWidth: 180 }),
    );
  });
});
