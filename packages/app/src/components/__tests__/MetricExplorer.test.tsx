import React from 'react';
import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MetricExplorerModal } from '@/components/MetricExplorer/MetricExplorerModal';
import type { MetricCatalogEntry } from '@/utils/metricNameTree';

// Every metric lookup hits ClickHouse directly from the browser, so the
// explorer is exercised against mocked hooks rather than a query client.
jest.mock('@/hooks/useMetricCatalog', () => ({
  useMetricCatalog: jest.fn(),
}));
jest.mock('@/hooks/useFetchMetricAttributeValues', () => ({
  useFetchMetricAttributeValues: jest.fn(),
}));
jest.mock('@/hooks/useFetchMetricResourceAttrs', () => ({
  useFetchMetricResourceAttrs: jest.fn(),
  parseAttributeKeysFromSuggestions: jest.fn(() => []),
}));

/**
 * Mock handles read back through `requireMock`, which is already typed as the
 * mocked shape — no assertion needed. Going through `jest.mocked` on the real
 * imports would instead demand a complete `UseQueryResult` from every stub,
 * when the explorer only ever reads `data` / `entries` and `isLoading`.
 */
const mockUseMetricCatalog = jest.requireMock<{
  useMetricCatalog: jest.Mock;
}>('@/hooks/useMetricCatalog').useMetricCatalog;

const mockUseFetchMetricAttributeValues = jest.requireMock<{
  useFetchMetricAttributeValues: jest.Mock;
}>('@/hooks/useFetchMetricAttributeValues').useFetchMetricAttributeValues;

const {
  useFetchMetricResourceAttrs: mockUseFetchMetricResourceAttrs,
  parseAttributeKeysFromSuggestions: mockParseAttributeKeys,
} = jest.requireMock<{
  useFetchMetricResourceAttrs: jest.Mock;
  parseAttributeKeysFromSuggestions: jest.Mock;
}>('@/hooks/useFetchMetricResourceAttrs');

const METRIC_SOURCE: TMetricSource = {
  id: 'src-1',
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

const g = (name: string, extra: Partial<MetricCatalogEntry> = {}) => ({
  name,
  type: MetricsDataType.Gauge,
  ...extra,
});

const ENTRIES: MetricCatalogEntry[] = [
  { name: 'http.server.active_requests', type: MetricsDataType.Gauge },
  { name: 'http.server.request.count', type: MetricsDataType.Sum },
  { name: 'http.server.request.duration', type: MetricsDataType.Histogram },
  { name: 'system.cpu.time', type: MetricsDataType.Sum },
  g('system.cpu.utilization'),
  g('system.memory.usage', {
    unit: 'By',
    description: 'Bytes of memory in use',
  }),
];

const CATALOG = { entries: ENTRIES, isLoading: false };

type ModalProps = React.ComponentProps<typeof MetricExplorerModal>;

function renderModal(overrides: Partial<ModalProps> = {}) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  const view = renderWithMantine(
    <MetricExplorerModal
      opened
      onClose={onClose}
      metricSource={METRIC_SOURCE}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply, onClose, view };
}

/** Click a tree row by its visible label. */
const clickRow = async (label: string) => {
  const tree = screen.getByTestId('metric-explorer-tree');
  await userEvent.click(within(tree).getByText(label));
};

/**
 * Both the header's service list and the tag drill-down read attribute values
 * through one hook, so the mock has to tell them apart — otherwise the same
 * text renders in two places and queries become ambiguous.
 */
const mockAttributeValues = (values: {
  services?: string[];
  tagValues?: string[];
}) =>
  mockUseFetchMetricAttributeValues.mockImplementation(
    ({ attributeName }: { attributeName: string }) => ({
      data:
        attributeName === 'service.name'
          ? (values.services ?? [])
          : (values.tagValues ?? []),
      isLoading: false,
    }),
  );

/**
 * The flat list is virtualized, and jsdom performs no layout — every element
 * measures 0px, so the virtualizer would conclude nothing is on screen and
 * render an empty container. Fake just enough geometry for it to fill a
 * viewport. Same approach as DBNumberChart's geometry mocks.
 */
const VIEWPORT_HEIGHT = 900;

