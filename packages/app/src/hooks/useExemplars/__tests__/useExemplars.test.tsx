/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { EXEMPLAR_QUERY_LIMIT } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  Exemplar,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { prometheusApi } from '@/api';
import { useClickhouseClient } from '@/clickhouse';
import {
  capExemplarsPerBucket,
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
    expect(normalizePrometheusExemplars(undefined).exemplars).toEqual([]);
    expect(normalizePrometheusExemplars([]).exemplars).toEqual([]);
  });

  it('maps trace/span ids, value, and seconds→ms timestamp', () => {
    const { exemplars: result } = normalizePrometheusExemplars([
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
    const {
      exemplars: [ex],
    } = normalizePrometheusExemplars([
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

  it('merges the per-`le` entries a histogram query returns', () => {
    // /query_exemplars reports one entry per underlying series, so a
    // histogram_quantile chart — a single plotted line — comes back split
    // across its bucket series. Those are the same series to the overlay.
    const histogramBuckets = [
      {
        seriesLabels: { __name__: 'http_latency_bucket', le: '0.1' },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '0.09', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: { __name__: 'http_latency_bucket', le: '0.5' },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '0.4', timestamp: 1700000001 },
        ],
      },
    ];
    const { exemplars: result } = normalizePrometheusExemplars(
      histogramBuckets,
      'histogram_quantile(0.99, rate(http_latency_bucket[5m]))',
    );
    expect(result.map(e => e.traceId)).toEqual(['a', 'b']);
    expect(result.every(e => e.groupKey === undefined)).toBe(true);
  });

  it('keeps `le` significant when the expression does not collapse buckets', () => {
    // `rate(x_bucket[5m])` genuinely draws one line per bucket, so merging the
    // entries would plot markers that belong to no drawn line.
    const perBucketLines = [
      {
        seriesLabels: { __name__: 'http_latency_bucket', le: '0.1' },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '0.09', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: { __name__: 'http_latency_bucket', le: '0.5' },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '0.4', timestamp: 1700000001 },
        ],
      },
    ];
    expect(
      normalizePrometheusExemplars(
        perBucketLines,
        'rate(http_latency_bucket[5m])',
      ),
    ).toEqual({ exemplars: [], dropped: 'multiple-series' });
  });

  it('drops the overlay when entries span different metrics', () => {
    // Both entries carry no labels beyond __name__, so a label-only identity
    // would collapse them to one series and plot markers from an unrelated
    // metric against the drawn line.
    const twoMetrics = [
      {
        seriesLabels: { __name__: 'foo' },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '1', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: { __name__: 'bar' },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '2', timestamp: 1700000001 },
        ],
      },
    ];
    expect(normalizePrometheusExemplars(twoMetrics)).toEqual({
      exemplars: [],
      dropped: 'multiple-series',
    });
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
    expect(normalizePrometheusExemplars(multiSeries)).toEqual({
      exemplars: [],
      dropped: 'multiple-series',
    });
  });

  it('skips exemplars without a trace id', () => {
    expect(
      normalizePrometheusExemplars([
        {
          seriesLabels: {},
          exemplars: [{ labels: { foo: 'bar' }, value: '1', timestamp: 1 }],
        },
      ]).exemplars,
    ).toEqual([]);
  });

  // The canonical latency query. /query_exemplars resolves the raw selector, so
  // it returns one entry per scrape target *and* per `le` bucket, while the chart
  // draws a single aggregated line. Keying the single-series guard on the full
  // selector label set therefore emptied the overlay on any metric scraped from
  // more than one instance — i.e. essentially always.
  it('merges entries that differ only by labels the aggregation drops', () => {
    const acrossInstances = [
      {
        seriesLabels: {
          __name__: 'http_latency_bucket',
          le: '0.1',
          instance: 'pod-a',
        },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '0.09', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: {
          __name__: 'http_latency_bucket',
          le: '0.5',
          instance: 'pod-b',
        },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '0.4', timestamp: 1700000001 },
        ],
      },
    ];
    const { exemplars, dropped } = normalizePrometheusExemplars(
      acrossInstances,
      'histogram_quantile(0.95, sum(rate(http_latency_bucket[5m])) by (le))',
    );
    expect(dropped).toBeUndefined();
    expect(exemplars.map(e => e.traceId)).toEqual(['a', 'b']);
    // `le` is collapsed by histogram_quantile and `instance` by the `by (le)`,
    // so nothing distinguishes the plotted line.
    expect(exemplars.every(e => e.groupKey === undefined)).toBe(true);
  });

  it('still drops the overlay for labels the aggregation keeps', () => {
    // `by (le, service)` draws one line per service, so these are genuinely two
    // plotted series and their markers can't be attributed.
    const twoServices = [
      {
        seriesLabels: {
          __name__: 'http_latency_bucket',
          le: '0.1',
          service: 'api',
          instance: 'pod-a',
        },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '0.09', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: {
          __name__: 'http_latency_bucket',
          le: '0.1',
          service: 'web',
          instance: 'pod-b',
        },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '0.4', timestamp: 1700000001 },
        ],
      },
    ];
    expect(
      normalizePrometheusExemplars(
        twoServices,
        'histogram_quantile(0.95, sum(rate(http_latency_bucket[5m])) by (le, service))',
      ),
    ).toEqual({ exemplars: [], dropped: 'multiple-series' });
  });

  it('merges entries under a `without` aggregation too', () => {
    // The `without` spelling of the same canonical query. This previously fell
    // through to "every label distinguishes a line" and dropped the whole overlay
    // — the exact bug the `by (...)` handling was written to fix.
    const acrossInstances = [
      {
        seriesLabels: {
          __name__: 'http_latency_bucket',
          le: '0.1',
          instance: 'pod-a',
        },
        exemplars: [
          { labels: { trace_id: 'a' }, value: '0.09', timestamp: 1700000000 },
        ],
      },
      {
        seriesLabels: {
          __name__: 'http_latency_bucket',
          le: '0.5',
          instance: 'pod-b',
        },
        exemplars: [
          { labels: { trace_id: 'b' }, value: '0.4', timestamp: 1700000001 },
        ],
      },
    ];
    const { exemplars, dropped } = normalizePrometheusExemplars(
      acrossInstances,
      'histogram_quantile(0.95, sum(rate(http_latency_bucket[5m])) without (instance))',
    );
    expect(dropped).toBeUndefined();
    expect(exemplars.map(e => e.traceId)).toEqual(['a', 'b']);
  });

  it('treats `histogram_quantile (` with a space as collapsing buckets', () => {
    // isPromqlExemplarEligible allows whitespace before the paren, so a literal
    // substring test here disagreed with it about one expression: the toggle
    // allowed it, `le` stayed in the group key, and the overlay came back
    // suppressed telling the user to aggregate to a single line they already had.
    const { exemplars, dropped } = normalizePrometheusExemplars(
      [
        {
          seriesLabels: { __name__: 'http_latency_bucket', le: '0.1' },
          exemplars: [
            { labels: { trace_id: 'a' }, value: '0.09', timestamp: 1700000000 },
          ],
        },
        {
          seriesLabels: { __name__: 'http_latency_bucket', le: '0.5' },
          exemplars: [
            { labels: { trace_id: 'b' }, value: '0.4', timestamp: 1700000001 },
          ],
        },
      ],
      'histogram_quantile (0.95, sum(rate(http_latency_bucket[5m])) by (le))',
    );
    expect(dropped).toBeUndefined();
    expect(exemplars.map(e => e.traceId)).toEqual(['a', 'b']);
  });

  it('rejects exemplars whose value or timestamp is not finite', () => {
    // ExemplarSchema is `.finite()` on both: a NaN timestamp collapses every
    // affected exemplar into one bucket and emits a NaN SVG coordinate.
    const { exemplars } = normalizePrometheusExemplars([
      {
        seriesLabels: { __name__: 'http_latency' },
        exemplars: [
          { labels: { trace_id: 'ok' }, value: '1', timestamp: 1700000000 },
          {
            labels: { trace_id: 'bad-value' },
            value: 'not-a-number',
            timestamp: 1700000000,
          },
          {
            labels: { trace_id: 'bad-ts' },
            value: '1',
            timestamp: Number.POSITIVE_INFINITY,
          },
        ],
      },
    ]);
    expect(exemplars.map(e => e.traceId)).toEqual(['ok']);
  });
});

