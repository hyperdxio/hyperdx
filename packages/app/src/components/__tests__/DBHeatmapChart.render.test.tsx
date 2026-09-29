import { useEffect, useState } from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

import DBHeatmapChart from '@/components/DBHeatmapChart';

type Props = Record<string, unknown>;

// DBHeatmapChart's default export is a `dynamic()` wrapper; render its inner
// component once the loader resolves.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<React.ComponentType<Props>>) => {
    const Wrapped = (props: Props) => {
      const [Component, setComponent] =
        useState<React.ComponentType<Props> | null>(null);
      useEffect(() => {
        let active = true;
        loader().then(mod => {
          if (active) setComponent(() => mod);
        });
        return () => {
          active = false;
        };
      }, []);
      return Component ? <Component {...props} /> : null;
    };
    return Wrapped;
  },
}));

// Heatmap passes uPlot `[[], [time, bucket, count]]` plus its options; record
// what it plots and with which axes.
const mockPlot = jest.fn();
jest.mock('uplot-react', () => ({
  __esModule: true,
  default: ({
    data,
    options,
  }: {
    data: [unknown, number[][]];
    options: { axes?: { splits?: unknown }[] };
  }) => {
    mockPlot(data[1], options);
    return <div data-testid="heatmap-plot" />;
  },
}));

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();

function configFor(fromMs: number) {
  const config: React.ComponentProps<typeof DBHeatmapChart>['config'] = {
    displayType: DisplayType.Heatmap,
    select: [{ aggFn: 'heatmap', valueExpression: 'Duration' }],
    from: { databaseName: 'default', tableName: 'otel_traces' },
    where: '',
    dateRange: [new Date(fromMs), new Date(fromMs + 2 * HOUR)],
    granularity: 'auto',
    timestampValueExpression: 'Timestamp',
    connection: 'test-connection',
  };
  return config;
}

// Bucket rows that line up with the time buckets of `configFor(T0)`.
const bucketData = {
  meta: [
    { name: '__hdx_time_bucket', type: 'DateTime' },
    { name: 'x_bucket', type: 'UInt32' },
    { name: 'count', type: 'UInt64' },
  ],
  data: [
    { __hdx_time_bucket: new Date(T0).toISOString(), x_bucket: 1, count: '5' },
    {
      __hdx_time_bucket: new Date(T0 + HOUR).toISOString(),
      x_bucket: 2,
      count: '3',
    },
  ],
};

// The heatmap runs two queries: the bounds (`heatmap`) and the buckets
// (`heatmap_bucket`). Route each call to its own result, the way react-query
// would report it.
function mockQueries({
  boundsPlaceholder = false,
  bucketsPlaceholder = false,
  bounds = { min: '1', max: '100' },
  buckets = bucketData,
}: {
  boundsPlaceholder?: boolean;
  bucketsPlaceholder?: boolean;
  bounds?: { min: string; max: string };
  buckets?: typeof bucketData | null;
}) {
  mockUseQueriedChartConfig.mockImplementation((_config, options) =>
    options?.queryKey?.includes('heatmap')
      ? {
          data: { data: [bounds], meta: [] },
          isLoading: false,
          isPlaceholderData: boundsPlaceholder,
          error: null,
        }
      : {
          data: buckets ?? undefined,
          isLoading: false,
          isPlaceholderData: bucketsPlaceholder,
          error: null,
        },
  );
}

function lastOptionsFor(queryName: string) {
  const calls = mockUseQueriedChartConfig.mock.calls.filter(([, options]) =>
    options?.queryKey?.includes(queryName),
  );
  return calls.at(-1)?.[1];
}

const lastPlottedCounts = () => mockPlot.mock.calls.at(-1)?.[0]?.[2];
// Only the log scale adds custom y-axis splits (ticks at powers of 10).
const lastYAxisIsLog = () =>
  mockPlot.mock.calls.at(-1)?.[1]?.axes?.[1]?.splits != null;

// A wrapper (rather than renderWithMantine) keeps the provider in place across
// rerenders, so the chart keeps its state when the range changes.
const renderChart = (fromMs: number) =>
  render(<DBHeatmapChart config={configFor(fromMs)} />, {
    wrapper: MantineProvider,
  });

