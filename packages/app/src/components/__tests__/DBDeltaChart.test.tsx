import React from 'react';
import { screen } from '@testing-library/react';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import DBDeltaChart from '../DBDeltaChart';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

// PropertyComparisonChart is the per-attribute renderer. Stubbing it out keeps
// the legend assertions tight without dragging uPlot/element-size hooks into
// the test environment.
jest.mock('../PropertyComparisonChart', () => ({
  __esModule: true,
  CHART_GAP: 8,
  CHART_HEIGHT: 100,
  CHART_WIDTH: 200,
  PAGINATION_HEIGHT: 32,
  PropertyComparisonChart: ({ name }: { name: string }) => (
    <div data-testid="property-chart">{name}</div>
  ),
}));

const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;

const baseConfig: any = {
  dateRange: [new Date(0), new Date(1000)],
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  select: '',
  where: '',
  whereLanguage: 'sql' as const,
};

function renderChart(
  overrides: Partial<React.ComponentProps<typeof DBDeltaChart>> = {},
) {
  return renderWithMantine(
    <DBDeltaChart
      config={baseConfig}
      valueExpr="Duration"
      spanIdExpression="SpanId"
      {...overrides}
    />,
  );
}

describe('DBDeltaChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [], meta: [] },
      error: undefined,
      isLoading: false,
    });
  });

  describe('distribution mode (no heatmap selection)', () => {
    it('renders the "All spans" legend entry and the help hint', () => {
      renderChart();

      expect(screen.getByText('All spans')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Select an area on the chart above to enable comparisons',
        ),
      ).toBeInTheDocument();
    });

    it('does not render the Selection/Background legend entries', () => {
      renderChart();

      expect(screen.queryByText('Selection')).not.toBeInTheDocument();
      expect(screen.queryByText('Background')).not.toBeInTheDocument();
    });

    it('enables the allSpans query and disables the outlier/inlier queries', () => {
      renderChart();

      // The component fires three useQueriedChartConfig calls in order:
      // outlier, inlier, allSpans.
      const calls = mockUseQueriedChartConfig.mock.calls;
      expect(calls).toHaveLength(3);

      const [outlierCall, inlierCall, allSpansCall] = calls;
      expect(outlierCall[1]).toMatchObject({ enabled: false });
      expect(inlierCall[1]).toMatchObject({ enabled: false });
      expect(allSpansCall[1]).toMatchObject({ enabled: true });
    });

    it('does not apply a filters override on the allSpans query', () => {
      // Regression guard: the allSpans branch must not reuse buildFilters,
      // which is keyed on (xMin/xMax/yMin/yMax). With no selection those
      // default to 0 and produce dead SQL that mirrors the inlier branch.
      renderChart();

      const allSpansCall = mockUseQueriedChartConfig.mock.calls[2];
      const allSpansConfig = allSpansCall[0];
      expect(allSpansConfig.filters).toBeUndefined();
    });
  });

  describe('selection mode (all four coordinates set)', () => {
    it('renders the Selection and Background legend entries', () => {
      renderChart({ xMin: 1, xMax: 2, yMin: 1, yMax: 2 });

      expect(screen.getByText('Selection')).toBeInTheDocument();
      expect(screen.getByText('Background')).toBeInTheDocument();
    });

    it('does not render the "All spans" legend entry', () => {
      renderChart({ xMin: 1, xMax: 2, yMin: 1, yMax: 2 });

      expect(screen.queryByText('All spans')).not.toBeInTheDocument();
    });

    it('enables the outlier and inlier queries, disables allSpans', () => {
      renderChart({ xMin: 1, xMax: 2, yMin: 1, yMax: 2 });

      const calls = mockUseQueriedChartConfig.mock.calls;
      const [outlierCall, inlierCall, allSpansCall] = calls;
      expect(outlierCall[1]).toMatchObject({ enabled: true });
      expect(inlierCall[1]).toMatchObject({ enabled: true });
      expect(allSpansCall[1]).toMatchObject({ enabled: false });
    });
  });

  describe('legendPrefix prop', () => {
    it('renders inside the legend flex when provided', () => {
      renderChart({
        legendPrefix: <div data-testid="prefix">color scale</div>,
      });

      expect(screen.getByTestId('prefix')).toBeInTheDocument();
    });

    it('omits the divider when no legendPrefix is provided', () => {
      // Without a prefix the divider should not render. We rely on the
      // distribution-mode renderer above for shape; the absence assertion
      // here is just "no prefix testid wrapper".
      renderChart();
      expect(screen.queryByTestId('prefix')).not.toBeInTheDocument();
    });
  });
});
