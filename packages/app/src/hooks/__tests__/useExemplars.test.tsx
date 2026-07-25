/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { EXEMPLAR_QUERY_LIMIT } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { prometheusApi } from '@/api';
import { useClickhouseClient } from '@/clickhouse';
import {
  normalizePrometheusExemplars,
  useExemplars,
} from '@/hooks/useExemplars';

// Flipped per-test to exercise the deployment feature gate. A getter (rather
// than a literal) so the hook reads the current value on each render.
let isExemplarsEnabled = true;
jest.mock('@/config', () => ({
  get IS_EXEMPLARS_ENABLED() {
    return isExemplarsEnabled;
  },
}));

jest.mock('@/api', () => ({
  __esModule: true,
  prometheusApi: { queryExemplars: jest.fn() },
}));

jest.mock('@/clickhouse', () => ({
  __esModule: true,
  useClickhouseClient: jest.fn(),
}));

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useMetadataWithSettings: jest.fn().mockReturnValue({
    getColumns: jest.fn().mockResolvedValue([]),
    getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
    getColumn: jest.fn().mockResolvedValue(undefined),
    getTableMetadata: jest.fn().mockResolvedValue({ primary_key: 'TimeUnix' }),
    getSkipIndices: jest.fn().mockResolvedValue([]),
    getSetting: jest.fn().mockResolvedValue(undefined),
    isClickHouseCloud: jest.fn().mockResolvedValue(false),
  }),
}));

jest.mock('@/source', () => ({
  __esModule: true,
  getDurationMsExpression: jest.fn().mockReturnValue('Duration / 1e6'),
}));

describe('normalizePrometheusExemplars', () => {
  it('returns [] for undefined/empty input', () => {
    expect(normalizePrometheusExemplars(undefined)).toEqual([]);
    expect(normalizePrometheusExemplars([])).toEqual([]);
  });

  it('maps trace/span ids, value, and seconds→ms timestamp', () => {
    const result = normalizePrometheusExemplars([
      {
        seriesLabels: { __name__: 'http_latency', service: 'api' },
        exemplars: [
          {
            labels: { trace_id: 'abc', span_id: 'def' },
            value: '1.5',
            timestamp: 1700000000,
          },
        ],
      },
    ]);
    expect(result).toEqual([
      {
        timestamp: 1700000000 * 1000,
        value: 1.5,
        traceId: 'abc',
        spanId: 'def',
        groupKey: 'service="api"',
      },
    ]);
  });

  it('accepts alternate label spellings (traceID/spanID)', () => {
    const [ex] = normalizePrometheusExemplars([
      {
        seriesLabels: {},
        exemplars: [
          {
            labels: { traceID: 'xyz', spanID: 's1' },
            value: '2',
            timestamp: 1,
          },
        ],
      },
    ]);
    expect(ex.traceId).toBe('xyz');
    expect(ex.spanId).toBe('s1');
    expect(ex.groupKey).toBeUndefined();
  });

  it('drops the overlay entirely when the query returns multiple series', () => {
    // Exemplars are single-series only; multi-series markers can't be attributed
    // or scaled meaningfully, so the whole set is dropped rather than rendered.
    const multiSeries = [
      {
        seriesLabels: { service: 'api' },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '1', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: { service: 'web' },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '2', timestamp: 1700000000 },
        ],
      },
    ];
    expect(normalizePrometheusExemplars(multiSeries)).toEqual([]);
  });

  it('skips exemplars without a trace id', () => {
    expect(
      normalizePrometheusExemplars([
        {
          seriesLabels: {},
          exemplars: [{ labels: { foo: 'bar' }, value: '1', timestamp: 1 }],
        },
      ]),
    ).toEqual([]);
  });
});

