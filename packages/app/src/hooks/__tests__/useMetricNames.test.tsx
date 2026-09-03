import React from 'react';
import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useMetricNames } from '@/hooks/useMetricNames';

const streamDistinctIndexValues = jest.fn();
const useGetMetricNames = jest.fn();

jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({
    streamDistinctIndexValues: (...args: unknown[]) =>
      streamDistinctIndexValues(...args),
  }),
  useGetMetricNames: (...args: unknown[]) => useGetMetricNames(...args),
}));

const IDLE_EXHAUSTIVE = {
  data: undefined,
  isFetching: false,
  isError: false,
};

const METRIC_SOURCE: TMetricSource = {
  id: 'metrics',
  name: 'Metrics',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  // Keyed by enum value: `ExponentialHistogram` is `'exponential histogram'`.
  metricTables: {
    [MetricsDataType.Gauge]: 'otel_metrics_gauge',
    [MetricsDataType.Sum]: 'otel_metrics_sum',
    [MetricsDataType.Histogram]: 'otel_metrics_histogram',
    [MetricsDataType.ExponentialHistogram]:
      'otel_metrics_exponential_histogram',
    [MetricsDataType.Summary]: 'otel_metrics_summary',
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

/** Yields one chunk per argument, so partial delivery can be observed. */
function streamOf(...chunks: string[][]) {
  return async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  };
}

const failingStream = (message: string) => () => ({
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.reject(new Error(message)),
  }),
});

beforeEach(() => {
  jest.clearAllMocks();
  useGetMetricNames.mockReturnValue(IDLE_EXHAUSTIVE);
  streamDistinctIndexValues.mockImplementation(streamOf());
});

