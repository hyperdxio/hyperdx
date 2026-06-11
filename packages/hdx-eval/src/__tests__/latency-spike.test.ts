import { mulberry32 } from '../rng/seeded';
import { latencySpikeScenario } from '../scenarios/latency-spike/generate';
import { collectScenario } from '../scenarios/types';

const NOW_MS = Date.parse('2026-05-08T12:00:00.000Z');
// Tests run at 1% volume to keep memory tractable (full v5 ≈ 6M base
// traces / ~12M+ spans). Pattern shares scale linearly so structural
// invariants still hold at 1%.
const TEST_VOLUME_FACTOR = 0.01;

function run(seed: number) {
  return collectScenario(
    latencySpikeScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: TEST_VOLUME_FACTOR,
    }),
  );
}

function nsToMs(ns: number): number {
  return ns / 1_000_000;
}

describe('latency-spike scenario', () => {
  const result = run(42);

  it('produces high-volume trace data at 1% (~60K planted + ~40K background = ~200K spans)', () => {
    // Full v6: 6M planted × ~2 spans + 4M background × 2 spans + extras
    // → ~20M+ spans. At 1%: ~120K + ~80K + extras → ~200-215K spans.
    expect(result.traces.length).toBeGreaterThan(195_000);
    expect(result.traces.length).toBeLessThan(220_000);
  });

  it('uses 12 api-server endpoints and 5 regions', () => {
    const sample = result.traces
      .filter(t => t.serviceName === 'api-server')
      .slice(0, 5000);
    const endpoints = new Set(sample.map(t => t.spanName));
    const regions = new Set(sample.map(t => t.spanAttributes['cloud.region']));
    expect(endpoints.size).toBe(12);
    expect(regions.size).toBe(5);
    const tenantIds = new Set(sample.map(t => t.spanAttributes['tenant.id']));
    expect(tenantIds.size).toBeGreaterThan(2000);
  });

  it('plants production-shaped (ServiceName, SpanName) cardinality', () => {
    // Background traffic should produce hundreds of distinct
    // (Service, SpanName) combinations so naive
    // `GROUP BY ServiceName, SpanName` returns too many rows to scan.
    const combos = new Set(
      result.traces.map(t => `${t.serviceName}::${t.spanName}`),
    );
    expect(combos.size).toBeGreaterThan(800);
    // Background should yield at least 80 distinct service names beyond
    // the 4-service planted/decoy pool.
    const services = new Set(result.traces.map(t => t.serviceName));
    expect(services.size).toBeGreaterThan(80);
  });

  it('is deterministic for a fixed seed and now', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(result.traces[0].spanId).toBe(b.traces[0].spanId);
    expect(result.traces[10_000].spanId).toBe(b.traces[10_000].spanId);
  });

  it('produces enterprise spans in the anomaly window with ~80% slow / ~20% cache-hit', () => {
    const anomalyStart = NOW_MS - 10 * 60 * 1000;
    const enterpriseInWindow = result.traces.filter(
      t =>
        t.spanName === 'GET /api/orders/search' &&
        t.timestampMs >= anomalyStart &&
        t.spanAttributes['tenant.tier'] === 'enterprise',
    );
    expect(enterpriseInWindow.length).toBeGreaterThan(20);
    const slow = enterpriseInWindow.filter(t => nsToMs(t.durationNs) >= 1500);
    const fast = enterpriseInWindow.filter(t => nsToMs(t.durationNs) < 100);
    const slowFraction = slow.length / enterpriseInWindow.length;
    expect(slowFraction).toBeGreaterThan(0.65);
    expect(slowFraction).toBeLessThan(0.95);
    expect(fast.length).toBeGreaterThan(0); // cache-hit subset exists
  });

  it('keeps enterprise traffic on /api/orders/search fast outside the anomaly window', () => {
    const anomalyStart = NOW_MS - 10 * 60 * 1000;
    const enterprisePreAnomaly = result.traces.filter(
      t =>
        t.spanName === 'GET /api/orders/search' &&
        t.timestampMs < anomalyStart &&
        t.spanAttributes['tenant.tier'] === 'enterprise' &&
        // Exclude distractors that legitimately add latency
        !t.spanAttributes['runtime.event'],
    );
    if (enterprisePreAnomaly.length > 50) {
      const tail = enterprisePreAnomaly
        .map(t => nsToMs(t.durationNs))
        .sort((a, b) => b - a)[0];
      expect(tail).toBeLessThan(1500);
    }
  });

  it('plants GC-pause distractors uniformly across tiers (not enterprise-concentrated)', () => {
    const gcPauses = result.traces.filter(
      t => t.spanAttributes['runtime.event'] === 'gc_pause',
    );
    expect(gcPauses.length).toBeGreaterThan(50);
    const enterprisePauseFraction =
      gcPauses.filter(t => t.spanAttributes['tenant.tier'] === 'enterprise')
        .length / gcPauses.length;
    // Enterprise tier weight is 5%; GC pauses should match that distribution.
    expect(enterprisePauseFraction).toBeLessThan(0.15);
  });

  it('plants cold-start distractors only at the start of the hour', () => {
    const coldStarts = result.traces.filter(
      t => t.spanAttributes['runtime.event'] === 'cold_start',
    );
    expect(coldStarts.length).toBeGreaterThan(20);
    const inLast10Min = coldStarts.filter(
      t => t.timestampMs >= NOW_MS - 10 * 60 * 1000,
    );
    expect(inLast10Min.length).toBe(0);
  });

  it('emits cache.lookup distractor spans on a fraction of traces', () => {
    const cacheLookups = result.traces.filter(
      t => t.spanName === 'cache.lookup',
    );
    expect(cacheLookups.length).toBeGreaterThan(500);
  });

  it('includes GET /api/orders/search among the endpoints', () => {
    const endpoints = new Set(
      result.traces
        .filter(t => t.serviceName === 'api-server')
        .map(t => t.spanName),
    );
    expect(endpoints.has('GET /api/orders/search')).toBe(true);
  });

  it('every parent span has a child query (db or elasticsearch) with the same TraceId', () => {
    const parents = result.traces.filter(t => t.serviceName === 'api-server');
    const childTraceIds = new Set(
      result.traces
        .filter(
          t =>
            t.spanName === 'database.query' ||
            t.spanName === 'elasticsearch.query',
        )
        .map(t => t.traceId),
    );
    let missing = 0;
    for (let i = 0; i < parents.length; i += Math.ceil(parents.length / 1000)) {
      if (!childTraceIds.has(parents[i].traceId)) missing++;
    }
    expect(missing).toBe(0);
  });

  it('plants concurrent products/search hot-shard slowness in same window, all tiers', () => {
    const anomalyStart = NOW_MS - 10 * 60 * 1000;
    const productsHotShard = result.traces.filter(
      t =>
        t.spanName === 'elasticsearch.query' &&
        t.spanAttributes['elasticsearch.shard.hot'] === 'true' &&
        t.timestampMs >= anomalyStart,
    );
    expect(productsHotShard.length).toBeGreaterThan(50);
    // Affects all tiers — collect tiers via parent traceId
    const productsHotTraceIds = new Set(productsHotShard.map(t => t.traceId));
    const parents = result.traces.filter(
      t =>
        t.spanName === 'GET /api/products/search' &&
        productsHotTraceIds.has(t.traceId),
    );
    const tiers = new Set(parents.map(t => t.spanAttributes['tenant.tier']));
    expect(tiers.size).toBeGreaterThanOrEqual(2);
  });

  it('feature_flag.experiment_a is correlated with enterprise but also enabled on free/pro', () => {
    const sample = result.traces
      .filter(t => t.serviceName === 'api-server')
      .slice(0, 5000);
    const enterprise = sample.filter(
      t => t.spanAttributes['tenant.tier'] === 'enterprise',
    );
    const free = sample.filter(t => t.spanAttributes['tenant.tier'] === 'free');
    const enterpriseOnRate =
      enterprise.filter(
        t => t.spanAttributes['feature_flag.experiment_a'] === 'enabled',
      ).length / Math.max(enterprise.length, 1);
    const freeOnRate =
      free.filter(
        t => t.spanAttributes['feature_flag.experiment_a'] === 'enabled',
      ).length / Math.max(free.length, 1);
    expect(enterpriseOnRate).toBeGreaterThan(0.6);
    expect(freeOnRate).toBeGreaterThan(0.15);
    expect(freeOnRate).toBeLessThan(0.5); // confounder, not perfectly correlated
  });
});
