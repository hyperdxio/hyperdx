/**
 * The metric explorer's wiring into the chart form. Split out of
 * DBEditTimeChartForm.test.tsx: these render the full form and save it, and
 * appending them to that already-heavy suite pushed its slowest pre-existing
 * tests past the 5s-per-test budget under parallel load.
 */
import React from 'react';
import {
  DisplayType,
  MetricsDataType,
  SavedChartConfig,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DBEditTimeChartForm from '@/components/DBEditTimeChartForm';

/**
 * These render the whole chart editor and drive it through user events, so
 * individual tests routinely exceed Jest's 5s default when the suite competes
 * for CPU with the rest of the run. Verified pre-existing: the slowest tests
 * here time out the same way on a clean origin/main checkout.
 */
jest.setTimeout(20_000);

// Mock the hooks that fetch data
jest.mock('@/hooks/useFetchMetricResourceAttrs', () => ({
  useFetchMetricResourceAttrs: jest.fn().mockReturnValue({
    data: [],
  }),
  parseAttributeKeysFromSuggestions: jest.fn().mockReturnValue([]),
}));

jest.mock('@/hooks/useFetchMetricMetadata', () => ({
  useFetchMetricMetadata: jest.fn().mockReturnValue({
    data: null,
  }),
}));

jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: jest.fn().mockReturnValue({}),
  useGetKeyValues: jest.fn().mockReturnValue({
    data: [
      {
        key: 'MetricName',
        value: ['test.metric.gauge', 'test.metric.sum'],
      },
    ],
  }),
  useGetValuesDistribution: jest.fn().mockReturnValue({
    data: undefined,
    isFetching: false,
    error: undefined,
  }),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn().mockImplementation(props => {
    if (props && props.id === 'metric-source') {
      return {
        data: {
          id: 'metric-source',
          kind: SourceKind.Metric,
          name: 'Test Metric Source',
          from: {
            databaseName: 'default',
            tableName: '',
          },
          connection: 'default',
          timestampValueExpression: 'Timestamp',
          metricTables: {
            gauge: 'metrics.gauge',
            sum: 'metrics.sum',
            histogram: 'metrics.histogram',
          },
        },
      };
    }
    return { data: undefined };
  }),
  getFirstTimestampValueExpression: jest.fn().mockReturnValue('Timestamp'),
  getFirstSeriesNumberFormat: jest.fn().mockReturnValue(undefined),
  useSources: jest.fn().mockReturnValue({ data: [] }),
}));

// What the stubbed explorer reports as staged when a metric is applied. The
// `mock` prefix is required for a jest.mock factory to close over it.
let mockStagedWhere: string[] = [];
let mockStagedGroupBy: string[] = [];

// The explorer has its own suite (MetricExplorer.test.tsx). Here it is stubbed
// down to "emit a chosen metric", so these tests cover only the form wiring —
// mounting the real tree six times pushed this suite past the 5s-per-test
// budget under parallel load.
jest.mock('@/components/MetricExplorer/MetricExplorerModal', () => ({
  MetricExplorerModal: ({
    opened,
    onApply,
  }: {
    opened: boolean;
    onApply: (selection: {
      name: string;
      type: string;
      where: string[];
      groupBy: string[];
    }) => void;
  }) =>
    opened ? (
      <div data-testid="metric-explorer-stub">
        {(
          [
            ['gauge', 'test.metric.gauge'],
            ['sum', 'test.metric.counter'],
            ['histogram', 'test.metric.latency'],
          ] as const
        ).map(([type, name]) => (
          <button
            key={type}
            type="button"
            data-testid={`metric-explorer-pick-${type}`}
            onClick={() =>
              onApply({
                name,
                type,
                where: mockStagedWhere,
                groupBy: mockStagedGroupBy,
              })
            }
          >
            {name}
          </button>
        ))}
      </div>
    ) : null,
}));

jest.mock('../../MetricNameSelect', () => ({
  MetricNameSelect: (props: any) => {
    const { error, onFocus, setMetricName, metricName } = props;
    const testId = props['data-testid'];
    return (
      <div>
        <select
          data-testid={testId}
          value={metricName || ''}
          onChange={(e: any) => setMetricName(e.target.value)}
          onFocus={onFocus}
          aria-invalid={!!error}
        >
          <option value="">Select a metric...</option>
          <option value="test.metric.gauge">test.metric.gauge</option>
          <option value="test.metric.sum">test.metric.sum</option>
        </select>
        {error && <div data-testid="metric-name-error">{error}</div>}
      </div>
    );
  },
}));

jest.mock('../../SourceSelect', () => ({
  SourceSelectControlled: () => (
    <select data-testid="source-selector" defaultValue="metric-source">
      <option value="metric-source">Metric Source</option>
    </select>
  ),
}));

jest.mock('../../ChartSQLPreview', () => ({
  __esModule: true,
  default: () => <div>Chart SQL Preview</div>,
}));

jest.mock('../../DBTimeChart', () => ({
  DBTimeChart: () => <div>Time Chart</div>,
}));

jest.mock('../../DBTableChart', () => ({
  __esModule: true,
  default: () => <div>Table Chart</div>,
}));

jest.mock('../../DBNumberChart', () => ({
  __esModule: true,
  default: () => <div>Number Chart</div>,
}));

jest.mock('@/components/SearchInput/SearchInputV2', () => ({
  __esModule: true,
  default: () => <div>Search Input</div>,
}));

