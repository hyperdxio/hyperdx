import React, { useState } from 'react';
import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MetricNameSelect } from '@/components/MetricNameSelect';

// Comfortably past the component's 300ms search debounce.
const DEBOUNCE_SETTLE_MS = 800;

const useGetMetricNames = jest.fn();
const streamDistinctIndexValues = jest.fn();

// Browsing streams from the primary index; only a search reaches
// `useGetMetricNames`. Both mocked so each test can assert against its path.
jest.mock('@/hooks/useMetadata', () => ({
  useGetMetricNames: (...args: any[]) => useGetMetricNames(...args),
  useMetadataWithSettings: () => ({
    streamDistinctIndexValues: (...args: any[]) =>
      streamDistinctIndexValues(...args),
  }),
}));

/** Args the index stream was asked for, per kind table. */
const streamArgs = () => streamDistinctIndexValues.mock.calls.map(([a]) => a);

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

/** One client per render so a cached browse list cannot leak between tests. */
const withQueryClient = (ui: React.ReactElement) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {ui}
  </QueryClientProvider>
);

const renderSelect = (
  props: Partial<React.ComponentProps<typeof MetricNameSelect>> = {},
) =>
  renderWithMantine(
    withQueryClient(
      <MetricNameSelect
        metricType={MetricsDataType.Gauge}
        metricName={null}
        setMetricType={jest.fn()}
        setMetricName={jest.fn()}
        metricSource={metricSource}
        data-testid="metric-name-selector"
        {...props}
      />,
    ),
  );

/**
 * Holds `metricName` the way the chart form does. The mock-callback harness
 * above never feeds a committed name back in, which hides every bug that only
 * appears on the render after a selection.
 */
const StatefulSelect = () => {
  const [metricName, setMetricName] = useState<string | null>(null);
  const [metricType, setMetricType] = useState(MetricsDataType.Gauge);
  return (
    <MetricNameSelect
      metricType={metricType}
      metricName={metricName}
      setMetricType={setMetricType}
      setMetricName={setMetricName}
      metricSource={metricSource}
      data-testid="metric-name-selector"
    />
  );
};

beforeEach(() => {
  useGetMetricNames.mockReset();
  useGetMetricNames.mockImplementation(({ tableName }: any) => ({
    data: tableName
      ? { names: ['group_reads', 'up'], truncated: false }
      : undefined,
  }));
  streamDistinctIndexValues.mockReset();
  streamDistinctIndexValues.mockImplementation(async function* ({
    tableName,
  }: any) {
    if (tableName) yield ['group_reads', 'up'];
  });
});

