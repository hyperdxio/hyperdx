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

import { useSource } from '@/source';

import DBEditTimeChartForm from '../DBEditTimeChartForm';

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
}));

jest.mock('../MetricNameSelect', () => ({
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

jest.mock('../SourceSelect', () => ({
  SourceSelectControlled: () => (
    <select data-testid="source-selector" defaultValue="metric-source">
      <option value="metric-source">Metric Source</option>
    </select>
  ),
}));

jest.mock('../ChartSQLPreview', () => ({
  __esModule: true,
  default: () => <div>Chart SQL Preview</div>,
}));

jest.mock('../DBTimeChart', () => ({
  DBTimeChart: () => <div>Time Chart</div>,
}));

jest.mock('../DBTableChart', () => ({
  __esModule: true,
  default: () => <div>Table Chart</div>,
}));

jest.mock('../DBNumberChart', () => ({
  __esModule: true,
  default: () => <div>Number Chart</div>,
}));

jest.mock('@/SearchInputV2', () => ({
  __esModule: true,
  default: () => <div>Search Input</div>,
}));

jest.mock('../MaterializedViews/MVOptimizationIndicator', () => ({
  __esModule: true,
  default: () => <div>MV Indicator</div>,
}));

jest.mock('../SQLInlineEditor', () => ({
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

describe('DBEditTimeChartForm - Metric Name Validation', () => {
  const renderComponent = (props = {}) => {
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
      expect(errorMessage).toHaveTextContent('Please select a metric name');
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
          metricType: 'gauge' as const,
          metricName: 'test.metric.gauge',
        },
        {
          aggFn: 'sum',
          aggCondition: '',
          aggConditionLanguage: 'lucene' as const,
          valueExpression: '',
          metricType: 'gauge' as const,
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
          metricType: 'gauge' as const,
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
      expect(errorMessage).toHaveTextContent('Please select a metric name');
    });
  });
});

describe('DBEditTimeChartForm - Save Button Metric Name Validation', () => {
  const renderComponent = (props = {}) => {
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
      expect(errorMessage).toHaveTextContent('Please select a metric name');
    });

    // Verify that onSave was not called
    expect(onSave).not.toHaveBeenCalled();

    // Verify that the metric name select has aria-invalid attribute
    const metricSelect = screen.getByTestId('metric-name-selector');
    expect(metricSelect).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('DBEditTimeChartForm - Add/delete alerts for display type Number', () => {
  const renderComponent = (props = {}) => {
    return renderWithMantine(
      <QueryClientProvider client={queryClient}>
        <DBEditTimeChartForm
          chartConfig={{
            ...defaultChartConfig,
            displayType: DisplayType.Number,
          }}
          dateRange={[new Date('2024-01-01'), new Date('2024-01-02')]}
          dashboardId={'test-dashboard-id'}
          {...props}
        />
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should add an alert when clicking the add alert button', async () => {
    renderComponent();

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
    renderComponent({ onSave });

    // Find and click the add alert button
    const alertButton = screen.getByTestId('alert-button');
    await userEvent.click(alertButton);

    // Verify that the alert is added
    const alert = screen.getByTestId('alert-details');
    expect(alert).toBeInTheDocument();

    // The add and remove alert button are the same element
    expect(alertButton).toHaveTextContent('Remove Alert');
    await userEvent.click(alertButton);

    // Verify that the alert is deleted
    expect(alert).not.toBeInTheDocument();

    // Verify that onSave was not called
    expect(onSave).not.toHaveBeenCalled();
  });
});
