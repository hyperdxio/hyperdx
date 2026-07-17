import { __metricMappers } from '@/clickhouse/insert';
import { scenarioTables } from '@/clickhouse/schema';
import {
  bucketize,
  makeExponentialHistogram,
  makeGauge,
  makeHistogram,
  makeSum,
  makeSummary,
} from '@/generators/metrics';
import type { GaugeMetricRow, SumMetricRow } from '@/generators/types';
import { mulberry32 } from '@/rng/seeded';
import {
  collectScenario,
  type MetricBatch,
  type ScenarioBatch,
} from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');
const DATETIME_SEC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('scenarioTables metric names', () => {
  it('derives the five eval metric table names from the slug', () => {
    const t = scenarioTables('metric-saturation');
    expect(t.metricsGauge).toBe('eval_metric_saturation_otel_metrics_gauge');
    expect(t.metricsSum).toBe('eval_metric_saturation_otel_metrics_sum');
    expect(t.metricsHistogram).toBe(
      'eval_metric_saturation_otel_metrics_histogram',
    );
    expect(t.metricsExponentialHistogram).toBe(
      'eval_metric_saturation_otel_metrics_exponential_histogram',
    );
    expect(t.metricsSummary).toBe(
      'eval_metric_saturation_otel_metrics_summary',
    );
  });
});

describe('metric factories', () => {
  it('makeGauge fills defaults and injects service.name', () => {
    const g = makeGauge({
      timeUnixMs: NOW_MS,
      serviceName: 'checkout',
      metricName: 'queue.depth',
      value: 7,
    });
    expect(g.startTimeUnixMs).toBe(NOW_MS);
    expect(g.metricDescription).toBe('');
    expect(g.metricUnit).toBe('');
    expect(g.attributes).toEqual({});
    expect(g.resourceAttributes).toEqual({ 'service.name': 'checkout' });
    expect(g.value).toBe(7);
  });

  it('makeGauge merges caller resourceAttributes over the service.name default', () => {
    const g = makeGauge({
      timeUnixMs: NOW_MS,
      serviceName: 'checkout',
      metricName: 'queue.depth',
      value: 1,
      resourceAttributes: { 'k8s.namespace.name': 'prod' },
    });
    expect(g.resourceAttributes).toEqual({
      'service.name': 'checkout',
      'k8s.namespace.name': 'prod',
    });
  });

  it('makeSum defaults to cumulative + monotonic', () => {
    const s = makeSum({
      timeUnixMs: NOW_MS,
      serviceName: 'api',
      metricName: 'http.requests',
      value: 42,
    });
    expect(s.aggregationTemporality).toBe(2);
    expect(s.isMonotonic).toBe(true);
  });

  it('makeSum respects explicit temporality/monotonicity', () => {
    const s = makeSum({
      timeUnixMs: NOW_MS,
      serviceName: 'api',
      metricName: 'http.active',
      value: 3,
      aggregationTemporality: 1,
      isMonotonic: false,
    });
    expect(s.aggregationTemporality).toBe(1);
    expect(s.isMonotonic).toBe(false);
  });

  it('makeHistogram carries buckets and defaults temporality', () => {
    const h = makeHistogram({
      timeUnixMs: NOW_MS,
      serviceName: 'api',
      metricName: 'http.duration',
      count: 3,
      sum: 12,
      bucketCounts: [1, 1, 1],
      explicitBounds: [5, 10],
      min: 1,
      max: 9,
    });
    expect(h.aggregationTemporality).toBe(2);
    expect(h.bucketCounts).toEqual([1, 1, 1]);
    expect(h.explicitBounds).toEqual([5, 10]);
  });

  it('makeExponentialHistogram fills bucket defaults', () => {
    const e = makeExponentialHistogram({
      timeUnixMs: NOW_MS,
      serviceName: 'api',
      metricName: 'http.duration.exp',
      count: 10,
      sum: 100,
      scale: 3,
    });
    expect(e.zeroCount).toBe(0);
    expect(e.positiveOffset).toBe(0);
    expect(e.positiveBucketCounts).toEqual([]);
    expect(e.negativeOffset).toBe(0);
    expect(e.negativeBucketCounts).toEqual([]);
    expect(e.aggregationTemporality).toBe(2);
  });

  it('makeSummary carries quantiles', () => {
    const s = makeSummary({
      timeUnixMs: NOW_MS,
      serviceName: 'api',
      metricName: 'rpc.latency',
      count: 100,
      sum: 5000,
      quantiles: [
        { quantile: 0.5, value: 40 },
        { quantile: 0.99, value: 120 },
      ],
    });
    expect(s.quantiles).toHaveLength(2);
    expect(s.quantiles[1]).toEqual({ quantile: 0.99, value: 120 });
  });
});