describe('capExemplarsPerBucket', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-01T01:00:00Z');
  const at = (offsetMs: number, value: number): Exemplar => ({
    timestamp: start.getTime() + offsetMs,
    value,
    traceId: `t-${offsetMs}-${value}`,
  });

  // The regression this guards: an inclusive range put a timestamp exactly on
  // `end` one bucket past the last, giving 201 buckets. perBucket floored to 1,
  // the total exceeded the budget, and the trailing slice trimmed a time-sorted
  // list — so the exemplar it dropped was the newest, at the chart's right edge.
  it('keeps the newest exemplar when the range is inclusive', () => {
    const rangeMs = end.getTime() - start.getTime();
    const many: Exemplar[] = [];
    for (let i = 0; i <= EXEMPLAR_QUERY_LIMIT; i++) {
      many.push(at(Math.round((i * rangeMs) / EXEMPLAR_QUERY_LIMIT), i));
    }
    const newest = many[many.length - 1];
    const capped = capExemplarsPerBucket(many, start, end);

    expect(capped.length).toBeLessThanOrEqual(EXEMPLAR_QUERY_LIMIT);
    expect(capped.map(e => e.traceId)).toContain(newest.traceId);
    // And the result is still chronological for the render layer.
    expect(capped.map(e => e.timestamp)).toEqual(
      [...capped.map(e => e.timestamp)].sort((a, b) => a - b),
    );
  });

  it('returns the set untouched when it is already within the limit', () => {
    const few = [at(0, 1), at(1000, 2)];
    expect(capExemplarsPerBucket(few, start, end)).toBe(few);
  });

  it('keeps the peak of each bucket rather than a value-blind stride', () => {
    // One slow trace early on, buried among many fast ones. A uniform index
    // stride would drop it with ~98% probability; it is the whole reason the
    // overlay exists.
    const spanMs = end.getTime() - start.getTime();
    const many = Array.from({ length: EXEMPLAR_QUERY_LIMIT * 5 }, (_, i) =>
      at((i * spanMs) / (EXEMPLAR_QUERY_LIMIT * 5), i === 7 ? 9999 : 1),
    );
    const capped = capExemplarsPerBucket(many, start, end);
    expect(capped.length).toBeLessThanOrEqual(EXEMPLAR_QUERY_LIMIT);
    expect(capped.some(ex => ex.value === 9999)).toBe(true);
    // Still chronological and still spanning the range.
    expect(capped.map(ex => ex.timestamp)).toEqual(
      [...capped.map(ex => ex.timestamp)].sort((a, b) => a - b),
    );
    expect(capped[capped.length - 1].timestamp).toBeGreaterThan(
      start.getTime() + spanMs * 0.75,
    );
  });

  it('falls back to the highest values when the range is degenerate', () => {
    const many = Array.from({ length: EXEMPLAR_QUERY_LIMIT + 10 }, (_, i) =>
      at(0, i),
    );
    const capped = capExemplarsPerBucket(many, start, start);
    expect(capped).toHaveLength(EXEMPLAR_QUERY_LIMIT);
    expect(Math.min(...capped.map(ex => ex.value))).toBe(10);
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
    // These assert that NO query is issued. A synchronous assertion on the first
    // render proves nothing: `exemplars` is [] because data is undefined, and the
    // fetch sits behind an await either way — the whole block passed with the
    // `enabled` gate hardcoded to true. So every case now flushes the microtask
    // queue first, and a control case proves the harness does fetch when it should.
    const flush = () => act(async () => {});

    const renderGated = async (
      config: Parameters<typeof useExemplars>[0],
      source: Parameters<typeof useExemplars>[1],
    ) => {
      const rendered = renderHook(() => useExemplars(config, source), {
        wrapper,
      });
      await flush();
      return rendered;
    };

    it('fetches when nothing gates it (control for the cases below)', async () => {
      const { result } = await renderGated(histogramConfig, metricSource);
      expect(mockQuery).toHaveBeenCalled();
      expect(result.current.exemplars).toEqual([]);
    });

    it('does not fetch when the chart has not opted in', async () => {
      await renderGated(
        { ...histogramConfig, enableExemplars: undefined },
        metricSource,
      );
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockQueryExemplars).not.toHaveBeenCalled();
    });

    it('does not fetch while the deployment feature flag is off', async () => {
      isExemplarsEnabled = false;
      await renderGated(histogramConfig, metricSource);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockQueryExemplars).not.toHaveBeenCalled();
    });

    it('does not fetch for source kinds that cannot produce exemplars', async () => {
      await renderGated(histogramConfig, {
        kind: SourceKind.Log,
      } as TSource);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockQueryExemplars).not.toHaveBeenCalled();
    });

    it('does not fetch without a source', async () => {
      await renderGated(histogramConfig, undefined);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockQueryExemplars).not.toHaveBeenCalled();
    });

    it('does not fetch for a PromQL expression that plots no duration', async () => {
      // promqlEligible was only ever fed an eligible expression, so the guard that
      // stops duration markers landing on a requests/sec axis went unexercised.
      await renderGated(
        {
          ...promqlConfig,
          promqlExpression: 'rate(http_requests_total[5m])',
        } as typeof promqlConfig,
        promqlSource,
      );
      expect(mockQueryExemplars).not.toHaveBeenCalled();
    });

    it('drops the overlay when the chart draws more than one series', async () => {
      // The rendered series count comes from the main query, not the exemplar
      // payload — a multi-line chart must not get markers of unknown provenance.
      // Must wait for real data: asserting [] before the query settles is true
      // whatever the count is, which is how the first version of this test
      // certified nothing.
      mockQuery.mockResolvedValue({
        json: async () => ({
          data: [{ timestamp: '1700000000000', value: '1', traceId: 'a' }],
        }),
      });

      const single = renderHook(
        () => useExemplars(histogramConfig, metricSource, 1),
        { wrapper },
      );
      await waitFor(() =>
        expect(single.result.current.exemplars).toHaveLength(1),
      );

      const many = renderHook(
        () => useExemplars(histogramConfig, metricSource, 3),
        { wrapper },
      );
      await waitFor(() => expect(many.result.current.isLoading).toBe(false));
      expect(many.result.current.exemplars).toEqual([]);
      expect(many.result.current.dropped).toBe('multiple-series');
    });
  });

  // placeholderData is scoped to the same chart on purpose: TanStack keeps its
  // last-defined data on the observer, which outlives a key change, so an
  // unscoped `prev => prev` hands the PREVIOUS metric's exemplars — real,
  // clickable trace ids — to the new chart while isLoading and isError both say
  // settled. Nothing exercised that comparison, so its removal was silent.
  describe('placeholder scoping across key changes', () => {
    const rows = (traceId: string) => ({
      json: async () => ({
        data: [{ timestamp: '1700000000000', value: '1', traceId }],
      }),
    });

    it('keeps the overlay across a range-only change', async () => {
      mockQuery.mockResolvedValue(rows('from-first-range'));
      const { result, rerender } = renderHook(
        ({ config }) => useExemplars(config, metricSource),
        { wrapper, initialProps: { config: histogramConfig } },
      );
      await waitFor(() => expect(result.current.exemplars).toHaveLength(1));

      // Same chart, later window: the markers should survive the refetch.
      mockQuery.mockImplementation(() => new Promise(() => {}));
      rerender({
        config: {
          ...histogramConfig,
          dateRange: [
            new Date('2025-02-12T01:00:00Z'),
            new Date('2025-02-12T02:00:00Z'),
          ],
        } as typeof histogramConfig,
      });
      expect(result.current.exemplars).toHaveLength(1);
    });

    it('blanks the overlay when the chart itself changes', async () => {
      mockQuery.mockResolvedValue(rows('from-first-metric'));
      const { result, rerender } = renderHook(
        ({ config }) => useExemplars(config, metricSource),
        { wrapper, initialProps: { config: histogramConfig } },
      );
      await waitFor(() => expect(result.current.exemplars).toHaveLength(1));

      // A different chart (its filter changed, so it plots different data): the
      // previous chart's traces must not be shown here.
      mockQuery.mockImplementation(() => new Promise(() => {}));
      rerender({
        config: {
          ...histogramConfig,
          where: "ServiceName = 'a-different-service'",
        },
      });
      expect(result.current.exemplars).toEqual([]);
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
    it('caps the result at EXEMPLAR_QUERY_LIMIT, thinning evenly across time', async () => {
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
      // Chronological and spanning the range — a value-ranked cap over the
      // whole set would keep only the slowest traces and leave most of the
      // range bare — while still keeping the peak within each bucket, which a
      // uniform index stride would discard.
      const timestamps = result.current.exemplars.map(ex => ex.timestamp);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
      // Markers survive at both ends of the response, so neither the start nor
      // the tail of the range is left bare.
      const start = 1700000000 * 1000;
      const inputSpan = (EXEMPLAR_QUERY_LIMIT + 49) * 1000;
      expect(timestamps[0]).toBeLessThan(start + inputSpan * 0.25);
      expect(timestamps[timestamps.length - 1]).toBeGreaterThan(
        start + inputSpan * 0.75,
      );
      // The single slowest exemplar survives the cap.
      const slowest = EXEMPLAR_QUERY_LIMIT + 49;
      expect(result.current.exemplars.some(ex => ex.value === slowest)).toBe(
        true,
      );
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
