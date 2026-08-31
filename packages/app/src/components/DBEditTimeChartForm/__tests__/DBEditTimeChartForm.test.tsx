import React from 'react';
import {
  DisplayType,
  MetricsDataType,
  SavedChartConfig,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DBEditTimeChartForm from '@/components/DBEditTimeChartForm';
import { useSource } from '@/source';

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
const mockStagedWhere: string[] = [];
const mockStagedGroupBy: string[] = [];

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

describe('DBEditTimeChartForm - Metric Name Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show validation error when clicking play without selecting a metric name', async () => {
    renderComponent();

    // Find and click the play button
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Verify that the validation error is displayed
    await waitFor(() => {
      const errorMessage = screen.getByTestId('metric-name-error');
      expect(errorMessage).toBeInTheDocument();
      expect(errorMessage).toHaveTextContent('Metric is required');
    });

    // Verify that the metric name select has aria-invalid attribute
    const metricSelect = screen.getByTestId('metric-name-selector');
    expect(metricSelect).toHaveAttribute('aria-invalid', 'true');
  });

  it('should clear validation error when focusing on the metric name field', async () => {
    renderComponent();

    // Click play button to trigger validation
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByTestId('metric-name-error')).toBeInTheDocument();
    });

    // Focus on the metric name select
    const metricSelect = screen.getByTestId('metric-name-selector');
    fireEvent.focus(metricSelect);

    // Verify that the error is cleared
    await waitFor(() => {
      expect(screen.queryByTestId('metric-name-error')).not.toBeInTheDocument();
    });
  });

  it('should not show validation error when a metric name is selected', async () => {
    renderComponent();

    // Select a metric name
    const metricSelect = screen.getByTestId('metric-name-selector');
    await userEvent.selectOptions(metricSelect, 'test.metric.gauge');

    // Click play button
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Verify that no validation error is displayed
    await waitFor(() => {
      expect(screen.queryByTestId('metric-name-error')).not.toBeInTheDocument();
    });
  });

  it('should validate all series when multiple series are present', async () => {
    const configWithMultipleSeries = {
      ...defaultChartConfig,
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'lucene' as const,
          valueExpression: '',
          metricType: MetricsDataType.Gauge,
          metricName: 'test.metric.gauge',
        },
        {
          aggFn: 'sum',
          aggCondition: '',
          aggConditionLanguage: 'lucene' as const,
          valueExpression: '',
          metricType: MetricsDataType.Gauge,
          metricName: '', // Empty metric name - should trigger validation
        },
      ],
    };

    renderComponent({ chartConfig: configWithMultipleSeries });

    // Click play button
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Verify that validation error is displayed for the series without a metric name
    await waitFor(() => {
      const errorMessages = screen.getAllByTestId('metric-name-error');
      // Should only show error for the second series (first has a metric name)
      expect(errorMessages).toHaveLength(1);
    });
  });

  it('should allow form submission after fixing validation errors', async () => {
    renderComponent();

    // Click play button to trigger validation
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByTestId('metric-name-error')).toBeInTheDocument();
    });

    // Select a metric name to fix the error
    const metricSelect = screen.getByTestId('metric-name-selector');
    await userEvent.selectOptions(metricSelect, 'test.metric.gauge');

    // Click play button again
    await userEvent.click(playButton);

    // Verify that no validation error is displayed
    await waitFor(() => {
      expect(screen.queryByTestId('metric-name-error')).not.toBeInTheDocument();
    });
  });

  it('should not validate non-metric sources', async () => {
    const nonMetricConfig = {
      ...defaultChartConfig,
      source: 'logs-source',
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          aggConditionLanguage: 'lucene' as const,
          valueExpression: '',
        },
      ],
    };

    // Mock useSource to return a non-metric source
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    jest.mocked(useSource).mockReturnValueOnce({
      data: {
        id: 'logs-source',
        kind: SourceKind.Log,
        name: 'Test Logs Source',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        connection: 'default',
        timestampValueExpression: 'Timestamp',
      },
    } as ReturnType<typeof useSource>);

    renderComponent({ chartConfig: nonMetricConfig });

    // Click play button
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Verify that no validation error is displayed (since it's not a metric source)
    await waitFor(() => {
      expect(screen.queryByTestId('metric-name-error')).not.toBeInTheDocument();
    });
  });

  it('should show validation error only when metricType is set but metricName is empty', async () => {
    const configWithMetricType = {
      ...defaultChartConfig,
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'lucene' as const,
          valueExpression: '',
          metricType: MetricsDataType.Gauge,
          metricName: '', // Empty metricName with metricType set - should trigger validation
        },
      ],
    };

    renderComponent({ chartConfig: configWithMetricType });

    // Click play button
    const playButton = screen.getByTestId('chart-run-query-button');
    await userEvent.click(playButton);

    // Verify that validation error is displayed (metricType is set but metricName is empty)
    await waitFor(() => {
      const errorMessage = screen.getByTestId('metric-name-error');
      expect(errorMessage).toBeInTheDocument();
      expect(errorMessage).toHaveTextContent('Metric is required');
    });
  });
});