describe('DBHeatmapChart refresh', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
    mockPlot.mockReset();
  });

  it('keeps both queries on their previous data while a refresh loads', async () => {
    mockQueries({});

    renderChart(T0);
    await screen.findByTestId('heatmap-plot');

    const previous = { data: [] };
    expect(lastOptionsFor('heatmap')?.placeholderData?.(previous)).toBe(
      previous,
    );
    expect(lastOptionsFor('heatmap_bucket')?.placeholderData?.(previous)).toBe(
      previous,
    );
  });

  it('keeps plotting the previous heatmap, pulsing, after the range moves', async () => {
    mockQueries({});
    const { rerender } = renderChart(T0);
    await screen.findByTestId('heatmap-plot');
    const settledCounts = lastPlottedCounts();
    expect(settledCounts).toContain(5);

    // A refresh moves to a later, non-overlapping range; both queries are
    // still showing the previous range's results.
    mockQueries({ boundsPlaceholder: true, bucketsPlaceholder: true });
    rerender(<DBHeatmapChart config={configFor(T0 + 3 * HOUR)} />);

    const plot = await screen.findByTestId('heatmap-plot');
    expect(lastPlottedCounts()).toEqual(settledCounts);
    expect(plot.closest('.heatmap-selection-container')).toHaveClass(
      'effect-pulse',
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('keeps the previous scale with the previous heatmap while a scale switch refreshes', async () => {
    mockQueries({});
    const { rerender } = renderChart(T0);
    await screen.findByTestId('heatmap-plot');
    expect(lastYAxisIsLog()).toBe(true);
    const settledCounts = lastPlottedCounts();

    // Switching to linear refetches both queries; until they return, the
    // chart still shows log-scale data, so it must keep the log axis.
    mockQueries({ boundsPlaceholder: true, bucketsPlaceholder: true });
    rerender(<DBHeatmapChart config={configFor(T0)} scaleType="linear" />);

    await screen.findByTestId('heatmap-plot');
    expect(lastPlottedCounts()).toEqual(settledCounts);
    expect(lastYAxisIsLog()).toBe(true);
  });

  it('pulses while only the bucket query is still refreshing', async () => {
    mockQueries({ bucketsPlaceholder: true });

    renderChart(T0);

    const plot = await screen.findByTestId('heatmap-plot');
    expect(plot.closest('.heatmap-selection-container')).toHaveClass(
      'effect-pulse',
    );
  });

  it('pulses while only the bounds query is still refreshing', async () => {
    mockQueries({ boundsPlaceholder: true });

    renderChart(T0);

    const plot = await screen.findByTestId('heatmap-plot');
    expect(plot.closest('.heatmap-selection-container')).toHaveClass(
      'effect-pulse',
    );
  });

  it('does not pulse once fresh data has loaded', async () => {
    mockQueries({});

    renderChart(T0);

    const plot = await screen.findByTestId('heatmap-plot');
    expect(plot.closest('.heatmap-selection-container')).not.toHaveClass(
      'effect-pulse',
    );
  });

  it('holds the bucket query until the refreshed bounds arrive', async () => {
    mockQueries({ boundsPlaceholder: true, bucketsPlaceholder: true });
    const { rerender } = renderChart(T0);
    await screen.findByTestId('heatmap-plot');
    expect(lastOptionsFor('heatmap_bucket')?.enabled).toBe(false);

    mockQueries({ bucketsPlaceholder: true });
    rerender(<DBHeatmapChart config={configFor(T0)} />);
    expect(lastOptionsFor('heatmap_bucket')?.enabled).toBe(true);
  });

  it('shows the empty state instead of pulsing when the refreshed range has no data', async () => {
    // Fresh bounds of an empty range can't bucket anything, so the bucket
    // query must not keep the previous rows as a placeholder.
    mockQueries({ bounds: { min: '0', max: '0' }, buckets: null });

    renderChart(T0);

    const empty = await screen.findByText(/Not enough data points/);
    expect(lastOptionsFor('heatmap_bucket')?.placeholderData).toBeUndefined();
    expect(lastOptionsFor('heatmap_bucket')?.enabled).toBe(false);
    expect(empty).not.toHaveClass('effect-pulse');
  });
});
