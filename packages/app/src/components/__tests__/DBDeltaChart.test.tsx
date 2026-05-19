import React from 'react';
import {
  BuilderChartConfigWithDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';
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

// Sentinel filter on baseConfig so the allSpans assertion can prove
// the branch passes user-supplied filters through unchanged. Without
// it, `expect(filters).toBeUndefined()` passes for both "no override"
// and "filters dropped on the floor", which are indistinguishable.
const sentinelFilter: Filter = {
  type: 'sql',
  condition: 'tenant_id = 42',
};

const baseConfig: BuilderChartConfigWithDateRange = {
  dateRange: [new Date(0), new Date(1000)],
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  select: '',
  where: '',
  whereLanguage: 'sql',
  filters: [sentinelFilter],
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

    it('passes config.filters through to allSpans without selection filters', () => {
      // Regression guard for two related failure modes:
      //   1. allSpans reuses buildFilters() (keyed on xMin/xMax/yMin/yMax).
      //      With no selection those default to 0 and produce dead SQL
      //      mirroring the inlier branch. Length would grow past 1.
      //   2. allSpans explicitly sets `filters: undefined` and drops the
      //      user-supplied filters on the floor. Length would drop to 0.
      // Both are caught by asserting allSpans receives exactly the
      // sentinel filter array from config, no more and no fewer.
      renderChart();

      const calls = mockUseQueriedChartConfig.mock.calls;
      expect(calls).toHaveLength(3);
      const allSpansConfig = calls[2][0];
      expect(allSpansConfig.filters).toEqual([sentinelFilter]);

      // Sanity: the outlier branch DOES inject extra filters built from
      // the (defaulted-to-zero) coords, so its filters array is strictly
      // longer than baseConfig.filters.
      const outlierConfig = calls[0][0];
      expect(outlierConfig.filters.length).toBeGreaterThan(1);
      expect(outlierConfig.filters[0]).toEqual(sentinelFilter);
    });
  });

  describe('partial-null selection coordinates', () => {
    // The four-null conditional that originally gated <DBDeltaChart>
    // used `&&` across xMin/xMax/yMin/yMax. A regression weakening the
    // conjunction to `||` would let selection mode activate with any
    // single coord set, which is wrong. These cases lock the conjunction
    // in: any null coord must keep distribution mode active.
    it.each([
      ['only xMin set', { xMin: 1 }],
      ['only xMax set', { xMax: 2 }],
      ['only yMin set', { yMin: 1 }],
      ['only yMax set', { yMax: 2 }],
      ['three set, yMax null', { xMin: 1, xMax: 2, yMin: 1 }],
      ['three set, xMin null', { xMax: 2, yMin: 1, yMax: 2 }],
    ])('stays in distribution mode when %s', (_label, coords) => {
      renderChart(coords);

      expect(screen.getByText('All spans')).toBeInTheDocument();
      expect(screen.queryByText('Selection')).not.toBeInTheDocument();

      const calls = mockUseQueriedChartConfig.mock.calls;
      expect(calls[2][1]).toMatchObject({ enabled: true });
      expect(calls[0][1]).toMatchObject({ enabled: false });
      expect(calls[1][1]).toMatchObject({ enabled: false });
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
    // The divider is a vertical separator rendered immediately after the
    // legendPrefix to visually divide it from the comparison legend. It's
    // a `<Box h={12}>` with a `borderLeft` style. We assert its presence
    // via the unique border style so the test is decoupled from Mantine's
    // class hashing.
    const dividerStyle = '1px solid var(--mantine-color-default-border)';

    function queryDivider(container: HTMLElement) {
      return Array.from(container.querySelectorAll<HTMLElement>('div')).find(
        el => el.style.borderLeft === dividerStyle,
      );
    }

    it('renders inside the legend flex when provided', () => {
      const { container } = renderChart({
        legendPrefix: <div data-testid="prefix">color scale</div>,
      });

      expect(screen.getByTestId('prefix')).toBeInTheDocument();
      expect(queryDivider(container)).toBeDefined();
    });

    it('omits the prefix and divider when no legendPrefix is provided', () => {
      const { container } = renderChart();
      expect(screen.queryByTestId('prefix')).not.toBeInTheDocument();
      expect(queryDivider(container)).toBeUndefined();
    });
  });
});