describe('useMetricNames', () => {
  it('streams names from the primary index, sorted, per kind', async () => {
    streamDistinctIndexValues.mockImplementation(
      ({ tableName }: { tableName: string }) =>
        tableName === 'otel_metrics_gauge'
          ? streamOf(['system.memory.usage'], ['system.cpu.time'])()
          : streamOf()(),
    );

    const { result } = renderHook(() => useMetricNames(METRIC_SOURCE), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        // DISTINCT emits in discovery order; the hook sorts.
        'system.cpu.time',
        'system.memory.usage',
      ]),
    );
    for (const [, options] of useGetMetricNames.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ enabled: false }));
    }
  });

  it('reads MetricName from each kind table', async () => {
    renderHook(() => useMetricNames(METRIC_SOURCE), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(streamDistinctIndexValues).toHaveBeenCalledTimes(4),
    );
    const tables = streamDistinctIndexValues.mock.calls.map(
      ([args]) => args.tableName,
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        'otel_metrics_gauge',
        'otel_metrics_sum',
        'otel_metrics_histogram',
        'otel_metrics_exponential_histogram',
      ]),
    );
    // `summary` cannot be charted.
    expect(tables).not.toContain('otel_metrics_summary');
    expect(streamDistinctIndexValues.mock.calls[0][0].column).toBe(
      'MetricName',
    );
  });

  it('reports streaming until the last kind finishes', async () => {
    let releaseGauge: () => void = () => {};
    const gaugeGate = new Promise<void>(resolve => {
      releaseGauge = resolve;
    });
    streamDistinctIndexValues.mockImplementation(async function* ({
      tableName,
    }: {
      tableName: string;
    }) {
      if (tableName === 'otel_metrics_gauge') {
        yield ['a'];
        await gaugeGate;
      }
    });

    const { result } = renderHook(() => useMetricNames(METRIC_SOURCE), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual(['a']),
    );
    expect(result.current.isFetching).toBe(true);

    releaseGauge();
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });

  it('falls back to the exhaustive listing when the index cannot be read', async () => {
    streamDistinctIndexValues.mockImplementation(
      failingStream(
        'Cannot read the primary index: engine Log is not a MergeTree',
      ),
    );
    useGetMetricNames.mockReturnValue({
      ...IDLE_EXHAUSTIVE,
      data: { names: ['scanned.metric'], truncated: false },
    });

    const { result } = renderHook(() => useMetricNames(METRIC_SOURCE), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        'scanned.metric',
      ]),
    );
    // Enabled only after the index read failed.
    expect(useGetMetricNames).toHaveBeenCalledWith(
      expect.objectContaining({ namePattern: undefined }),
      expect.objectContaining({ enabled: true }),
    );
  });

  it('does not enable the exhaustive query while the index read is healthy', async () => {
    renderHook(() => useMetricNames(METRIC_SOURCE), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(streamDistinctIndexValues).toHaveBeenCalledTimes(4),
    );
    for (const [, options] of useGetMetricNames.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ enabled: false }));
    }
  });

  it('skips a kind the source has no table for', async () => {
    const { metricTables, ...rest } = METRIC_SOURCE;
    const sourceWithoutExpHistogram: TMetricSource = {
      ...rest,
      metricTables: {
        ...metricTables!,
        [MetricsDataType.ExponentialHistogram]: '',
      },
    };

    renderHook(() => useMetricNames(sourceWithoutExpHistogram), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(streamDistinctIndexValues).toHaveBeenCalledTimes(3),
    );
    expect(
      streamDistinctIndexValues.mock.calls.map(([args]) => args.tableName),
    ).not.toContain('otel_metrics_exponential_histogram');
  });

  it('holds the browse list while the first search query is in flight', async () => {
    streamDistinctIndexValues.mockImplementation(
      streamOf(['system.cpu.time', 'system.memory.usage']),
    );

    // Browse first so the stream populates the cache, then type — starting in
    // search mode would never run the stream at all.
    const { result, rerender } = renderHook(
      ({ pattern }: { pattern?: string }) =>
        useMetricNames(METRIC_SOURCE, undefined, pattern),
      { wrapper: createWrapper(), initialProps: {} as { pattern?: string } },
    );

    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        'system.cpu.time',
        'system.memory.usage',
      ]),
    );

    // First search for this pattern: nothing cached to offer while it runs.
    useGetMetricNames.mockReturnValue({ ...IDLE_EXHAUSTIVE, isFetching: true });
    rerender({ pattern: 'system' });

    expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
      'system.cpu.time',
      'system.memory.usage',
    ]);
    expect(result.current.isFetching).toBe(true);
  });

  it('ignores a stale page from the previous search pattern', async () => {
    streamDistinctIndexValues.mockImplementation(
      streamOf(['billing.invoice.total', 'system.cpu.time']),
    );

    const { result, rerender } = renderHook(
      ({ pattern }: { pattern?: string }) =>
        useMetricNames(METRIC_SOURCE, undefined, pattern),
      { wrapper: createWrapper(), initialProps: {} as { pattern?: string } },
    );
    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toHaveLength(2),
    );

    // The placeholder page holds the previous pattern's names, which cannot
    // match the new one — the browse list has to win.
    useGetMetricNames.mockReturnValue({
      ...IDLE_EXHAUSTIVE,
      data: { names: ['http.server.duration'], truncated: false },
      isPlaceholderData: true,
      isFetching: true,
    });
    rerender({ pattern: 'billing' });

    // The browse names must survive: a stale page alone cannot match the new
    // pattern, and the consumer's filter would reduce it to an empty picker.
    // Stale names may ride along — they simply never match the typed text.
    expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual(
      expect.arrayContaining(['billing.invoice.total', 'system.cpu.time']),
    );
  });

  it('keeps offering names when there is no browse list to hold', async () => {
    // A fallback deployment has no streamed list at all, so holding it would
    // hand back nothing and blank the picker on every search keystroke.
    streamDistinctIndexValues.mockImplementation(
      failingStream(
        'Cannot read the primary index: engine Log is not a MergeTree',
      ),
    );
    useGetMetricNames.mockReturnValue({
      ...IDLE_EXHAUSTIVE,
      data: { names: ['from.previous.page'], truncated: false },
    });

    const { result, rerender } = renderHook(
      ({ pattern }: { pattern?: string }) =>
        useMetricNames(METRIC_SOURCE, undefined, pattern),
      { wrapper: createWrapper(), initialProps: {} as { pattern?: string } },
    );
    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        'from.previous.page',
      ]),
    );

    // The new pattern's page is still in flight and only a placeholder exists.
    useGetMetricNames.mockReturnValue({
      ...IDLE_EXHAUSTIVE,
      data: { names: ['from.previous.page'], truncated: false },
      isPlaceholderData: true,
      isFetching: true,
    });
    rerender({ pattern: 'from' });

    expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
      'from.previous.page',
    ]);
  });

  it('replaces the held list once the search resolves', async () => {
    streamDistinctIndexValues.mockImplementation(streamOf(['stale.name']));

    const { result, rerender } = renderHook(
      ({ pattern }: { pattern?: string }) =>
        useMetricNames(METRIC_SOURCE, undefined, pattern),
      { wrapper: createWrapper(), initialProps: {} as { pattern?: string } },
    );
    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        'stale.name',
      ]),
    );

    useGetMetricNames.mockReturnValue({
      ...IDLE_EXHAUSTIVE,
      data: { names: ['system.authoritative'], truncated: false },
    });
    rerender({ pattern: 'system' });

    await waitFor(() =>
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        'system.authoritative',
      ]),
    );
  });

  it('switches to the exhaustive search once a pattern is given, and does not stream', async () => {
    useGetMetricNames.mockReturnValue({
      ...IDLE_EXHAUSTIVE,
      data: { names: ['up', 'node_uptime_seconds'], truncated: false },
    });

    const { result } = renderHook(
      () => useMetricNames(METRIC_SOURCE, undefined, 'up'),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      // SQL relevance order preserved, so the exact match stays first.
      expect(result.current.namesByKind[MetricsDataType.Gauge]).toEqual([
        'up',
        'node_uptime_seconds',
      ]),
    );
    expect(streamDistinctIndexValues).not.toHaveBeenCalled();
  });
});