describe('useExemplars', () => {
  const mockQuery = jest.fn();
  const mockQueryExemplars = prometheusApi.queryExemplars as jest.Mock;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );

  const metricSource = { kind: SourceKind.Metric } as TSource;
  const promqlSource = { kind: SourceKind.Promql } as TSource;

  const histogramConfig = {
    displayType: DisplayType.Line,
    connection: 'test-connection',
    metricTables: {
      gauge: 'otel_metrics_gauge',
      histogram: 'otel_metrics_histogram',
      sum: 'otel_metrics_sum',
      summary: 'otel_metrics_summary',
      'exponential histogram': 'otel_metrics_exponential_histogram',
    },
    from: { databaseName: 'default', tableName: '' },
    select: [
      {
        aggFn: 'quantile',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: 'Value',
        level: 0.95,
        metricName: 'http.server.duration',
        metricType: MetricsDataType.Histogram,
      },
    ],
    where: '',
    whereLanguage: 'lucene',
    timestampValueExpression: 'TimeUnix',
    dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    granularity: '1 minute',
    enableExemplars: true,
  } as ChartConfigWithOptDateRange;

  const promqlConfig = {
    configType: 'promql',
    displayType: DisplayType.Line,
    connection: 'test-connection',
    promqlExpression: 'histogram_quantile(0.95, http_latency)',
    from: { databaseName: 'default', tableName: 'metrics' },
    select: '',
    where: '',
    dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    granularity: '1 minute',
    enableExemplars: true,
  } as unknown as ChartConfigWithOptDateRange;

  beforeAll(() => {
    // The stubbed metadata can't resolve column types, which the SQL renderer
    // warns about — expected here, and noisy.
    jest.spyOn(console, 'warn').mockImplementation(jest.fn());
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    isExemplarsEnabled = true;
    jest.clearAllMocks();
    (useClickhouseClient as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  describe('gating', () => {
    it('does not fetch when the chart has not opted in', async () => {
      const { result } = renderHook(
        () =>
          useExemplars(
            { ...histogramConfig, enableExemplars: undefined },
            metricSource,
          ),
        { wrapper },
      );
      expect(result.current.exemplars).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not fetch while the deployment feature flag is off', async () => {
      isExemplarsEnabled = false;
      const { result } = renderHook(
        () => useExemplars(histogramConfig, metricSource),
        { wrapper },
      );
      expect(result.current.exemplars).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not fetch for source kinds that cannot produce exemplars', async () => {
      const { result } = renderHook(
        () =>
          useExemplars(histogramConfig, { kind: SourceKind.Log } as TSource),
        { wrapper },
      );
      expect(result.current.exemplars).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not fetch without a source', async () => {
      const { result } = renderHook(
        () => useExemplars(histogramConfig, undefined),
        { wrapper },
      );
      expect(result.current.exemplars).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('metric source (ClickHouse)', () => {
    it('maps exemplar rows and drops rows without a trace id', async () => {
      mockQuery.mockResolvedValue({
        json: async () => ({
          data: [
            {
              timestamp: '1700000000000',
              value: '1.5',
              traceId: 'a',
              spanId: 's1',
            },
            // No trace id → nothing to link to, must be dropped.
            { timestamp: '1700000001000', value: '2.5', traceId: '' },
            { timestamp: '1700000002000', value: '3.5', traceId: 'b' },
          ],
        }),
      });

      const { result } = renderHook(
        () => useExemplars(histogramConfig, metricSource),
        { wrapper },
      );

      await waitFor(() => expect(result.current.exemplars).toHaveLength(2));
      expect(result.current.exemplars).toEqual([
        { timestamp: 1700000000000, value: 1.5, traceId: 'a', spanId: 's1' },
        {
          timestamp: 1700000002000,
          value: 3.5,
          traceId: 'b',
          spanId: undefined,
        },
      ]);
    });

    it('returns [] without querying when the config is not exemplar-eligible', async () => {
      // A Group By makes markers unattributable, so the renderer returns no SQL.
      const { result } = renderHook(
        () =>
          useExemplars(
            { ...histogramConfig, groupBy: 'ServiceName' },
            metricSource,
          ),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.exemplars).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('promql source', () => {
    it('caps the result at EXEMPLAR_QUERY_LIMIT, keeping the highest values', async () => {
      const exemplars = Array.from(
        { length: EXEMPLAR_QUERY_LIMIT + 50 },
        (_, i) => ({
          labels: { trace_id: `t${i}` },
          value: String(i),
          timestamp: 1700000000 + i,
        }),
      );
      mockQueryExemplars.mockResolvedValue({
        status: 'success',
        data: [{ seriesLabels: {}, exemplars }],
      });

      const { result } = renderHook(
        () => useExemplars(promqlConfig, promqlSource),
        { wrapper },
      );

      await waitFor(() =>
        expect(result.current.exemplars).toHaveLength(EXEMPLAR_QUERY_LIMIT),
      );
      // Highest value first, and the low-value tail is what got dropped.
      expect(result.current.exemplars[0].value).toBe(EXEMPLAR_QUERY_LIMIT + 49);
      expect(result.current.exemplars.every(ex => ex.value >= 50)).toBe(true);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('surfaces an error when the proxy reports a non-success status', async () => {
      mockQueryExemplars.mockResolvedValue({
        status: 'error',
        error: 'upstream exploded',
      });

      const { result } = renderHook(
        () => useExemplars(promqlConfig, promqlSource),
        { wrapper },
      );

      // The hook sets retry: 1, so allow for the retry's backoff delay.
      await waitFor(() => expect(result.current.isError).toBe(true), {
        timeout: 5000,
      });
      expect(result.current.exemplars).toEqual([]);
    });
  });
});
