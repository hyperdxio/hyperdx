import { SourceKind, TMetricSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import {
  InfraPodsStatusTable,
  NamespacesTable,
  NodesTable,
} from '@/KubernetesDashboardPage';
import { KubePhase } from '@/types';

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  ...jest.requireActual('@/hooks/useChartConfig'),
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

// jsdom has no layout, so render the first rows instead of the visible window.
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 20) }, (_, index) => ({
        index,
        key: index,
        start: index * 40,
        end: (index + 1) * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    options: { scrollMargin: 0 },
  }),
}));

const metricSource: TMetricSource = {
  id: 'metrics-1',
  name: 'Metrics',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  metricTables: {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
    histogram: 'otel_metrics_histogram',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exp_histogram',
  },
  resourceAttributesExpression: 'ResourceAttributes',
  timestampValueExpression: 'TimeUnix',
};

const dateRange: [Date, Date] = [
  new Date('2026-07-06T00:00:00Z'),
  new Date('2026-07-06T01:00:00Z'),
];

function mockQuery(state: {
  data?: { data: Record<string, unknown>[] };
  isLoading?: boolean;
  isPlaceholderData?: boolean;
}) {
  mockUseQueriedChartConfig.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    ...state,
  });
}

const podRow = {
  "arrayElement(ResourceAttributes, 'k8s.pod.name')": 'api-7d9f',
  'last_value(k8s.pod.phase)': KubePhase.Running,
};

describe.each([
  {
    table: 'pods',
    Table: InfraPodsStatusTable,
    row: podRow,
    name: 'api-7d9f',
    empty: 'No pods found',
  },
  {
    table: 'nodes',
    Table: NodesTable,
    row: { "arrayElement(ResourceAttributes, 'k8s.node.name')": 'node-a' },
    name: 'node-a',
    empty: 'No nodes found',
  },
  {
    table: 'namespaces',
    Table: NamespacesTable,
    row: {
      "arrayElement(ResourceAttributes, 'k8s.namespace.name')": 'payments',
    },
    name: 'payments',
    empty: 'No namespaces found',
  },
])('Kubernetes $table table refresh', ({ Table, row, name, empty }) => {
  const renderTable = () =>
    renderWithMantine(
      <Table dateRange={dateRange} metricSource={metricSource} where="" />,
    );

  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('keeps the previous rows only while the same query loads a new time range', () => {
    mockQuery({ data: { data: [row] } });

    renderTable();

    const [config, options] = mockUseQueriedChartConfig.mock.calls[0];
    const previous = { data: [row] };
    const previousQuery = (prevConfig: unknown) => ({
      queryKey: [prevConfig, false, false, 60],
    });
    const earlierRange = [
      new Date('2026-07-05T23:00:00Z'),
      new Date('2026-07-06T00:00:00Z'),
    ];
    expect(
      options.placeholderData(
        previous,
        previousQuery({ ...config, dateRange: earlierRange }),
      ),
    ).toBe(previous);
    // Rows from another source would be read with the wrong attributes.
    expect(
      options.placeholderData(
        previous,
        previousQuery({ ...config, connection: 'conn-2' }),
      ),
    ).toBeUndefined();
    expect(options.placeholderData(previous, undefined)).toBeUndefined();
  });

  it('keeps the previous rows on screen and pulses them while a refresh loads', () => {
    // The new range's query is still loading behind the previous rows.
    mockQuery({
      data: { data: [row] },
      isLoading: true,
      isPlaceholderData: true,
    });

    renderTable();

    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('table').parentElement).toHaveClass('effect-pulse');
  });

  it('pulses the empty state while a refresh loads', () => {
    mockQuery({ data: { data: [] }, isPlaceholderData: true });

    renderTable();

    expect(screen.getByText(empty).parentElement).toHaveClass('effect-pulse');
  });

  it('stops pulsing once fresh rows load', () => {
    mockQuery({ data: { data: [row] } });

    renderTable();

    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('table').parentElement).not.toHaveClass(
      'effect-pulse',
    );
  });

  it('shows the loading skeleton before the first rows arrive', () => {
    mockQuery({ isLoading: true });

    renderTable();

    // The skeleton is a table without any rows or empty-state message.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(name)).not.toBeInTheDocument();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });
});

describe('Kubernetes pods table fetch limit', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('keeps the fetch-limit notice above the previous rows while a refresh loads', () => {
    mockQuery({
      data: { data: Array.from({ length: 10_000 }, () => podRow) },
      isLoading: true,
      isPlaceholderData: true,
    });

    renderWithMantine(
      <InfraPodsStatusTable
        dateRange={dateRange}
        metricSource={metricSource}
        where=""
      />,
    );

    expect(screen.getByText(/Showing first 10.?000 pods/)).toBeInTheDocument();
  });
});