describe('MetricNameSelect', () => {
  it('passes the clamped chart date range to each metric table query', async () => {
    renderSelect({
      dateRange: [new Date('2024-06-01'), new Date('2024-06-08')],
    });

    // Browsing reads the index, so the range lands on the stream.
    await waitFor(() => expect(streamArgs().length).toBeGreaterThan(0));
    const gaugeArgs = streamArgs().find(
      a => a.tableName === 'otel_metrics_gauge',
    )!;
    // Clamped to the most recent 3 days of the selected range.
    expect(gaugeArgs.dateRange).toEqual([
      new Date('2024-06-05'),
      new Date('2024-06-08'),
    ]);
  });

  // An unconfigured kind resolves to an empty table name, which disables the
  // query rather than emitting `FROM db.``` and failing on every render.
  it('does not query metric kinds the source has no table for', async () => {
    renderSelect();

    await waitFor(() => expect(streamArgs().length).toBeGreaterThan(0));
    const tables = streamArgs().map(a => a.tableName);

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

  // A failed kind is not retried, so without this its metrics would simply be
  // missing from a dropdown that looks perfectly healthy.
  it('reports a metric kind that failed to load', () => {
    useGetMetricNames.mockImplementation(({ tableName }: any) =>
      tableName === 'otel_metrics_sum'
        ? { data: undefined, isError: true }
        : { data: tableName ? { names: ['up'], truncated: false } : undefined },
    );

    renderSelect();

    expect(screen.getByText('Some metrics failed to load')).toBeInTheDocument();
  });

  it('tells the user to search when the catalog is truncated', () => {
    useGetMetricNames.mockImplementation(({ tableName }: any) => ({
      data: tableName ? { names: ['a'], truncated: true } : undefined,
    }));

    renderSelect();

    const input = screen.getByTestId('metric-name-selector');
    expect(input).toHaveAccessibleDescription('Type to search all metrics');
    // Under the input, so appearing mid-session cannot push the input down out
    // of alignment with the browse-metrics button beside it.
    const notice = screen.getByText('Type to search all metrics');
    expect(
      input.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  describe('a search that matches nothing', () => {
    const noMatches = () =>
      useGetMetricNames.mockImplementation(({ tableName }: any) => ({
        data: tableName ? { names: [], truncated: false } : undefined,
      }));

    // The catalog only covers the most recent 3 days of the chart's range, so a
    // metric that stopped reporting is absent from the picker while its data is
    // still chartable. Mantine cannot commit a value that is not an option, so
    // without this offer the pasted name is unusable.
    it('offers the typed name, and commits it verbatim', async () => {
      noMatches();
      const setMetricName = jest.fn();
      const setMetricType = jest.fn();
      renderSelect({ setMetricName, setMetricType });

      await userEvent.type(
        screen.getByTestId('metric-name-selector'),
        'chi_clickhouse_metric_SystemErrors',
      );

      const offer = await screen.findByText(
        'chi_clickhouse_metric_SystemErrors (Gauge, no recent data)',
      );
      await userEvent.click(offer);

      expect(setMetricName).toHaveBeenCalledWith(
        'chi_clickhouse_metric_SystemErrors',
      );
      expect(setMetricType).toHaveBeenCalledWith(MetricsDataType.Gauge);
    });

    // The kind decides which table the series reads from, and a pasted name
    // carries none. One offer per kind lets the user say which, instead of
    // inheriting whatever the previous selection happened to be.
    it('offers one kind per configured table, and no others', async () => {
      noMatches();
      renderSelect();

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'zzz');

      expect(
        await screen.findByText('zzz (Gauge, no recent data)'),
      ).toBeInTheDocument();
      expect(screen.getByText('zzz (Sum, no recent data)')).toBeInTheDocument();
      // The fixture source has no histogram or exponential-histogram table, so
      // committing the name under either could never resolve.
      expect(
        screen.queryByText('zzz (Histogram, no recent data)'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('zzz (Exponential Histogram, no recent data)'),
      ).not.toBeInTheDocument();
    });

    it('commits the kind the user picked, not the current one', async () => {
      noMatches();
      const setMetricName = jest.fn();
      const setMetricType = jest.fn();
      renderSelect({
        setMetricName,
        setMetricType,
        metricType: MetricsDataType.Gauge,
      });

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'zzz');
      await userEvent.click(
        await screen.findByText('zzz (Sum, no recent data)'),
      );

      expect(setMetricName).toHaveBeenCalledWith('zzz');
      expect(setMetricType).toHaveBeenCalledWith(MetricsDataType.Sum);
    });

    // Committing the offer puts the name in `metricName`, which
    // `getMetricOptions` synthesizes its own option for, while the debounced
    // search still holds the same name for one more interval. Both build the
    // same `name:::::::type` value, and Mantine throws on a duplicate option
    // value — taking the whole chart editor down rather than degrading.
    it('survives committing the typed name', async () => {
      noMatches();
      renderWithMantine(<StatefulSelect />);

      const input = screen.getByTestId('metric-name-selector');
      await userEvent.type(input, 'chc_');
      await userEvent.click(
        await screen.findByText('chc_ (Gauge, no recent data)'),
      );

      await waitFor(() => expect(input).toHaveValue('chc_ (Gauge)'));

      // Past the debounce, where the committed name and the searched name are
      // both still in play.
      await new Promise(resolve => setTimeout(resolve, DEBOUNCE_SETTLE_MS));
      expect(input).toHaveValue('chc_ (Gauge)');
    });

    it('explains itself rather than hiding the dropdown', async () => {
      noMatches();
      renderSelect();

      await userEvent.click(screen.getByTestId('metric-name-selector'));

      expect(
        await screen.findByText('No metrics reported recently'),
      ).toBeInTheDocument();
    });

    // Claiming a name does not exist while a kind is still answering would
    // invite the user to commit a metric that is actually available.
    it('offers nothing while a kind is in flight', async () => {
      useGetMetricNames.mockImplementation(({ tableName }: any) =>
        tableName === 'otel_metrics_sum'
          ? { data: undefined, isFetching: true }
          : { data: tableName ? { names: [], truncated: false } : undefined },
      );
      renderSelect();

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'zzz');
      await new Promise(resolve => setTimeout(resolve, DEBOUNCE_SETTLE_MS));

      expect(
        screen.queryByText('zzz (Gauge, no recent data)'),
      ).not.toBeInTheDocument();
    });

    // These queries keep the previous pattern's data while a new one is in
    // flight, so TanStack reports `success` and `isLoading` stays false. Off
    // `isLoading` the dropdown would confidently deny the metric exists for the
    // whole round trip.
    it('says it is searching rather than denying the metric exists', async () => {
      useGetMetricNames.mockImplementation(({ tableName }: any) => ({
        data: tableName ? { names: [], truncated: false } : undefined,
        isFetching: true,
      }));
      renderSelect();

      await userEvent.click(screen.getByTestId('metric-name-selector'));

      expect(await screen.findByText('Searching…')).toBeInTheDocument();
      expect(
        screen.queryByText('No metrics reported recently'),
      ).not.toBeInTheDocument();
    });

    // Nothing is in flight during the 300ms before the debounce fires, so an
    // `isFetching`-only check reads as settled while the options on screen still
    // answer the previous keystroke.
    it('says it is searching before the debounce has even fired', async () => {
      noMatches();
      renderSelect();

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'ab');

      expect(await screen.findByText('Searching…')).toBeInTheDocument();
      expect(
        screen.queryByText('No metrics reported recently'),
      ).not.toBeInTheDocument();
    });

    // "No metrics reported recently" is a claim about the source, which is the
    // wrong thing to say about a search that simply did not match.
    it('distinguishes an unmatched search from an empty source', async () => {
      useGetMetricNames.mockImplementation(({ tableName }: any) => ({
        data: tableName ? { names: [], truncated: false } : undefined,
      }));
      // No table for any kind, so no offer is appended and the message shows.
      renderSelect({
        metricSource: {
          ...metricSource,
          metricTables: {
            gauge: '',
            sum: '',
            histogram: '',
            summary: '',
            'exponential histogram': '',
          },
        },
      });

      await userEvent.click(screen.getByTestId('metric-name-selector'));
      expect(
        await screen.findByText('No metrics reported recently'),
      ).toBeInTheDocument();

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'zzz');
      await new Promise(resolve => setTimeout(resolve, DEBOUNCE_SETTLE_MS));

      expect(
        await screen.findByText('No matching metrics'),
      ).toBeInTheDocument();
    });

    // A kind whose table is misconfigured errors on every pattern and is never
    // retried, so blocking the offer on it would permanently strand this source
    // at the dead end the offer exists to remove.
    it('still offers the typed name when one kind failed to load', async () => {
      useGetMetricNames.mockImplementation(({ tableName }: any) =>
        tableName === 'otel_metrics_sum'
          ? { data: undefined, isError: true }
          : { data: tableName ? { names: [], truncated: false } : undefined },
      );
      renderSelect();

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'zzz');

      expect(
        await screen.findByText('zzz (Gauge, no recent data)'),
      ).toBeInTheDocument();
    });

    it('offers nothing when no kind answered at all', async () => {
      useGetMetricNames.mockImplementation(() => ({
        data: undefined,
        isError: true,
      }));
      renderSelect();

      await userEvent.type(screen.getByTestId('metric-name-selector'), 'zzz');
      await new Promise(resolve => setTimeout(resolve, DEBOUNCE_SETTLE_MS));

      expect(
        screen.queryByText('zzz (Gauge, no recent data)'),
      ).not.toBeInTheDocument();
    });
  });

  // Otherwise the escape hatch would clutter every partial search.
  it('does not offer the typed name when a metric matches', async () => {
    renderSelect();

    await userEvent.type(screen.getByTestId('metric-name-selector'), 'up');
    await new Promise(resolve => setTimeout(resolve, DEBOUNCE_SETTLE_MS));

    expect(
      screen.queryByText('up (Gauge, no recent data)'),
    ).not.toBeInTheDocument();
  });
});