beforeAll(() => {
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const height =
        this.dataset.testid === 'metric-explorer-list' ? VIEWPORT_HEIGHT : 46;
      return {
        width: 580,
        height,
        top: 0,
        left: 0,
        right: 580,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
  jest
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockReturnValue(VIEWPORT_HEIGHT);
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockUseMetricCatalog.mockReturnValue(CATALOG);
  mockUseFetchMetricResourceAttrs.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockAttributeValues({});
  mockParseAttributeKeys.mockReturnValue([]);
});

describe('MetricExplorerModal', () => {
  it('keeps every namespace reachable in a large mixed catalog', () => {
    // Regression: the unfiltered tree used to be capped at 800 leaves, and
    // truncation takes the alphabetical prefix — so on a real catalog dominated
    // by collector self-telemetry, every namespace after the Cs disappeared.
    mockUseMetricCatalog.mockReturnValue({
      entries: [
        ...Array.from({ length: 1200 }, (_, i) =>
          g(`ClickHouseAsyncMetrics_metric_${i}`),
        ),
        g('system.cpu.utilization'),
        g('zookeeper.connection.active'),
      ],
      isLoading: false,
    });

    renderModal();
    const tree = screen.getByTestId('metric-explorer-tree');

    expect(
      within(tree).getByText('ClickHouseAsyncMetrics_metric'),
    ).toBeInTheDocument();
    expect(within(tree).getByText('system.cpu')).toBeInTheDocument();
    expect(within(tree).getByText('zookeeper.connection')).toBeInTheDocument();
    // Nothing is dropped, so no truncation notice.
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it('labels the metric, type and unit columns', () => {
    renderModal();
    expect(screen.getByText('Metric')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Unit')).toBeInTheDocument();
  });

  it('shows a unit column, with a placeholder when a metric declares none', async () => {
    renderModal();
    await clickRow('system');
    await clickRow('memory');

    const tree = screen.getByTestId('metric-explorer-tree');
    // system.memory.usage carries `By`; nothing else in the fixture has a unit.
    expect(within(tree).getByText('By')).toBeInTheDocument();

    await clickRow('cpu');
    expect(within(tree).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('counts metrics on a group row rather than showing a bare number', () => {
    renderModal();
    const tree = screen.getByTestId('metric-explorer-tree');
    // `system` holds cpu.time, cpu.utilization and memory.usage. Scoped to the
    // row, since http.server happens to hold three as well.
    const systemRow = within(tree).getByText('system').closest('[data-value]');
    expect(systemRow).toHaveTextContent('3 metrics');
  });

  it('singularises the count for a group holding one metric', async () => {
    renderModal();
    await clickRow('system');
    const tree = screen.getByTestId('metric-explorer-tree');
    expect(within(tree).getByText('1 metric')).toBeInTheDocument();
  });

  it('renders top-level namespaces collapsed', () => {
    renderModal();
    const tree = screen.getByTestId('metric-explorer-tree');

    expect(within(tree).getByText('http.server')).toBeInTheDocument();
    expect(within(tree).getByText('system')).toBeInTheDocument();
    // Leaves stay hidden until their branch is expanded.
    expect(within(tree).queryByText('utilization')).not.toBeInTheDocument();
  });

  it('expands a namespace to reveal metrics with their kind', async () => {
    renderModal();
    await clickRow('system');

    const tree = screen.getByTestId('metric-explorer-tree');
    expect(within(tree).getByText('cpu')).toBeInTheDocument();
    expect(within(tree).getByText('memory')).toBeInTheDocument();

    await clickRow('cpu');
    expect(within(tree).getByText('utilization')).toBeInTheDocument();
    expect(within(tree).getByText('time')).toBeInTheDocument();
    expect(within(tree).getByText('Gauge')).toBeInTheDocument();
    expect(within(tree).getByText('Sum')).toBeInTheDocument();
  });

  it('filters to matching metrics and auto-expands them', async () => {
    renderModal();
    await userEvent.type(
      screen.getByTestId('metric-explorer-search'),
      'duration',
    );

    await waitFor(() => {
      const tree = screen.getByTestId('metric-explorer-tree');
      expect(within(tree).getByText('duration')).toBeInTheDocument();
    });

    const tree = screen.getByTestId('metric-explorer-tree');
    expect(within(tree).queryByText('utilization')).not.toBeInTheDocument();
    expect(within(tree).getByText('Histogram')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches the search', async () => {
    renderModal();
    await userEvent.type(screen.getByTestId('metric-explorer-search'), 'zzzz');

    await waitFor(() => {
      expect(screen.getByText('No matching metrics')).toBeInTheDocument();
    });
  });

  it('prompts for a selection before a metric is picked', () => {
    renderModal();
    expect(screen.getByText('No metric selected')).toBeInTheDocument();
    expect(screen.getByTestId('metric-explorer-apply')).toBeDisabled();
  });

  it('shows the selected metric with its unit, description, and tags', async () => {
    mockParseAttributeKeys.mockReturnValue([
      { name: 'host.name', category: 'ResourceAttributes' },
      { name: 'state', category: 'Attributes' },
    ]);
    mockAttributeValues({ services: ['api', 'worker'] });

    renderModal();
    await clickRow('system');
    await clickRow('memory');
    await clickRow('usage');

    const detail = screen.getByTestId('metric-detail-panel');
    expect(within(detail).getByText('system.memory.usage')).toBeInTheDocument();
    expect(within(detail).getByText('Gauge')).toBeInTheDocument();
    expect(
      within(detail).getByText('Bytes of memory in use'),
    ).toBeInTheDocument();
    // UCUM code rendered through formatUnitDisplay.
    expect(within(detail).getByText('Bytes')).toBeInTheDocument();
    expect(within(detail).getByText(/api/)).toBeInTheDocument();
    expect(within(detail).getByText('host.name')).toBeInTheDocument();
    expect(within(detail).getByText('state')).toBeInTheDocument();
  });

  it('shows the description on the tree row, not just in the detail pane', async () => {
    renderModal();
    await clickRow('system');
    await clickRow('memory');

    // The description is what makes an unfamiliar metric name legible while
    // scanning, so it has to be on the row itself.
    const tree = screen.getByTestId('metric-explorer-tree');
    expect(
      within(tree).getByText('Bytes of memory in use'),
    ).toBeInTheDocument();
  });

  it('matches a search against descriptions as well as names', async () => {
    renderModal();
    await userEvent.type(
      screen.getByTestId('metric-explorer-search'),
      'memory',
    );

    await waitFor(() => {
      const tree = screen.getByTestId('metric-explorer-tree');
      // Matched on the description text, which contains no "memory" segment
      // the name search would have caught on its own beyond system.memory.
      expect(within(tree).getByText('usage')).toBeInTheDocument();
    });
  });

  it('applies staged filters and group bys alongside the metric', async () => {
    mockParseAttributeKeys.mockReturnValue([
      { name: 'host.name', category: 'ResourceAttributes' },
    ]);
    mockAttributeValues({ tagValues: ['host-a'] });

    const onApply = jest.fn();
    renderModal({ onApply });
    await clickRow('system');
    await clickRow('memory');
    await clickRow('usage');
    await userEvent.click(screen.getByText('host.name'));
    await userEvent.click(screen.getAllByText('Where')[0]);
    await userEvent.click(screen.getByText('Group By'));
    await userEvent.click(screen.getByTestId('metric-explorer-apply'));

    expect(onApply).toHaveBeenCalledWith({
      name: 'system.memory.usage',
      type: MetricsDataType.Gauge,
      where: ["ResourceAttributes['host.name'] = 'host-a'"],
      groupBy: ["ResourceAttributes['host.name']"],
    });
  });

  it('removes a staged clause when its pill is dismissed', async () => {
    await openHostNameTag();
    await userEvent.click(screen.getAllByText('Where')[0]);

    await userEvent.click(
      screen.getByRole('button', {
        name: "Remove ResourceAttributes['host.name'] = 'host-a'",
      }),
    );

    expect(screen.queryByTestId('metric-explorer-staged')).toBeNull();
  });

  /** Select `system.memory.usage` and drill into its `host.name` tag. */
  const openHostNameTag = async () => {
    mockParseAttributeKeys.mockReturnValue([
      { name: 'host.name', category: 'ResourceAttributes' },
    ]);
    mockAttributeValues({ tagValues: ['host-a', 'host-b'] });

    renderModal();
    await clickRow('system');
    await clickRow('memory');
    await clickRow('usage');
    await userEvent.click(screen.getByText('host.name'));
  };

  it('stages a tag value as a filter and applies it with the metric', async () => {
    await openHostNameTag();
    expect(screen.getByText('host-a')).toBeInTheDocument();

    await userEvent.click(screen.getAllByText('Where')[0]);

    const staged = screen.getByTestId('metric-explorer-staged');
    expect(
      within(staged).getByText("ResourceAttributes['host.name'] = 'host-a'"),
    ).toBeInTheDocument();
  });

  it('stages a tag key as a group by', async () => {
    await openHostNameTag();
    await userEvent.click(screen.getByText('Group By'));

    const staged = screen.getByTestId('metric-explorer-staged');
    expect(
      within(staged).getByText("Group by ResourceAttributes['host.name']"),
    ).toBeInTheDocument();
  });

  it('drops staged filters when a different metric is selected', async () => {
    await openHostNameTag();
    await userEvent.click(screen.getAllByText('Where')[0]);
    expect(screen.getByTestId('metric-explorer-staged')).toBeInTheDocument();

    // A clause written against one metric's attributes is meaningless on another.
    await clickRow('cpu');
    await clickRow('utilization');
    expect(screen.queryByTestId('metric-explorer-staged')).toBeNull();
  });

  it('renders tag filters in the requested language', async () => {
    mockParseAttributeKeys.mockReturnValue([
      { name: 'host.name', category: 'ResourceAttributes' },
    ]);
    mockAttributeValues({ tagValues: ['host-a'] });

    renderModal({ language: 'lucene' });
    await clickRow('system');
    await clickRow('memory');
    await clickRow('usage');
    await userEvent.click(screen.getByText('host.name'));
    await userEvent.click(screen.getAllByText('Where')[0]);

    const staged = screen.getByTestId('metric-explorer-staged');
    expect(
      within(staged).getByText('ResourceAttributes.host.name:"host-a"'),
    ).toBeInTheDocument();
  });

  /** Switch the browser into flat-list mode. */
  const showList = async () => {
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    return screen.findByTestId('metric-explorer-list');
  };

  it('starts in tree mode', () => {
    renderModal();
    expect(screen.getByTestId('metric-explorer-tree')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-explorer-list')).toBeNull();
  });

  it('switches to a flat list of full metric names', async () => {
    renderModal();
    const list = await showList();

    expect(screen.queryByTestId('metric-explorer-tree')).toBeNull();
    // Full names, not the trailing segment the tree shows.
    expect(
      within(list).getByText('system.cpu.utilization'),
    ).toBeInTheDocument();
    expect(within(list).getByText('system.memory.usage')).toBeInTheDocument();
    expect(
      within(list).getByText('http.server.request.duration'),
    ).toBeInTheDocument();
    // No namespace rows to expand.
    expect(within(list).queryByText('3 metrics')).toBeNull();
  });

  it('keeps the type and unit columns in list mode', async () => {
    renderModal();
    const list = await showList();

    expect(within(list).getByText('By')).toBeInTheDocument();
    expect(within(list).getAllByText('Gauge').length).toBeGreaterThan(0);
    expect(within(list).getByText('Histogram')).toBeInTheDocument();
  });

  it('shows descriptions in list mode without expanding anything', async () => {
    renderModal();
    const list = await showList();
    expect(
      within(list).getByText('Bytes of memory in use'),
    ).toBeInTheDocument();
  });

  it('filters the flat list by search', async () => {
    renderModal();
    const list = await showList();
    await userEvent.type(
      screen.getByTestId('metric-explorer-search'),
      'duration',
    );

    // Wait on the row disappearing: the matching row is present before the
    // debounced filter applies, so asserting its presence proves nothing.
    await waitFor(() => {
      expect(within(list).queryByText('system.cpu.utilization')).toBeNull();
    });
    expect(
      within(list).getByText('http.server.request.duration'),
    ).toBeInTheDocument();
  });

  it('selects and applies from the flat list', async () => {
    const { onApply } = renderModal();
    const list = await showList();

    await userEvent.click(within(list).getByText('system.cpu.time'));
    await userEvent.click(screen.getByTestId('metric-explorer-apply'));

    expect(onApply).toHaveBeenCalledWith({
      name: 'system.cpu.time',
      type: MetricsDataType.Sum,
      where: [],
      groupBy: [],
    });
  });

  it('shows the selected metric in the detail pane from list mode', async () => {
    renderModal();
    const list = await showList();
    await userEvent.click(within(list).getByText('system.memory.usage'));

    const detail = screen.getByTestId('metric-detail-panel');
    expect(within(detail).getByText('system.memory.usage')).toBeInTheDocument();
  });

  it('remembers the chosen mode across mounts', async () => {
    const { view } = renderModal();
    await showList();
    view.unmount();

    // A fresh mount reads the persisted preference rather than defaulting.
    renderModal();
    expect(
      await screen.findByTestId('metric-explorer-list'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('metric-explorer-tree')).toBeNull();
  });

  it('reports an empty search in list mode too', async () => {
    renderModal();
    await showList();
    await userEvent.type(screen.getByTestId('metric-explorer-search'), 'zzzz');

    await waitFor(() => {
      expect(screen.getByText('No matching metrics')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('metric-explorer-list')).toBeNull();
  });

  it('applies the selected metric with its kind', async () => {
    const { onApply, onClose } = renderModal();

    await clickRow('system');
    await clickRow('cpu');
    await clickRow('utilization');
    await userEvent.click(screen.getByTestId('metric-explorer-apply'));

    expect(onApply).toHaveBeenCalledWith({
      name: 'system.cpu.utilization',
      type: MetricsDataType.Gauge,
      where: [],
      groupBy: [],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('applies on double-clicking a metric', async () => {
    const { onApply } = renderModal();

    await clickRow('system');
    await clickRow('cpu');
    const tree = screen.getByTestId('metric-explorer-tree');
    await userEvent.dblClick(within(tree).getByText('time'));

    expect(onApply).toHaveBeenCalledWith({
      name: 'system.cpu.time',
      type: MetricsDataType.Sum,
      where: [],
      groupBy: [],
    });
  });

  it('preselects the metric already on the series', () => {
    renderModal({
      value: {
        metricName: 'http.server.request.duration',
        metricType: MetricsDataType.Histogram,
      },
    });

    expect(
      screen.getByText('http.server.request.duration'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('metric-explorer-apply')).toBeEnabled();
  });

  it('does not preselect when the series has no metric yet', () => {
    renderModal({ value: { metricName: '', metricType: undefined } });
    expect(screen.getByText('No metric selected')).toBeInTheDocument();
  });

  it('shows a loader while the catalog is still being fetched', () => {
    mockUseMetricCatalog.mockReturnValue({ entries: [], isLoading: true });

    renderModal();
    expect(
      screen.queryByTestId('metric-explorer-tree'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No metrics found')).not.toBeInTheDocument();
  });

  it('contains a render crash instead of taking the chart editor down', () => {
    // The explorer is an optional surface hanging off the editor; a throw in it
    // must not propagate to whatever rendered the modal.
    mockUseMetricCatalog.mockImplementation(() => {
      throw new Error('catalog blew up');
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { onClose } = renderModal();

    expect(
      screen.getByText('Something went wrong loading the explorer.'),
    ).toBeInTheDocument();
    // The modal chrome survives, so the user is not trapped.
    expect(screen.getByTestId('metric-explorer-modal')).toBeInTheDocument();

    consoleError.mockRestore();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('distinguishes a failed catalog from a source with no metrics', () => {
    // Regression: a total load failure rendered the identical "No metrics
    // found" empty state, sending people to look for missing data rather than
    // a broken query.
    mockUseMetricCatalog.mockReturnValue({
      entries: [],
      failedKinds: [],
      isLoading: false,
      error: new Error('Code: 60. Table default.otel_metrics_gauge not found'),
    });

    renderModal();
    expect(screen.getByText('Could not load metrics')).toBeInTheDocument();
    expect(
      screen.getByText(/Table default.otel_metrics_gauge not found/),
    ).toBeInTheDocument();
    expect(screen.queryByText('No metrics found')).toBeNull();
  });

  it('warns when a kind table failed rather than silently showing a subset', () => {
    // Regression: the catalog used Promise.all, so one unreadable kind table
    // discarded every kind that loaded. Now the good kinds render — but the
    // gap has to be visible, or a missing kind reads as "this source has none".
    mockUseMetricCatalog.mockReturnValue({
      entries: ENTRIES,
      failedKinds: [MetricsDataType.Histogram],
      isLoading: false,
    });

    renderModal();
    const notice = screen.getByTestId('metric-explorer-partial-failure');
    expect(notice).toHaveTextContent(/could not load histogram metrics/i);
    // The kinds that did load are still browsable.
    expect(screen.getByTestId('metric-explorer-tree')).toBeInTheDocument();
  });

  it('shows no partial-failure notice when every kind loaded', () => {
    renderModal();
    expect(screen.queryByTestId('metric-explorer-partial-failure')).toBeNull();
  });

  it('reports an empty catalog rather than an endless loader', () => {
    mockUseMetricCatalog.mockReturnValue({ entries: [], isLoading: false });

    renderModal();
    expect(screen.getByText('No metrics found')).toBeInTheDocument();
  });
});