// The sample-events panel (rendered for event sources) reads Next router
// query state via nuqs, which isn't mounted in this test environment.
jest.mock('@/components/DBSqlRowTableWithSidebar', () => ({
  __esModule: true,
  default: () => <div>SQL Row Table</div>,
}));

jest.mock('../../MaterializedViews/MVOptimizationIndicator', () => ({
  __esModule: true,
  default: () => <div>MV Indicator</div>,
}));

jest.mock('../../SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: () => <div>SQL Editor</div>,
}));

jest.mock('@/HDXMarkdownChart', () => ({
  __esModule: true,
  default: () => <div>Markdown Chart</div>,
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const defaultChartConfig: SavedChartConfig = {
  name: 'Test Chart',
  source: 'metric-source',
  displayType: DisplayType.Line,
  select: [
    {
      aggFn: 'avg',
      aggCondition: '',
      aggConditionLanguage: 'lucene' as const,
      valueExpression: '',
      metricType: MetricsDataType.Gauge,
      metricName: '',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  granularity: 'auto',
  alignDateRangeToGranularity: true,
};

const renderComponent = (
  props: Partial<React.ComponentProps<typeof DBEditTimeChartForm>> = {},
) => {
  return renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <DBEditTimeChartForm
        chartConfig={defaultChartConfig}
        dateRange={[new Date('2024-01-01'), new Date('2024-01-02')]}
        {...props}
      />
    </QueryClientProvider>,
  );
};

describe('DBEditTimeChartForm - Metric explorer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStagedWhere = [];
    mockStagedGroupBy = [];
    // No re-pinning of the useSource mock needed: this file has a single
    // describe, and jest.clearAllMocks only clears calls, so the factory's
    // mockImplementation survives.
  });

  /** Open the explorer and have it emit a metric of the given kind. */
  const pickMetric = async (kind: 'gauge' | 'sum' | 'histogram') => {
    await userEvent.click(screen.getByTestId('metric-explorer-open'));
    await userEvent.click(
      await screen.findByTestId(`metric-explorer-pick-${kind}`),
    );
  };

  it('offers a browse control beside the metric select', () => {
    renderComponent();
    expect(screen.getByTestId('metric-explorer-open')).toBeInTheDocument();
    expect(
      screen.queryByTestId('metric-explorer-stub'),
    ).not.toBeInTheDocument();
  });

  it('opens the explorer from the browse control', async () => {
    renderComponent();
    await userEvent.click(screen.getByTestId('metric-explorer-open'));

    expect(
      await screen.findByTestId('metric-explorer-stub'),
    ).toBeInTheDocument();
  });

  it('applies a gauge with an average aggregation', async () => {
    const onSave = jest.fn();
    renderComponent({ onSave });

    await pickMetric('gauge');
    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].select[0]).toMatchObject({
      metricName: 'test.metric.gauge',
      metricType: MetricsDataType.Gauge,
      valueExpression: 'Value',
      aggFn: 'avg',
    });
  });

  it('replaces the series filter with the tag filters staged in the explorer', async () => {
    const onSave = jest.fn();
    renderComponent({
      onSave,
      chartConfig: {
        ...defaultChartConfig,
        select: [
          {
            aggFn: 'avg',
            aggCondition: "Attributes['stale'] = 'yes'",
            aggConditionLanguage: 'lucene' as const,
            valueExpression: '',
            metricType: MetricsDataType.Gauge,
            metricName: '',
          },
        ],
      },
    });

    // The stub stands in for the explorer's own staging UI.
    mockStagedWhere = ["ResourceAttributes['host.name'] = 'host-a'"];
    mockStagedGroupBy = ["ResourceAttributes['host.name']"];
    await pickMetric('gauge');
    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    // Filters belong to the newly chosen metric, so the stale one is gone.
    expect(saved.select[0].aggCondition).toBe(
      "ResourceAttributes['host.name'] = 'host-a'",
    );
    expect(saved.groupBy).toBe("ResourceAttributes['host.name']");
  });

  it('clears a stale filter when the new metric stages none', async () => {
    // Regression: the write was guarded on `where.length > 0`, so switching
    // metric without staging filters left the previous metric's condition
    // attached to the new one — an empty chart rather than an error, because a
    // Map lookup for an absent key yields '' instead of failing.
    const onSave = jest.fn();
    renderComponent({
      onSave,
      chartConfig: {
        ...defaultChartConfig,
        select: [
          {
            aggFn: 'avg',
            aggCondition: "Attributes['stale'] = 'yes'",
            aggConditionLanguage: 'lucene' as const,
            valueExpression: '',
            metricType: MetricsDataType.Gauge,
            metricName: 'test.metric.other',
          },
        ],
      },
    });

    mockStagedWhere = [];
    await pickMetric('gauge');
    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].select[0].aggCondition).toBe('');
  });

  it('clears the required-metric error on apply', async () => {
    renderComponent();

    // Trigger the validation error first.
    await userEvent.click(screen.getByTestId('chart-run-query-button'));
    await waitFor(() =>
      expect(screen.getByTestId('metric-name-error')).toBeInTheDocument(),
    );

    await pickMetric('gauge');

    await waitFor(() =>
      expect(screen.queryByTestId('metric-name-error')).not.toBeInTheDocument(),
    );
  });
});
