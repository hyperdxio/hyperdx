import { screen } from '@testing-library/react';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import DBTimelineChart from '../DBTimelineChart';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

const baseConfig = {
  dateRange: [
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T01:00:00Z'),
  ] as [Date, Date],
  from: { databaseName: 'test', tableName: 'test' },
  timestampValueExpression: 'timestamp',
  connection: 'test-connection',
  select: '',
  where: '',
};

describe('DBTimelineChart', () => {
  const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Recharts in JSDOM does not render SVG markup because it relies on
  // ResizeObserver to measure its container, and JSDOM reports 0×0. So we
  // assert on the parts of the tile we can see in JSDOM:
  //   1. The component mounts without throwing.
  //   2. The legend strip and event-table toggle reflect the response.
  //   3. The events table renders the right rows when expanded.
  //
  // The original Bug #1 (chart doesn't render in dashboard view) was a
  // **layout** bug: `ChartContainer`'s default `position:absolute` wrapper
  // gave the chart a 0px height even though Recharts was given correct data.
  // We can't catch that in JSDOM, so the E2E Playwright suite carries the
  // chart-mounts-on-real-DOM check.

  it('mounts without throwing when there are zero events', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [], meta: [] },
      isLoading: false,
      isError: false,
    });

    expect(() =>
      renderWithMantine(<DBTimelineChart config={baseConfig} />),
    ).not.toThrow();
  });

  it('renders one legend pill per lane with event counts', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        meta: [
          { name: 'ts', type: 'DateTime' },
          { name: 'label', type: 'String' },
          { name: 'group', type: 'String' },
        ],
        data: [
          { ts: '2026-01-01T00:15:00Z', label: 'deploy v1', group: 'api' },
          { ts: '2026-01-01T00:30:00Z', label: 'deploy v2', group: 'api' },
          { ts: '2026-01-01T00:45:00Z', label: 'restart', group: 'web' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBTimelineChart config={baseConfig} />);
    expect(screen.getByText(/api \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/web \(1\)/)).toBeInTheDocument();
  });

  it('shows the events-table toggle when events exist', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        meta: [
          { name: 'ts', type: 'DateTime' },
          { name: 'label', type: 'String' },
        ],
        data: [{ ts: '2026-01-01T00:15:00Z', label: 'deploy v1' }],
      },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBTimelineChart config={baseConfig} />);
    expect(screen.getByTitle('Show events table')).toBeInTheDocument();
  });

  it('hides the events-table toggle when there are no events', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [], meta: [] },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBTimelineChart config={baseConfig} />);
    expect(screen.queryByTitle('Show events table')).not.toBeInTheDocument();
  });

  it('renders the error state without throwing when the query fails', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('connection refused'),
    });

    expect(() =>
      renderWithMantine(<DBTimelineChart config={baseConfig} />),
    ).not.toThrow();
  });

  it('renders an event row in the table when expanded', async () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        meta: [
          { name: 'ts', type: 'DateTime' },
          { name: 'label', type: 'String' },
        ],
        data: [{ ts: '2026-01-01T00:15:00Z', label: 'deploy v1' }],
      },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBTimelineChart config={baseConfig} />);
    screen.getByTitle('Show events table').click();
    expect(await screen.findByText('deploy v1')).toBeInTheDocument();
  });

  it('does not crash when buildEventSearchHref is provided', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        meta: [
          { name: 'ts', type: 'DateTime' },
          { name: 'label', type: 'String' },
        ],
        data: [{ ts: '2026-01-01T00:15:00Z', label: 'deploy v1' }],
      },
      isLoading: false,
      isError: false,
    });

    const buildHref = jest.fn().mockReturnValue('/search?from=1&to=2');

    expect(() =>
      renderWithMantine(
        <DBTimelineChart
          config={baseConfig}
          buildEventSearchHref={buildHref}
        />,
      ),
    ).not.toThrow();
  });
});