describe('DBEditTimeChartForm - Save Button Metric Name Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show validation error when clicking save without selecting a metric name', async () => {
    const onSave = jest.fn();
    renderComponent({ onSave });

    // Find and click the save button
    const saveButton = screen.getByTestId('chart-save-button');
    await userEvent.click(saveButton);

    // Verify that the validation error is displayed
    await waitFor(() => {
      const errorMessage = screen.getByTestId('metric-name-error');
      expect(errorMessage).toBeInTheDocument();
      expect(errorMessage).toHaveTextContent('Metric is required');
    });

    // Verify that onSave was not called
    expect(onSave).not.toHaveBeenCalled();

    // Verify that the metric name select has aria-invalid attribute
    const metricSelect = screen.getByTestId('metric-name-selector');
    expect(metricSelect).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('DBEditTimeChartForm - Add/delete alerts for display type Number', () => {
  const renderAlertComponent = (
    props: Partial<React.ComponentProps<typeof DBEditTimeChartForm>> = {},
  ) =>
    renderComponent({
      chartConfig: { ...defaultChartConfig, displayType: DisplayType.Number },
      dashboardId: 'test-dashboard-id',
      ...props,
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should add an alert when clicking the add alert button', async () => {
    renderAlertComponent();

    // Find and click the add alert button
    const alertButton = screen.getByTestId('alert-button');
    expect(alertButton).toHaveTextContent('Add Alert');
    await userEvent.click(alertButton);

    // Verify that the alert is added
    const alert = screen.getByTestId('alert-details');
    expect(alert).toBeInTheDocument();
  });

  it('should remove an alert when clicking the remove alert button', async () => {
    const onSave = jest.fn();
    renderAlertComponent({ onSave });

    // Find and click the add alert button
    const addAlertButton = screen.getByTestId('alert-button');
    await userEvent.click(addAlertButton);

    // Verify that the alert is added
    const alert = screen.getByTestId('alert-details');
    expect(alert).toBeInTheDocument();

    expect(addAlertButton).not.toBeVisible();

    const removeAlertButton = screen.getByTestId('remove-alert-button');
    await userEvent.click(removeAlertButton);

    // Verify that the alert is deleted
    expect(alert).not.toBeInTheDocument();

    // Verify that onSave was not called
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows alert scheduling fields inside advanced settings', async () => {
    renderAlertComponent();

    await userEvent.click(screen.getByTestId('alert-button'));

    // Mantine v9 Collapse sets aria-hidden on its wrapper element
    const collapseWrapper = screen
      .getByTestId('alert-advanced-settings-panel')
      .closest('[aria-hidden]');
    expect(collapseWrapper).toHaveAttribute('aria-hidden', 'true');

    await userEvent.click(screen.getByTestId('alert-advanced-settings-toggle'));

    await waitFor(() => {
      expect(collapseWrapper).toHaveAttribute('aria-hidden', 'false');
    });
    expect(screen.getByText('Anchor start time')).toBeInTheDocument();
    expect(
      screen.getByTestId('alert-advanced-settings-toggle'),
    ).toHaveTextContent('Advanced Settings');
  });
});

describe('DBEditTimeChartForm - Alert variable warning', () => {
  const SVC = { name: 'svc', expression: 'ServiceName', values: [] };

  const renderWithAlert = async (
    props: Partial<React.ComponentProps<typeof DBEditTimeChartForm>> = {},
  ) => {
    renderComponent({
      chartConfig: { ...defaultChartConfig, displayType: DisplayType.Number },
      dashboardId: 'test-dashboard-id',
      ...props,
    });
    await userEvent.click(screen.getByTestId('alert-button'));
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('warns that an alerting tile referencing a variable runs on its empty state', async () => {
    await renderWithAlert({
      chartConfig: {
        ...defaultChartConfig,
        displayType: DisplayType.Number,
        where: 'ServiceName:$svc',
      },
      variables: [SVC],
    });

    const warning = await screen.findByText('Warning');
    await userEvent.hover(warning);
    expect(
      await screen.findByText(
        'This tile references $svc. Alerts run with every dashboard variable in its empty state, not the values selected here.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing when the tile references no variable', async () => {
    await renderWithAlert({ variables: [SVC] });

    expect(screen.getByTestId('alert-details')).toBeInTheDocument();
    expect(screen.queryByText('Warning')).not.toBeInTheDocument();
  });

  it('says nothing where no variables are in scope', async () => {
    await renderWithAlert({
      chartConfig: {
        ...defaultChartConfig,
        displayType: DisplayType.Number,
        where: 'ServiceName:$svc',
      },
    });

    expect(screen.getByTestId('alert-details')).toBeInTheDocument();
    expect(screen.queryByText('Warning')).not.toBeInTheDocument();
  });
});

describe('DBEditTimeChartForm - Duplicate series', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const sourceSeries = {
    aggFn: 'avg' as const,
    aggCondition: '',
    aggConditionLanguage: 'lucene' as const,
    valueExpression: 'Value',
    metricType: MetricsDataType.Gauge,
    metricName: 'test.metric.gauge',
    alias: 'avg latency',
  };

  const renderWithSingleSeries = (
    props: Partial<React.ComponentProps<typeof DBEditTimeChartForm>> = {},
  ) =>
    renderComponent({
      chartConfig: { ...defaultChartConfig, select: [sourceSeries] },
      ...props,
    });

  it('inserts a copy of the series directly below when duplicating', async () => {
    renderWithSingleSeries();
    expect(screen.getAllByTestId('series-alias-input')).toHaveLength(1);

    await userEvent.click(screen.getByTestId('series-actions-menu'));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Duplicate' }),
    );

    const aliasInputs = screen.getAllByTestId('series-alias-input');
    expect(aliasInputs).toHaveLength(2);
    expect(aliasInputs[0]).toHaveValue('avg latency');
    // The copy starts with a blank alias so it does not collide with the
    // original's alias in the generated SQL.
    expect(aliasInputs[1]).toHaveValue('');
  });

  it('saves both the original and the duplicated series', async () => {
    const onSave = jest.fn();
    renderWithSingleSeries({ onSave });

    await userEvent.click(screen.getByTestId('series-actions-menu'));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Duplicate' }),
    );
    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.select).toHaveLength(2);
    expect(saved.select[0]).toMatchObject(sourceSeries);
    // The copy matches the source on every field except the alias, which is
    // cleared so the two columns get distinct names in the generated SQL.
    expect(saved.select[1]).toMatchObject({ ...sourceSeries, alias: '' });
    expect(saved.select[1].alias).toBe('');
  });

  it('keeps the duplicated series independent of the original', async () => {
    const onSave = jest.fn();
    renderWithSingleSeries({ onSave });

    await userEvent.click(screen.getByTestId('series-actions-menu'));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Duplicate' }),
    );

    const aliasInputs = screen.getAllByTestId('series-alias-input');
    await userEvent.clear(aliasInputs[1]);
    await userEvent.type(aliasInputs[1], 'p95 latency');

    expect(screen.getAllByTestId('series-alias-input')[0]).toHaveValue(
      'avg latency',
    );

    await userEvent.click(screen.getByTestId('chart-save-button'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.select[0]).toMatchObject({ alias: 'avg latency' });
    expect(saved.select[1]).toMatchObject({ alias: 'p95 latency' });
  });
});

describe('DBEditTimeChartForm - Column color', () => {
  // Per-column color targets builder table tiles on log / trace / event
  // sources; point useSource at a non-metric source for these.
  const logSource = {
    id: 'log-source',
    kind: SourceKind.Log,
    name: 'Logs',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    connection: 'default',
    timestampValueExpression: 'Timestamp',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    jest.mocked(useSource).mockReturnValue({
      data: logSource,
    } as ReturnType<typeof useSource>);
  });

  const colorSeries = {
    aggFn: 'count' as const,
    aggCondition: '',
    aggConditionLanguage: 'lucene' as const,
    valueExpression: '',
    alias: 'event count',
  };

  const tableConfig = {
    ...defaultChartConfig,
    source: 'log-source',
    displayType: DisplayType.Table,
    select: [colorSeries],
  };

  it('shows the per-column color control on table tiles', async () => {
    renderComponent({ chartConfig: tableConfig });

    await userEvent.click(screen.getByTestId('series-actions-menu'));
    expect(
      await screen.findByRole('menuitem', { name: 'Color' }),
    ).toBeInTheDocument();
  });

  it('hides the per-column color control on non-table tiles', async () => {
    renderComponent({
      chartConfig: { ...tableConfig, displayType: DisplayType.Line },
    });

    await userEvent.click(screen.getByTestId('series-actions-menu'));
    expect(
      await screen.findByRole('menuitem', { name: 'Duplicate' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Color' }),
    ).not.toBeInTheDocument();
  });

  it('opens the column color drawer when the control is clicked', async () => {
    renderComponent({ chartConfig: tableConfig });

    await userEvent.click(screen.getByTestId('series-actions-menu'));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Color' }),
    );

    // The drawer renders the reused color swatch + rules editor.
    expect(
      await screen.findByTestId('color-swatch-input-trigger'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('series-color-apply')).toBeInTheDocument();
  });
});

describe('DBEditTimeChartForm - Metric formulas', () => {
  const mockUseSourceData = (data: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const mocked = { data } as ReturnType<typeof useSource>;
    jest.mocked(useSource).mockReturnValue(mocked);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Earlier describes override the useSource mock with mockReturnValue
    // (which survives clearAllMocks), so pin the metric source back.
    mockUseSourceData({
      id: 'metric-source',
      kind: SourceKind.Metric,
      name: 'Test Metric Source',
      from: { databaseName: 'default', tableName: '' },
      connection: 'default',
      timestampValueExpression: 'Timestamp',
      metricTables: {
        gauge: 'metrics.gauge',
        sum: 'metrics.sum',
        histogram: 'metrics.histogram',
      },
    });
  });

  const gaugeSeries = {
    aggFn: 'avg' as const,
    aggCondition: '',
    aggConditionLanguage: 'lucene' as const,
    valueExpression: 'Value',
    metricType: MetricsDataType.Gauge,
    metricName: 'test.metric.gauge',
  };

  const twoSeriesConfig: SavedChartConfig = {
    ...defaultChartConfig,
    select: [gaugeSeries, { ...gaugeSeries, metricName: 'test.metric.sum' }],
  };

  it('shows the Add Formula button and series letter badges for metric sources', () => {
    renderComponent({ chartConfig: twoSeriesConfig });

    expect(screen.getByTestId('add-formula-button')).toBeInTheDocument();
    const badges = screen.getAllByTestId('series-ref-badge');
    expect(badges.map(b => b.textContent)).toEqual(['A', 'B']);
  });

  it('adds a formula row with an expression input when Add Formula is clicked', async () => {
    renderComponent({ chartConfig: twoSeriesConfig });

    await userEvent.click(screen.getByTestId('add-formula-button'));

    expect(screen.getByTestId('formula-expression-input')).toBeInTheDocument();
    expect(screen.getByTestId('formula-alias-input')).toBeInTheDocument();
  });

  it('shows an inline validation error for a malformed expression', async () => {
    renderComponent({ chartConfig: twoSeriesConfig });

    await userEvent.click(screen.getByTestId('add-formula-button'));
    await userEvent.type(screen.getByTestId('formula-expression-input'), 'A +');

    await waitFor(() => {
      expect(
        screen.getByText(/Unexpected end of expression/),
      ).toBeInTheDocument();
    });
  });

  it('shows an inline validation error for an unknown series reference', async () => {
    renderComponent({ chartConfig: twoSeriesConfig });

    await userEvent.click(screen.getByTestId('add-formula-button'));
    await userEvent.type(screen.getByTestId('formula-expression-input'), 'C');

    await waitFor(() => {
      expect(screen.getByText(/Unknown series "C"/)).toBeInTheDocument();
    });
  });

  it('clears the inline error once the expression becomes valid', async () => {
    renderComponent({ chartConfig: twoSeriesConfig });

    await userEvent.click(screen.getByTestId('add-formula-button'));
    const input = screen.getByTestId('formula-expression-input');
    await userEvent.type(input, 'C');
    await waitFor(() => {
      expect(screen.getByText(/Unknown series "C"/)).toBeInTheDocument();
    });

    await userEvent.clear(input);
    await userEvent.type(input, 'A / (A + B) * 100');

    await waitFor(() => {
      expect(screen.queryByText(/Unknown series/)).not.toBeInTheDocument();
    });
  });

  it('saves formulas on the chart config', async () => {
    const onSave = jest.fn();
    renderComponent({ chartConfig: twoSeriesConfig, onSave });

    await userEvent.click(screen.getByTestId('add-formula-button'));
    await userEvent.type(
      screen.getByTestId('formula-expression-input'),
      'A / (A + B) * 100',
    );
    await userEvent.type(
      screen.getByTestId('formula-alias-input'),
      'Share of gauge',
    );
    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.formulas).toEqual([
      { expression: 'A / (A + B) * 100', alias: 'Share of gauge' },
    ]);
  });

  it('blocks save when the formula expression is invalid', async () => {
    const onSave = jest.fn();
    renderComponent({ chartConfig: twoSeriesConfig, onSave });

    await userEvent.click(screen.getByTestId('add-formula-button'));
    await userEvent.type(screen.getByTestId('formula-expression-input'), 'Z');
    await userEvent.click(screen.getByTestId('chart-save-button'));

    // Save is rejected by validateChartForm; onSave never fires.
    await waitFor(() => {
      expect(screen.getAllByText(/Unknown series "Z"/).length).toBeGreaterThan(
        0,
      );
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes the formula row and clears formulas from the saved config', async () => {
    const onSave = jest.fn();
    renderComponent({
      chartConfig: {
        ...twoSeriesConfig,
        formulas: [{ expression: 'A + B' }],
        showOperandSeries: false,
      },
      onSave,
    });

    expect(screen.getByTestId('formula-expression-input')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('formula-remove-button'));
    expect(
      screen.queryByTestId('formula-expression-input'),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('chart-save-button'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.formulas).toBeUndefined();
    expect(saved.showOperandSeries).toBeUndefined();
  });

  it('hides the As Ratio toggle while a formula exists', () => {
    renderComponent({
      chartConfig: {
        ...twoSeriesConfig,
        formulas: [{ expression: 'A + B' }],
      },
    });

    expect(screen.queryByLabelText('As Ratio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show input series')).toBeInTheDocument();
  });

  it('hides the Add Formula button while ratio mode is enabled', () => {
    renderComponent({
      chartConfig: { ...twoSeriesConfig, seriesReturnType: 'ratio' },
    });

    expect(screen.getByLabelText('As Ratio')).toBeInTheDocument();
    expect(screen.queryByTestId('add-formula-button')).not.toBeInTheDocument();
  });

  it('toggles showOperandSeries via the Show input series switch', async () => {
    const onSave = jest.fn();
    renderComponent({
      chartConfig: {
        ...twoSeriesConfig,
        formulas: [{ expression: 'A + B' }],
      },
      onSave,
    });

    const toggle = screen.getByLabelText('Show input series');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);

    await userEvent.click(screen.getByTestId('chart-save-button'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].showOperandSeries).toBe(false);
  });

  it('Number tiles take a single formula and always hide input series', async () => {
    const onSave = jest.fn();
    renderComponent({
      chartConfig: {
        ...twoSeriesConfig,
        displayType: DisplayType.Number,
        // A formula defined before switching the display type to Number,
        // with the operand series still shown.
        formulas: [{ expression: 'A / (A + B) * 100' }],
      },
      onSave,
    });

    // One formula is the cap on Number tiles, and the operand series are
    // hidden unconditionally, so neither control is offered.
    expect(screen.queryByTestId('add-formula-button')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Show input series'),
    ).not.toBeInTheDocument();

    // Saving hardcodes hidden operand series onto the config.
    await userEvent.click(screen.getByTestId('chart-save-button'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].showOperandSeries).toBe(false);
  });

  it('shows formula controls and series letter badges for log event sources', async () => {
    const onSave = jest.fn();
    mockUseSourceData({
      id: 'log-source',
      kind: SourceKind.Log,
      name: 'Logs',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      connection: 'default',
      timestampValueExpression: 'Timestamp',
    });

    const countSeries = {
      aggFn: 'count' as const,
      aggCondition: '',
      aggConditionLanguage: 'lucene' as const,
      valueExpression: '',
    };
    renderComponent({
      chartConfig: {
        ...defaultChartConfig,
        source: 'log-source',
        select: [
          { ...countSeries, aggCondition: 'SeverityText:error' },
          countSeries,
        ],
      },
      onSave,
    });

    const badges = screen.getAllByTestId('series-ref-badge');
    expect(badges.map(b => b.textContent)).toEqual(['A', 'B']);

    await userEvent.click(screen.getByTestId('add-formula-button'));
    await userEvent.type(
      screen.getByTestId('formula-expression-input'),
      'A / B * 100',
    );
    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].formulas).toEqual([
      { expression: 'A / B * 100', alias: '' },
    ]);
  });

  it('does not show formula controls for formula-incapable source kinds', () => {
    mockUseSourceData({
      id: 'session-source',
      kind: SourceKind.Session,
      name: 'Sessions',
      from: { databaseName: 'default', tableName: 'sessions' },
      connection: 'default',
      timestampValueExpression: 'Timestamp',
      traceSourceId: 'trace-source',
    });

    renderComponent({
      chartConfig: {
        ...defaultChartConfig,
        source: 'session-source',
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene' as const,
            valueExpression: '',
          },
        ],
      },
    });

    expect(screen.queryByTestId('add-formula-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('series-ref-badge')).not.toBeInTheDocument();
  });
});