describe('bucketize', () => {
  it('places samples into cumulative explicit buckets (+Inf overflow)', () => {
    const { bucketCounts, count, sum, min, max } = bucketize(
      [1, 4, 6, 9, 100],
      [5, 10],
    );
    // bounds [5,10] → 3 buckets: (<=5), (<=10), (+Inf)
    expect(bucketCounts).toEqual([2, 2, 1]);
    expect(count).toBe(5);
    expect(sum).toBe(120);
    expect(min).toBe(1);
    expect(max).toBe(100);
  });

  it('returns zeroed stats for an empty sample set', () => {
    const { bucketCounts, count, sum, min, max } = bucketize([], [5, 10]);
    expect(bucketCounts).toEqual([0, 0, 0]);
    expect(count).toBe(0);
    expect(sum).toBe(0);
    expect(min).toBe(0);
    expect(max).toBe(0);
  });
});

// A tiny deterministic metric generator used to exercise determinism,
// nowMs-anchoring, and collectScenario merging without a real scenario.
function* generateMetrics(
  rng: ReturnType<typeof mulberry32>,
  nowMs: number,
): Generator<ScenarioBatch, void, void> {
  const windowMs = 10 * 60 * 1000;
  const gauge: GaugeMetricRow[] = [];
  const sum: SumMetricRow[] = [];
  for (let i = 0; i < 20; i++) {
    const t = nowMs - Math.floor(rng.next() * windowMs);
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: 'svc',
        metricName: 'cpu.util',
        value: rng.range(0, 100),
        attributes: { pod: `pod-${rng.intRange(0, 5)}` },
      }),
    );
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: 'svc',
        metricName: 'req.total',
        value: rng.intRange(0, 1000),
      }),
    );
  }
  yield { traces: [], logs: [], metrics: { gauge, sum } };
}

describe('metric generation determinism + anchoring', () => {
  it('produces an identical metric stream for the same seed', () => {
    const a = collectScenario(generateMetrics(mulberry32(42), NOW_MS));
    const b = collectScenario(generateMetrics(mulberry32(42), NOW_MS));
    expect(a.metrics).toEqual(b.metrics);
  });

  it('anchors all points at or before nowMs, within the window', () => {
    const { metrics } = collectScenario(generateMetrics(mulberry32(7), NOW_MS));
    const all = [...(metrics?.gauge ?? []), ...(metrics?.sum ?? [])];
    expect(all.length).toBe(40);
    for (const m of all) {
      expect(m.timeUnixMs).toBeLessThanOrEqual(NOW_MS);
      expect(m.timeUnixMs).toBeGreaterThanOrEqual(NOW_MS - 10 * 60 * 1000);
    }
  });

  it('collectScenario merges per-type arrays across batches', () => {
    function* twoBatches(): Generator<ScenarioBatch, void, void> {
      const base: MetricBatch = {
        gauge: [
          makeGauge({
            timeUnixMs: NOW_MS,
            serviceName: 's',
            metricName: 'g',
            value: 1,
          }),
        ],
      };
      yield { traces: [], logs: [], metrics: base };
      yield {
        traces: [],
        logs: [],
        metrics: {
          summary: [
            makeSummary({
              timeUnixMs: NOW_MS,
              serviceName: 's',
              metricName: 'q',
              count: 1,
              sum: 1,
              quantiles: [{ quantile: 0.5, value: 1 }],
            }),
          ],
        },
      };
    }
    const { metrics } = collectScenario(twoBatches());
    expect(metrics?.gauge).toHaveLength(1);
    expect(metrics?.summary).toHaveLength(1);
    expect(metrics?.histogram).toEqual([]);
  });

  it('omits metrics entirely when no batch carries any', () => {
    function* noMetrics(): Generator<ScenarioBatch, void, void> {
      yield { traces: [], logs: [] };
    }
    const collected = collectScenario(noMetrics());
    expect(collected.metrics).toBeUndefined();
  });
});

