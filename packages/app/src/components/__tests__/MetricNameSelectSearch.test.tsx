import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MetricNameSelect } from '@/components/MetricNameSelect';

// Comfortably past the component's 300ms search debounce.
const DEBOUNCE_SETTLE_MS = 800;

const useGetMetricNames = jest.fn();

jest.mock('@/hooks/useMetadata', () => ({
  useGetMetricNames: (...args: any[]) => useGetMetricNames(...args),
}));

const metricSource: TMetricSource = {
  id: 'metric-source',
  name: 'Metrics',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  // An empty table name is how a source expresses "this kind is not
  // configured", which is what disables that kind's query.
  metricTables: {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
    histogram: '',
    summary: '',
    'exponential histogram': '',
  },
};

/** Name patterns the gauge query was asked for, oldest first. */
const gaugePatterns = () =>
  useGetMetricNames.mock.calls
    .filter(([args]) => args.tableName === 'otel_metrics_gauge')
    .map(([args]) => args.namePattern);

const renderSelect = (
  props: Partial<React.ComponentProps<typeof MetricNameSelect>> = {},
) =>
  renderWithMantine(
    <MetricNameSelect
      metricType={MetricsDataType.Gauge}
      metricName={null}
      setMetricType={jest.fn()}
      setMetricName={jest.fn()}
      metricSource={metricSource}
      data-testid="metric-name-selector"
      {...props}
    />,
  );

beforeEach(() => {
  useGetMetricNames.mockReset();
  useGetMetricNames.mockImplementation(({ tableName }: any) => ({
    data: tableName
      ? { names: ['group_reads', 'up'], truncated: false }
      : undefined,
  }));
});

describe('MetricNameSelect', () => {
  it('passes the clamped chart date range to each metric table query', () => {
    renderSelect({
      dateRange: [new Date('2024-06-01'), new Date('2024-06-08')],
    });

    const [gaugeArgs] = useGetMetricNames.mock.calls.find(
      ([args]) => args.tableName === 'otel_metrics_gauge',
    )!;
    // Clamped to the most recent 3 days of the selected range.
    expect(gaugeArgs.dateRange).toEqual([
      new Date('2024-06-05'),
      new Date('2024-06-08'),
    ]);
  });

  // An unconfigured kind resolves to an empty table name, which disables the
  // query rather than emitting `FROM db.``` and failing on every render.
  it('does not query metric kinds the source has no table for', () => {
    renderSelect();

    const tables = useGetMetricNames.mock.calls.map(([args]) => args.tableName);

    expect(tables).toContain('otel_metrics_gauge');
    expect(tables).not.toContain(undefined);
    expect(tables).toContain('');
  });

  it('sends the typed text as a server-side name pattern', async () => {
    renderSelect();

    await userEvent.type(screen.getByTestId('metric-name-selector'), 'up');

    await waitFor(() => expect(gaugePatterns()).toContain('up'));
  });

  it('shows the selected metric in the input', async () => {
    renderSelect({ metricName: 'up', metricType: MetricsDataType.Gauge });

    await waitFor(() =>
      expect(screen.getByTestId('metric-name-selector')).toHaveValue(
        'up (Gauge)',
      ),
    );
  });

  // Mantine mirrors the selected option's label into a searchable Select's input
  // and reports it through onSearchChange exactly like typed text. Forwarding it
  // would search ClickHouse for "up (Gauge)" — which matches nothing — so an
  // already-configured chart would open to an empty list.
  it('never sends the option label as a name pattern', async () => {
    renderSelect({ metricName: 'up', metricType: MetricsDataType.Gauge });

    // Wait until Mantine has mirrored the label in, then past the debounce, so
    // this cannot pass merely by winning a race with the timer.
    await waitFor(() =>
      expect(screen.getByTestId('metric-name-selector')).toHaveValue(
        'up (Gauge)',
      ),
    );
    await new Promise(resolve => setTimeout(resolve, DEBOUNCE_SETTLE_MS));

    expect(gaugePatterns()).not.toContain('up (Gauge)');
  });

  // Clearing on open means the mirrored label cannot be backspaced into a
  // fragment like "up (Gauge" and searched for.
  it('clears the mirrored label when the dropdown opens', async () => {
    renderSelect({ metricName: 'up', metricType: MetricsDataType.Gauge });

    const input = screen.getByTestId('metric-name-selector');
    await waitFor(() => expect(input).toHaveValue('up (Gauge)'));

    await userEvent.click(input);

    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('tells the user to search when the catalog is truncated', () => {
    useGetMetricNames.mockImplementation(({ tableName }: any) => ({
      data: tableName ? { names: ['a'], truncated: true } : undefined,
    }));

    renderSelect();

    expect(
      screen.getByText('Too many metrics to list — type to search'),
    ).toBeInTheDocument();
  });
});
