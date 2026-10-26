import { useSyncExternalStore } from 'react';
import {
  MetricsDataType,
  MetricSourceSchema,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { classifyMetric } from '@/components/MetricWall/classifyMetric';
import {
  MetricBrowse,
  MetricBrowseRail,
} from '@/components/MetricWall/MetricBrowse';
import {
  WallMetric,
  wallMetricId,
} from '@/components/MetricWall/useMetricWallCatalog';

// The rail and the wall each read the URL state, so the mock shares one value.
const mockUrl: { value: unknown; listeners: Set<() => void> } = {
  value: null,
  listeners: new Set(),
};
jest.mock('nuqs', () => ({
  __esModule: true,
  parseAsJson: () => ({}),
  useQueryState: () => {
    const value = useSyncExternalStore(
      listener => {
        mockUrl.listeners.add(listener);
        return () => mockUrl.listeners.delete(listener);
      },
      () => mockUrl.value,
    );
    const setValue = (next: unknown) => {
      mockUrl.value = typeof next === 'function' ? next(mockUrl.value) : next;
      mockUrl.listeners.forEach(l => l());
    };
    return [value, setValue];
  },
}));

beforeEach(() => {
  mockUrl.value = null;
});

function metric(
  name: string,
  type: MetricsDataType,
  unit: string | undefined,
  entities: string[],
): WallMetric {
  return {
    id: wallMetricId(type, name),
    name,
    type,
    unit,
    classification: classifyMetric({ name, type, unit }),
    keys: new Set(['http.route']),
    entities: entities.map(e => {
      const [key, value] = e.split('=');
      return { key, value };
    }),
  };
}

const mockMetrics = [
  metric('http.server.request.duration', MetricsDataType.Histogram, 'ms', [
    'service.name=api',
  ]),
  metric('http.server.error.count', MetricsDataType.Sum, '1', [
    'service.name=api',
  ]),
  metric('node_load1', MetricsDataType.Gauge, '1', ['host.name=ip-10']),
];

jest.mock('@/components/MetricWall/useMetricWallCatalog', () => ({
  ...jest.requireActual('@/components/MetricWall/useMetricWallCatalog'),
  useMetricWallCatalog: () => ({
    metrics: mockMetrics,
    failedKinds: [],
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/components/MetricWall/useMetricAttributeStats', () => ({
  useAttributeValueCounts: () => ({ data: [], isLoading: false }),
}));

// Tiles and the drill-down query ClickHouse; these tests are about the
// wall's layout and how narrowing and opening move through it.
jest.mock('@/components/MetricWall/MetricTile', () => ({
  QUANTITY_COLORS: {},
  MetricTile: ({
    item,
    onOpen,
  }: {
    item: { metric: { name: string } };
    onOpen: (i: unknown) => void;
  }) => (
    <button
      type="button"
      data-testid="metric-tile"
      onClick={() => onOpen(item)}
    >
      {item.metric.name}
    </button>
  ),
}));

jest.mock('@/components/MetricWall/MetricDrillDown', () => ({
  MetricDrillDown: ({ item }: { item: { metric: { name: string } } }) => (
    <div data-testid="metric-drill-down">{item.metric.name}</div>
  ),
}));

const source = MetricSourceSchema.parse({
  id: 'src',
  kind: SourceKind.Metric,
  name: 'Metrics',
  connection: 'conn',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: { gauge: 'otel_metrics_gauge' },
});

const dateRange: [Date, Date] = [new Date(0), new Date(1000)];

function renderBrowse() {
  renderWithMantine(
    <>
      <MetricBrowseRail
        source={source}
        dateRange={dateRange}
        onCollapse={jest.fn()}
      />
      <MetricBrowse
        source={source}
        dateRange={dateRange}
        searchFilters={[]}
        onEditAsChart={jest.fn()}
      />
    </>,
  );
}

describe('MetricBrowse', () => {
  it('lands on every metric, grouped by who reports it', () => {
    renderBrowse();

    const sections = screen.getAllByTestId('metric-wall-section');
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByText('api')).toBeInTheDocument();
    expect(within(sections[0]).getAllByTestId('metric-tile')).toHaveLength(2);
    expect(screen.getByText('3 metrics')).toBeInTheDocument();
  });

  it('narrows by quantity from the rail', async () => {
    const user = userEvent.setup();
    renderBrowse();

    const rail = screen.getByTestId('metric-wall-rail');
    await user.click(within(rail).getByRole('button', { name: /Latency/ }));

    expect(screen.getAllByTestId('metric-tile')).toHaveLength(1);
    expect(screen.getByText('1 of 3 metrics')).toBeInTheDocument();
  });

  it('opens a tile in place and closes it on a second click', async () => {
    const user = userEvent.setup();
    renderBrowse();

    await user.click(screen.getByText('node_load1'));
    expect(screen.getByTestId('metric-drill-down')).toHaveTextContent(
      'node_load1',
    );

    await user.click(screen.getByText('node_load1', { selector: 'button' }));
    expect(screen.queryByTestId('metric-drill-down')).not.toBeInTheDocument();
  });
});
