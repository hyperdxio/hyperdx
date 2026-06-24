import { mulberry32 } from '@/rng/seeded';
import { errorRootCauseScenario } from '@/scenarios/error-root-cause/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-08T12:00:00.000Z');
// Tests run at 1% volume (full v5 ≈ 6M base traces / 12M logs).
// Pattern shares scale linearly; planted anomaly + distractors stay fixed.
const TEST_VOLUME_FACTOR = 0.01;

function run(seed: number) {
  return collectScenario(
    errorRootCauseScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: TEST_VOLUME_FACTOR,
    }),
  );
}

describe('error-root-cause scenario', () => {
  // Generate once per run() to avoid 5x cost across tests.
  const result = run(42);

  it('produces high-volume background + distractors + anomaly at 1%', () => {
    // Full v5: 6M base × ~1.6 spans + distractors → ~9.6M+ spans.
    // At 1%: 60K × ~1.6 + ~465 distractors → ~96K traces.
    expect(result.traces.length).toBeGreaterThan(90_000);
    expect(result.traces.length).toBeLessThan(110_000);
  });

  it('produces ~120K templated background logs at 1% (12M at full scale)', () => {
    expect(result.logs.length).toBeGreaterThanOrEqual(100_000);
    expect(result.logs.length).toBeLessThanOrEqual(140_000);
  });

  it('uses 25 services (high cardinality)', () => {
    const services = new Set(result.traces.map(t => t.serviceName));
    expect(services.size).toBeGreaterThanOrEqual(20);
  });

  it('attaches region and tenant.id attributes to background traces', () => {
    const sample = result.traces.slice(0, 1000);
    const withRegion = sample.filter(t => t.spanAttributes['cloud.region']);
    expect(withRegion.length).toBeGreaterThan(500);
    const regions = new Set(
      sample.map(t => t.spanAttributes['cloud.region']).filter(Boolean),
    );
    expect(regions.size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for a fixed seed and now', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(b.logs.length).toBe(result.logs.length);
    // Cheap structural check — sampling spans by index for byte-equality is too slow at 100x volume.
    expect(result.traces[0].spanId).toBe(b.traces[0].spanId);
    expect(result.traces[1000].spanId).toBe(b.traces[1000].spanId);
    expect(result.logs[5000].body).toBe(b.logs[5000].body);
  });

  it('plants exactly 8 payment-service db.payment.connect error spans in the anomaly window (small relative to decoy bursts)', () => {
    const anomalyStart = NOW_MS - 5 * 60 * 1000;
    const dbErrors = result.traces.filter(
      t =>
        t.serviceName === 'payment-service' &&
        t.spanName === 'db.payment.connect' &&
        t.statusCode === 'STATUS_CODE_ERROR' &&
        t.timestampMs >= anomalyStart,
    );
    expect(dbErrors.length).toBe(8);
  });

  it('uses 3 timeout message variants on the planted db.payment.connect spans', () => {
    const anomalyStart = NOW_MS - 5 * 60 * 1000;
    const dbErrors = result.traces.filter(
      t =>
        t.serviceName === 'payment-service' &&
        t.spanName === 'db.payment.connect' &&
        t.statusCode === 'STATUS_CODE_ERROR' &&
        t.timestampMs >= anomalyStart,
    );
    const variants = new Set(dbErrors.map(t => t.statusMessage));
    expect(variants.size).toBe(3);
    expect(
      [...variants].every(v => v.toLowerCase().includes('db-payment')),
    ).toBe(true);
  });

  it('propagates the error up to checkout-api root spans in the anomaly window', () => {
    const anomalyStart = NOW_MS - 5 * 60 * 1000;
    const checkoutErrors = result.traces.filter(
      t =>
        t.serviceName === 'checkout-api' &&
        t.spanName === 'POST /api/checkout' &&
        t.statusCode === 'STATUS_CODE_ERROR' &&
        t.timestampMs >= anomalyStart,
    );
    expect(checkoutErrors.length).toBe(8);
  });

  it('emits correlated payment-service error logs with the same TraceId', () => {
    const erroringTraceIds = new Set(
      result.traces
        .filter(
          t =>
            t.serviceName === 'payment-service' &&
            t.statusCode === 'STATUS_CODE_ERROR',
        )
        .map(t => t.traceId),
    );
    const correlated = result.logs.filter(
      l =>
        l.serviceName === 'payment-service' &&
        l.severityText === 'ERROR' &&
        l.body.includes('db-payment') &&
        l.traceId &&
        erroringTraceIds.has(l.traceId),
    );
    expect(correlated.length).toBe(8);
  });

  it('plants the api-gateway TLS distractor at T-25min (not in current incident window)', () => {
    const distractorStart = NOW_MS - 25 * 60 * 1000;
    const distractorEnd = distractorStart + 5 * 60 * 1000;
    const tls = result.traces.filter(
      t =>
        t.serviceName === 'api-gateway' &&
        t.spanAttributes['error.type'] === 'TLSHandshakeError' &&
        t.timestampMs >= distractorStart &&
        t.timestampMs <= distractorEnd,
    );
    expect(tls.length).toBeGreaterThanOrEqual(40);
    // Should NOT be in the current incident window (last 10 min)
    const recent = tls.filter(t => t.timestampMs >= NOW_MS - 10 * 60 * 1000);
    expect(recent.length).toBe(0);
  });

  it('plants the auth-service rate-limit distractor at T-40min (resolved before incident)', () => {
    const auth = result.traces.filter(
      t =>
        t.serviceName === 'auth-service' &&
        t.spanAttributes['error.type'] === 'RateLimitExceeded',
    );
    expect(auth.length).toBeGreaterThanOrEqual(15);
    const recent = auth.filter(t => t.timestampMs >= NOW_MS - 35 * 60 * 1000);
    expect(recent.length).toBe(0);
  });

  it('plants slow-but-OK search-service queries throughout the hour (not errors)', () => {
    const slowSearch = result.traces.filter(
      t =>
        t.serviceName === 'search-service' &&
        t.spanName === 'search.query' &&
        t.statusCode === 'STATUS_CODE_OK',
    );
    expect(slowSearch.length).toBeGreaterThanOrEqual(70);
  });

  it('keeps payment-service free of DB-cascade errors outside the anomaly window', () => {
    const anomalyStart = NOW_MS - 5 * 60 * 1000;
    const preAnomalyCascade = result.traces.filter(
      t =>
        t.serviceName === 'payment-service' &&
        t.spanName === 'db.payment.connect' &&
        t.timestampMs < anomalyStart,
    );
    expect(preAnomalyCascade.length).toBe(0);
  });

  it('plants 200 background payment.charge declines distributed across the hour (operational, not infra)', () => {
    const declines = result.traces.filter(
      t =>
        t.serviceName === 'payment-service' &&
        t.spanName === 'payment.charge' &&
        t.spanAttributes['error.type'] === 'PaymentDeclined',
    );
    expect(declines.length).toBe(200);
    const reasons = new Set(declines.map(t => t.statusMessage));
    expect(reasons.size).toBe(5);
  });

  it('plants 80 concurrent cdn origin-fetch errors in last 5 min, separate from checkout traces (dominates raw 5xx counts)', () => {
    const anomalyStart = NOW_MS - 5 * 60 * 1000;
    const cdn = result.traces.filter(
      t =>
        t.serviceName === 'cdn' &&
        t.spanAttributes['error.type'] === 'OriginUnreachableError' &&
        t.timestampMs >= anomalyStart,
    );
    expect(cdn.length).toBe(80);
    const checkoutCascadeTraceIds = new Set(
      result.traces
        .filter(
          t =>
            t.serviceName === 'checkout-api' &&
            t.statusCode === 'STATUS_CODE_ERROR' &&
            t.timestampMs >= anomalyStart,
        )
        .map(t => t.traceId),
    );
    const overlap = cdn.filter(t => checkoutCascadeTraceIds.has(t.traceId));
    expect(overlap.length).toBe(0);
  });

  it('plants 25 concurrent notification-service smtp errors in last 5 min, separate from checkout traces', () => {
    const anomalyStart = NOW_MS - 5 * 60 * 1000;
    const smtp = result.traces.filter(
      t =>
        t.serviceName === 'notification-service' &&
        t.spanAttributes['error.type'] === 'SMTPConnectionError' &&
        t.timestampMs >= anomalyStart,
    );
    expect(smtp.length).toBe(25);
    // None of these should share traceids with the planted checkout cascade.
    const checkoutCascadeTraceIds = new Set(
      result.traces
        .filter(
          t =>
            t.serviceName === 'checkout-api' &&
            t.statusCode === 'STATUS_CODE_ERROR' &&
            t.timestampMs >= anomalyStart,
        )
        .map(t => t.traceId),
    );
    const overlap = smtp.filter(t => checkoutCascadeTraceIds.has(t.traceId));
    expect(overlap.length).toBe(0);
  });
});
