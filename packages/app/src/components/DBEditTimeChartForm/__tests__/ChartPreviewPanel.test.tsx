import React from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { ChartPreviewPanel } from '../ChartPreviewPanel';

jest.mock('@/components/ChartSQLPreview', () => ({
  __esModule: true,
  default: () => <div data-testid="chart-sql-preview">Chart SQL Preview</div>,
}));

jest.mock('@/components/DBTimeChart', () => ({
  DBTimeChart: () => <div data-testid="db-time-chart">Time Chart</div>,
}));

jest.mock('@/components/DBTableChart', () => ({
  __esModule: true,
  default: () => <div data-testid="db-table-chart">Table Chart</div>,
}));

jest.mock('@/components/DBNumberChart', () => ({
  __esModule: true,
  default: () => <div data-testid="db-number-chart">Number Chart</div>,
}));

jest.mock('@/components/DBHeatmapWithDeltasChart', () => ({
  __esModule: true,
  default: () => <div data-testid="db-heatmap-with-deltas">Heatmap Chart</div>,
}));

jest.mock('@/components/DBPieChart', () => ({
  DBPieChart: () => <div data-testid="db-pie-chart">Pie Chart</div>,
}));

jest.mock('@/components/DBSqlRowTableWithSidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="db-sql-row-table">SQL Row Table</div>,
}));

jest.mock('@/source', () => ({
  getFirstTimestampValueExpression: jest.fn().mockReturnValue('Timestamp'),
}));

const dateRange: [Date, Date] = [
  new Date('2024-01-01'),
  new Date('2024-01-02'),
];

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const mockTableSource = {
  id: 'test-source',
  kind: SourceKind.Log,
  name: 'Test Source',
  from: {
    databaseName: 'default',
    tableName: 'logs',
  },
  connection: 'default',
  timestampValueExpression: 'Timestamp',
} as TSource;

const baseBuilderConfig = {
  timestampValueExpression: 'Timestamp',
  connection: 'default',
  from: { databaseName: 'default', tableName: 'logs' },
  select: [{ aggFn: 'count' as const, valueExpression: '' }],
  where: '',
  granularity: 'auto' as const,
  dateRange,
};

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof ChartPreviewPanel>> = {},
) => {
  return renderWithMantine(
    <ChartPreviewPanel
      dateRange={dateRange}
      activeTab="time"
      showGeneratedSql={false}
      showSampleEvents={false}
      setValue={jest.fn()}
      onSubmit={jest.fn()}
      {...overrides}
    />,
  );
};

describe('ChartPreviewPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when no query has been run', () => {
    it('should show placeholder message', () => {
      renderPanel({ queriedConfig: undefined });

      expect(screen.getByText(/please start by defining/i)).toBeInTheDocument();
    });

    it('should not show placeholder for markdown tab', () => {
      renderPanel({ queriedConfig: undefined, activeTab: 'markdown' });

      expect(
        screen.queryByText(/please start by defining/i),
      ).not.toBeInTheDocument();
    });
  });

  describe('when query is ready', () => {
    it('should render time chart for time tab', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        dbTimeChartConfig: baseBuilderConfig,
        activeTab: 'time',
      });

      expect(screen.getByTestId('db-time-chart')).toBeInTheDocument();
    });

    it('should render table chart for table tab', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        tableSource: mockTableSource,
        activeTab: 'table',
      });

      expect(screen.getByTestId('db-table-chart')).toBeInTheDocument();
    });

    it('should render number chart for number tab', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        activeTab: 'number',
      });

      expect(screen.getByTestId('db-number-chart')).toBeInTheDocument();
    });

    it('should render pie chart for pie tab', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        activeTab: 'pie',
      });

      expect(screen.getByTestId('db-pie-chart')).toBeInTheDocument();
    });

    it('should render heatmap chart for heatmap tab', () => {
      renderPanel({
        queriedConfig: {
          ...baseBuilderConfig,
          heatmapValueExpression: 'DurationMs',
          heatmapCountExpression: 'count()',
          heatmapScaleType: 'log',
        },
        tableSource: mockTableSource,
        activeTab: 'heatmap',
      });

      expect(screen.getByTestId('db-heatmap-with-deltas')).toBeInTheDocument();
    });

    it('should not render time chart when dbTimeChartConfig is missing', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        dbTimeChartConfig: undefined,
        activeTab: 'time',
      });

      expect(screen.queryByTestId('db-time-chart')).not.toBeInTheDocument();
    });
  });

  describe('generated SQL section', () => {
    it('should show Generated SQL accordion when showGeneratedSql is true', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        showGeneratedSql: true,
        activeTab: 'time',
      });

      expect(screen.getByText('Generated SQL')).toBeInTheDocument();
    });

    it('should not show Generated SQL when showGeneratedSql is false', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        showGeneratedSql: false,
        activeTab: 'time',
      });

      expect(screen.queryByText('Generated SQL')).not.toBeInTheDocument();
    });

    it('should show Sample Matched Events when showSampleEvents is true', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        showGeneratedSql: true,
        showSampleEvents: true,
        tableSource: mockTableSource,
        activeTab: 'time',
      });

      expect(screen.getByText('Sample Matched Events')).toBeInTheDocument();
    });

    it('should not show Sample Matched Events when showSampleEvents is false', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        showGeneratedSql: true,
        showSampleEvents: false,
        activeTab: 'time',
      });

      expect(
        screen.queryByText('Sample Matched Events'),
      ).not.toBeInTheDocument();
    });
  });
});
