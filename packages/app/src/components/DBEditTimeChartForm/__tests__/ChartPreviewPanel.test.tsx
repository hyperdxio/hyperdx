import React from 'react';
import {
  ChartConfigWithDateRange,
  ChartVariable,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChartPreviewPanel } from '@/components/DBEditTimeChartForm/ChartPreviewPanel';

jest.mock('@/components/ChartSQLPreview', () => ({
  __esModule: true,
  default: () => <div data-testid="chart-sql-preview">Chart SQL Preview</div>,
}));

// CodeMirror doesn't render meaningfully in jsdom, so the preview is stubbed
// down to the expression it is handed — which is what these tests are about.
jest.mock('@/components/PromQLEditor/PromQLPreview', () => ({
  __esModule: true,
  default: ({ expression }: { expression: string }) => (
    <div data-testid="chart-promql-preview">{expression}</div>
  ),
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

jest.mock('@/components/DBPieChart', () => ({
  DBPieChart: () => <div data-testid="db-pie-chart">Pie Chart</div>,
}));

jest.mock('@/components/DBBarChart', () => ({
  DBBarChart: () => <div data-testid="db-bar-chart">Bar Chart</div>,
}));

jest.mock('@/components/DBSqlRowTableWithSidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="db-sql-row-table">SQL Row Table</div>,
}));

jest.mock('@/components/DBHeatmapChart', () => ({
  __esModule: true,
  default: () => <div data-testid="db-heatmap-chart">Heatmap Chart</div>,
  toHeatmapChartConfig: (config: unknown) => ({
    heatmapConfig: config,
    scaleType: 'log' as const,
  }),
  buildHeatmapBoundsConfig: ({ config }: { config: unknown }) => config,
  buildHeatmapBucketConfig: ({ config }: { config: unknown }) => config,
  HEATMAP_N_BUCKETS: 80,
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
      showGeneratedPromql={false}
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

    it('should render bar chart for bar tab', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        activeTab: 'bar',
      });

      expect(screen.getByTestId('db-bar-chart')).toBeInTheDocument();
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

    it('should disable the Generated SQL control before a query has run', () => {
      renderPanel({
        queriedConfig: undefined,
        showGeneratedSql: true,
        activeTab: 'time',
      });

      expect(
        screen.getByRole('button', { name: /Generated SQL/ }),
      ).toBeDisabled();
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

    it('should label the bounds and heatmap queries when on the heatmap tab', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        chartConfigForExplanations: baseBuilderConfig,
        showGeneratedSql: true,
        activeTab: 'heatmap',
      });

      // Both query labels render — heatmap actually runs two sequential
      // queries (bounds first, then bucketed counts).
      expect(screen.getByText(/Bounds query/i)).toBeInTheDocument();
      expect(screen.getByText(/Heatmap query/i)).toBeInTheDocument();
    });
  });

  describe('generated PromQL section', () => {
    const EXPRESSION = 'e2e_service_up{service=~"$svc"}';

    // What the editor hands the panel after a run: `resolvePreviewVariables`
    // has already narrowed `variables` to the ones this expression references,
    // and left it undefined off a dashboard.
    const promqlConfig = (
      overrides: {
        promqlExpression?: string;
        variables?: ChartVariable[];
      } = {},
    ): ChartConfigWithDateRange => ({
      configType: 'promql',
      promqlExpression: EXPRESSION,
      connection: 'default',
      from: { databaseName: 'default', tableName: 'metrics' },
      dateRange,
      ...overrides,
    });

    const generatedPromqlControl = () =>
      screen.getByRole('button', { name: /Generated PromQL/ });

    const openGeneratedPromql = () => userEvent.click(generatedPromqlControl());

    it('is absent outside PromQL mode', () => {
      renderPanel({
        queriedConfig: baseBuilderConfig,
        showGeneratedPromql: false,
      });

      expect(screen.queryByText('Generated PromQL')).not.toBeInTheDocument();
    });

    it('is disabled until the tile has been queried', () => {
      // Present from the moment the editor enters PromQL mode: an accordion
      // that appeared only on the first successful run would read as a missing
      // feature rather than as an empty one.
      renderPanel({ queriedConfig: undefined, showGeneratedPromql: true });

      expect(generatedPromqlControl()).toBeDisabled();
    });

    it('says why it is disabled on hover', async () => {
      renderPanel({ queriedConfig: undefined, showGeneratedPromql: true });

      // Hovering the wrapper, not the control: the control is inert while
      // disabled, which is the whole reason the tooltip hangs off the wrapper.
      const wrapper = generatedPromqlControl().parentElement;
      expect(wrapper).not.toBeNull();
      await userEvent.hover(wrapper!);

      expect(
        await screen.findByText('Run the query to see the preview'),
      ).toBeInTheDocument();
    });

    it('is disabled while the last query was of another kind', () => {
      // Switching an already-queried builder tile to PromQL: the config on
      // hand describes a query this panel can't render as PromQL.
      renderPanel({
        queriedConfig: baseBuilderConfig,
        showGeneratedPromql: true,
      });

      expect(generatedPromqlControl()).toBeDisabled();
    });

    it('shows the expression as written when no variables are in scope', async () => {
      // Off a dashboard nothing is substituted, but the panel still states
      // what ran — the same terms the generated SQL is shown on.
      renderPanel({
        queriedConfig: promqlConfig(),
        showGeneratedPromql: true,
      });
      await openGeneratedPromql();

      expect(screen.getByTestId('chart-promql-preview')).toHaveTextContent(
        EXPRESSION,
      );
    });

    it('is enabled when the expression references none of the variables', () => {
      // `[]` is a dashboard with variables, none of which this expression
      // references.
      renderPanel({
        queriedConfig: promqlConfig({
          promqlExpression: 'e2e_service_up',
          variables: [],
        }),
        showGeneratedPromql: true,
      });

      expect(generatedPromqlControl()).toBeEnabled();
    });

    it('shows the expression with its variables expanded', async () => {
      renderPanel({
        queriedConfig: promqlConfig({
          variables: [{ name: 'svc', values: ['api', 'web'] }],
        }),
        showGeneratedPromql: true,
      });
      await openGeneratedPromql();

      // A regex alternation, promql's default format — the string that
      // actually goes to Prometheus, not the template the input holds.
      expect(screen.getByTestId('chart-promql-preview')).toHaveTextContent(
        'e2e_service_up{service=~"(api|web)"}',
      );
    });

    it('renders an empty selection as the match-everything regex', async () => {
      renderPanel({
        queriedConfig: promqlConfig({
          variables: [{ name: 'svc', values: [] }],
        }),
        showGeneratedPromql: true,
      });
      await openGeneratedPromql();

      expect(screen.getByTestId('chart-promql-preview')).toHaveTextContent(
        'e2e_service_up{service=~".*"}',
      );
    });

    it('is disabled when substitution throws', async () => {
      // `json` is not a format substitution knows, so it raises rather than
      // guessing. The query path raises on the same expression, so nothing
      // ran — showing the template would claim an expression Prometheus never
      // saw.
      renderPanel({
        queriedConfig: promqlConfig({
          promqlExpression: 'up{service=~"${svc:json}"}',
          variables: [{ name: 'svc', values: ['api'] }],
        }),
        showGeneratedPromql: true,
      });

      expect(generatedPromqlControl()).toBeDisabled();

      const wrapper = generatedPromqlControl().parentElement;
      expect(wrapper).not.toBeNull();
      await userEvent.hover(wrapper!);

      expect(
        await screen.findByText(/Variables could not be expanded/),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('chart-promql-preview'),
      ).not.toBeInTheDocument();
    });
  });
});
