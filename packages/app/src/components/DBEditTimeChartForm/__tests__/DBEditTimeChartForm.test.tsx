import React from 'react';
import {
  DisplayType,
  MetricsDataType,
  SavedChartConfig,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Drawer } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DBEditTimeChartForm from '@/components/DBEditTimeChartForm';
import { useSource } from '@/source';

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

// The docked Display Settings panel renders a Mantine Select (number format);
// its Combobox calls scrollIntoView when opened, which jsdom lacks.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

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

  const duplicateFirstSeries = async () => {
    // Duplicate now lives in the series row's kebab (overflow) menu.
    await userEvent.click(screen.getAllByTestId('series-actions-menu')[0]);
    await userEvent.click(await screen.findByTestId('series-duplicate-button'));
  };

  it('inserts a copy of the series directly below when duplicating', async () => {
    renderWithSingleSeries();
    expect(screen.getAllByTestId('series-alias-input')).toHaveLength(1);

    await duplicateFirstSeries();

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

    await duplicateFirstSeries();
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

    await duplicateFirstSeries();

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

  it('shows the per-column color control on table tiles', () => {
    renderComponent({ chartConfig: tableConfig });

    expect(screen.getByTestId('series-color-button')).toBeInTheDocument();
  });

  it('hides the per-column color control on non-table tiles', () => {
    renderComponent({
      chartConfig: { ...tableConfig, displayType: DisplayType.Line },
    });

    expect(screen.queryByTestId('series-color-button')).not.toBeInTheDocument();
  });

  it('opens the column color popover when the control is clicked', async () => {
    renderComponent({ chartConfig: tableConfig });

    await userEvent.click(screen.getByTestId('series-color-button'));

    // The popover renders the reused color swatch + rules editor and writes
    // live (no Apply button — the tile's Save is the single commit point).
    expect(
      await screen.findByTestId('series-color-popover'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('color-swatch-input-trigger'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('series-color-apply')).not.toBeInTheDocument();
  });
});

// The dashboard tile editor lives inside a Drawer and docks Display Settings as
// a side panel. Esc must close only that panel (never the whole editor). This
// behavior has regressed repeatedly and was previously untested at the unit
// level (no test rendered with isDashboardForm).
describe('DBEditTimeChartForm - Docked settings panel Esc contract', () => {
  const renderDashboardForm = (
    props: Partial<React.ComponentProps<typeof DBEditTimeChartForm>> = {},
  ) =>
    renderComponent({
      chartConfig: { ...defaultChartConfig, displayType: DisplayType.Line },
      dashboardId: 'test-dashboard-id',
      isDashboardForm: true,
      ...props,
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('docks the Display Settings panel and notifies the drawer when opened', async () => {
    const onSettingsPanelOpenChange = jest.fn();
    renderDashboardForm({ onSettingsPanelOpenChange });

    await userEvent.click(screen.getByTestId('display-settings-button'));

    expect(await screen.findByTestId('tile-settings-rail')).toBeInTheDocument();
    // The containing drawer relies on this notification to disable its own
    // Esc-to-close before the panel is ever visible (guards the capture-phase
    // race that would otherwise dismiss the entire editor).
    expect(onSettingsPanelOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('closes only the panel on Escape, leaving the editor mounted', async () => {
    const onSettingsPanelOpenChange = jest.fn();
    const onClose = jest.fn();
    renderDashboardForm({ onSettingsPanelOpenChange, onClose });

    await userEvent.click(screen.getByTestId('display-settings-button'));
    expect(await screen.findByTestId('tile-settings-rail')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => {
      expect(
        screen.queryByTestId('tile-settings-rail'),
      ).not.toBeInTheDocument();
    });
    // The editor form is still there and was never asked to close.
    expect(screen.getByTestId('chart-name-input')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSettingsPanelOpenChange).toHaveBeenLastCalledWith(false);
  });

  // A Mantine Select renders role="combobox" on its input (see the sibling
  // ChartDisplaySettingsDrawer suite) and flips aria-expanded to "true" while
  // its dropdown is open. Esc from such an open combobox must be consumed by the
  // dropdown, not close the panel. Assert against both combobox-like shapes the
  // handler keys on, since Mantine's open state does not flip synchronously
  // under jsdom (so driving the real Select's attribute here is unreliable).
  it.each([
    { role: 'combobox', 'aria-expanded': 'true' },
    { 'aria-haspopup': 'listbox', 'aria-expanded': 'true' },
  ])('keeps the panel open on Escape from an open %o', async attrs => {
    renderDashboardForm();

    await userEvent.click(screen.getByTestId('display-settings-button'));
    expect(await screen.findByTestId('tile-settings-rail')).toBeInTheDocument();

    const openCombobox = document.createElement('div');
    Object.entries(attrs).forEach(([k, v]) => openCombobox.setAttribute(k, v));
    document.body.appendChild(openCombobox);
    fireEvent.keyDown(openCombobox, { key: 'Escape' });

    expect(screen.getByTestId('tile-settings-rail')).toBeInTheDocument();
    openCombobox.remove();
  });

  it('closes the panel on Escape from a non-combobox expanded control', async () => {
    renderDashboardForm();

    await userEvent.click(screen.getByTestId('display-settings-button'));
    expect(await screen.findByTestId('tile-settings-rail')).toBeInTheDocument();

    // A focusable disclosure such as an Accordion.Control carries
    // aria-expanded but is not a combobox; the narrowed exemption must let Esc
    // through so the panel closes instead of the UI reading as frozen.
    const accordionControl = document.createElement('button');
    accordionControl.setAttribute('aria-expanded', 'true');
    document.body.appendChild(accordionControl);
    fireEvent.keyDown(accordionControl, { key: 'Escape' });

    await waitFor(() => {
      expect(
        screen.queryByTestId('tile-settings-rail'),
      ).not.toBeInTheDocument();
    });
    accordionControl.remove();
  });
});

// The unit tests above render the form bare. This suite wraps it in a real
// Mantine Drawer wired exactly like EditTileDrawer (closeOnEscape driven by the
// panel-open notification), which is the only place the capture/bubble ordering
// between the drawer's Esc handling and the panel's Esc handling actually
// matters.
describe('DBEditTimeChartForm - Docked panel Esc inside a real Drawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const EditTileDrawerHarness = ({
    onDrawerClose,
  }: {
    onDrawerClose: () => void;
  }) => {
    const [settingsPanelOpen, setSettingsPanelOpen] = React.useState(false);
    return (
      <Drawer
        opened
        onClose={onDrawerClose}
        closeOnEscape={!settingsPanelOpen}
        withCloseButton={false}
      >
        <div data-testid="drawer-content-marker" />
        <QueryClientProvider client={queryClient}>
          <DBEditTimeChartForm
            chartConfig={{
              ...defaultChartConfig,
              displayType: DisplayType.Line,
            }}
            dateRange={[new Date('2024-01-01'), new Date('2024-01-02')]}
            dashboardId="test-dashboard-id"
            isDashboardForm
            onSettingsPanelOpenChange={setSettingsPanelOpen}
          />
        </QueryClientProvider>
      </Drawer>
    );
  };

  it('closes only the docked panel on Escape, keeping the drawer open', async () => {
    const onDrawerClose = jest.fn();
    renderWithMantine(<EditTileDrawerHarness onDrawerClose={onDrawerClose} />);

    await userEvent.click(screen.getByTestId('display-settings-button'));
    const panel = await screen.findByTestId('tile-settings-rail');
    expect(panel).toBeInTheDocument();

    // Dispatch Escape the way a real keypress does: on the focused element,
    // through the full event system, so it hits both the drawer's own window
    // keydown listener (Mantine closes the drawer on Esc via useWindowEvent)
    // and the window listener the panel installs.
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(
        screen.queryByTestId('tile-settings-rail'),
      ).not.toBeInTheDocument();
    });
    // The drawer must survive: only the panel closed.
    expect(screen.getByTestId('drawer-content-marker')).toBeInTheDocument();
    expect(onDrawerClose).not.toHaveBeenCalled();
  });

  it('closes the panel on the first Escape and the drawer on the second', async () => {
    const onDrawerClose = jest.fn();
    renderWithMantine(<EditTileDrawerHarness onDrawerClose={onDrawerClose} />);

    await userEvent.click(screen.getByTestId('display-settings-button'));
    expect(await screen.findByTestId('tile-settings-rail')).toBeInTheDocument();

    // First Escape: closes the panel, drawer stays open.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(
        screen.queryByTestId('tile-settings-rail'),
      ).not.toBeInTheDocument();
    });
    expect(onDrawerClose).not.toHaveBeenCalled();

    // Second Escape: now that the panel is gone the drawer re-owns Esc and
    // closes. This is the two-step contract the user expects.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(onDrawerClose).toHaveBeenCalledTimes(1);
    });
  });
});