describe('metric → ClickHouse row mappers', () => {
  it('gauge maps to a second-resolution DateTime + empty exemplars', () => {
    const row = __metricMappers.gauge(
      makeGauge({
        timeUnixMs: NOW_MS,
        serviceName: 'svc',
        metricName: 'cpu.util',
        value: 55.5,
        attributes: { pod: 'pod-1' },
      }),
    );
    expect(row.ServiceName).toBe('svc');
    expect(row.MetricName).toBe('cpu.util');
    expect(row.Value).toBe(55.5);
    expect(row.Flags).toBe(0);
    expect(row.Attributes).toEqual({ pod: 'pod-1' });
    expect(row.ResourceAttributes).toEqual({ 'service.name': 'svc' });
    expect(String(row.TimeUnix)).toMatch(DATETIME_SEC);
    expect(String(row.StartTimeUnix)).toMatch(DATETIME_SEC);
    expect(row.TimeUnix).toBe('2026-05-10 20:00:00');
    expect(row['Exemplars.TimeUnix']).toEqual([]);
    expect(row['Exemplars.Value']).toEqual([]);
    expect(row['Exemplars.FilteredAttributes']).toEqual([]);
  });

  it('sum maps counter columns', () => {
    const row = __metricMappers.sum(
      makeSum({
        timeUnixMs: NOW_MS,
        serviceName: 'svc',
        metricName: 'req.total',
        value: 10,
      }),
    );
    expect(row.Value).toBe(10);
    expect(row.AggregationTemporality).toBe(2);
    expect(row.IsMonotonic).toBe(true);
  });

  it('histogram maps UInt64 counts as strings and keeps bounds numeric', () => {
    const row = __metricMappers.histogram(
      makeHistogram({
        timeUnixMs: NOW_MS,
        serviceName: 'svc',
        metricName: 'http.duration',
        count: 3,
        sum: 12,
        bucketCounts: [2, 1, 0],
        explicitBounds: [5, 10],
        min: 1,
        max: 9,
      }),
    );
    expect(row.Count).toBe('3');
    expect(row.Sum).toBe(12);
    expect(row.BucketCounts).toEqual(['2', '1', '0']);
    expect(row.ExplicitBounds).toEqual([5, 10]);
    expect(row.Min).toBe(1);
    expect(row.Max).toBe(9);
    expect(row.AggregationTemporality).toBe(2);
  });

  it('exponential histogram maps positive/negative bucket arrays', () => {
    const row = __metricMappers.exponentialHistogram(
      makeExponentialHistogram({
        timeUnixMs: NOW_MS,
        serviceName: 'svc',
        metricName: 'http.duration.exp',
        count: 5,
        sum: 50,
        scale: 2,
        zeroCount: 1,
        positiveOffset: 3,
        positiveBucketCounts: [1, 2],
        negativeOffset: 0,
        negativeBucketCounts: [],
        min: 2,
        max: 20,
      }),
    );
    expect(row.Count).toBe('5');
    expect(row.Scale).toBe(2);
    expect(row.ZeroCount).toBe('1');
    expect(row.PositiveOffset).toBe(3);
    expect(row.PositiveBucketCounts).toEqual(['1', '2']);
    expect(row.NegativeBucketCounts).toEqual([]);
    expect(row.AggregationTemporality).toBe(2);
  });

  it('summary maps parallel quantile arrays', () => {
    const row = __metricMappers.summary(
      makeSummary({
        timeUnixMs: NOW_MS,
        serviceName: 'svc',
        metricName: 'rpc.latency',
        count: 100,
        sum: 5000,
        quantiles: [
          { quantile: 0.5, value: 40 },
          { quantile: 0.99, value: 120 },
        ],
      }),
    );
    expect(row.Count).toBe('100');
    expect(row.Sum).toBe(5000);
    expect(row['ValueAtQuantiles.Quantile']).toEqual([0.5, 0.99]);
    expect(row['ValueAtQuantiles.Value']).toEqual([40, 120]);
  });
});
