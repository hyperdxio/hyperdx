import { mulberry32 } from '@/rng/seeded';
import { segmentedRegressionScenario } from '@/scenarios/segmented-regression/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');
// 1% volume keeps the test cheap (~60K traces) while preserving the
// (tier, cache) cross-tab signal — distractors are still at fixed counts.
const TEST_VOLUME_FACTOR = 0.01;
const ANOMALY_WINDOW_MS = 10 * 60 * 1000;

function run(seed: number) {
  return collectScenario(
    segmentedRegressionScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: TEST_VOLUME_FACTOR,
    }),
  );
}

describe('segmented-regression scenario', () => {
  const result = run(42);

  it('produces ~60K api-server traces at 1% volume', () => {
    const apiTraces = result.traces.filter(t => t.serviceName === 'api-server');
    expect(apiTraces.length).toBeGreaterThan(50_000);
    expect(apiTraces.length).toBeLessThan(70_000);
  });

  it('plants exactly 220 recommendation-service distractor errors', () => {
    const rec = result.traces.filter(
      t => t.serviceName === 'recommendation-service',
    );
    expect(rec.length).toBe(220);
    for (const r of rec) {
      expect(r.statusCode).toBe('STATUS_CODE_ERROR');
      expect(r.statusMessage).toMatch(/upstream cf-feed unreachable/);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(b.logs.length).toBe(result.logs.length);
    expect(b.traces[0].spanId).toBe(result.traces[0].spanId);
    expect(b.traces[5000].spanId).toBe(result.traces[5000].spanId);
  });

  describe('the planted intersection bug — enterprise × cache.hit=false', () => {
    const anomalyStart = NOW_MS - ANOMALY_WINDOW_MS;
    const apiAnomaly = result.traces.filter(
      t => t.serviceName === 'api-server' && t.timestampMs >= anomalyStart,
    );
    const bySegment = (
      tier: string,
      hit: 'true' | 'false',
    ): { total: number; errors: number } => {
      const slice = apiAnomaly.filter(
        t =>
          t.spanAttributes['tenant.tier'] === tier &&
          t.spanAttributes['cache.hit'] === hit,
      );
      const errors = slice.filter(
        t => t.statusCode === 'STATUS_CODE_ERROR',
      ).length;
      return { total: slice.length, errors };
    };

    it('elevates error rate for enterprise × cache-miss to ~12% (16x baseline)', () => {
      const seg = bySegment('enterprise', 'false');
      expect(seg.total).toBeGreaterThan(100); // enough sample at 1% volume
      const rate = seg.errors / seg.total;
      expect(rate).toBeGreaterThan(0.05); // well above baseline
      expect(rate).toBeLessThan(0.2); // not so dominant it's obvious
    });

    it('leaves OTHER segments at the 0.5% baseline error rate', () => {
      for (const [tier, hit] of [
        ['enterprise', 'true'],
        ['pro', 'false'],
        ['pro', 'true'],
        ['free', 'false'],
        ['free', 'true'],
      ] as const) {
        const seg = bySegment(tier, hit);
        if (seg.total < 30) continue; // skip cells without enough sample
        const rate = seg.errors / seg.total;
        expect(rate).toBeLessThan(0.04); // close to baseline 0.5%
      }
    });

    it('uses the distinctive FallbackHandlerError body for the planted errors', () => {
      const fallbackErrors = apiAnomaly.filter(
        t =>
          t.spanAttributes['error.type'] === 'FallbackHandlerError' &&
          t.statusCode === 'STATUS_CODE_ERROR',
      );
      // Every fallback error must be enterprise × miss.
      for (const f of fallbackErrors) {
        expect(f.spanAttributes['tenant.tier']).toBe('enterprise');
        expect(f.spanAttributes['cache.hit']).toBe('false');
      }
      // Body has the schema-mismatch signature.
      expect(fallbackErrors[0].statusMessage).toMatch(
        /schema mismatch in enterprise_v2_response/,
      );
    });

    it('emits correlated ERROR logs for each fallback error (same traceId)', () => {
      const fallbackTraceIds = new Set(
        apiAnomaly
          .filter(
            t => t.spanAttributes['error.type'] === 'FallbackHandlerError',
          )
          .map(t => t.traceId),
      );
      const fallbackLogs = result.logs.filter(
        l => l.traceId && fallbackTraceIds.has(l.traceId),
      );
      // Every planted error must have a log row attached.
      expect(fallbackLogs.length).toBe(fallbackTraceIds.size);
      expect(fallbackLogs[0].body).toMatch(/schema mismatch/);
    });
  });

  it('single-axis aggregates dilute the signal vs the cross-tab', () => {
    const anomalyStart = NOW_MS - ANOMALY_WINDOW_MS;
    const apiAnomaly = result.traces.filter(
      t => t.serviceName === 'api-server' && t.timestampMs >= anomalyStart,
    );
    const rateBy = (
      predicate: (t: (typeof apiAnomaly)[number]) => boolean,
    ): number => {
      const slice = apiAnomaly.filter(predicate);
      if (slice.length === 0) return 0;
      return (
        slice.filter(t => t.statusCode === 'STATUS_CODE_ERROR').length /
        slice.length
      );
    };
    const enterpriseRate = rateBy(
      t => t.spanAttributes['tenant.tier'] === 'enterprise',
    );
    const cacheMissRate = rateBy(
      t => t.spanAttributes['cache.hit'] === 'false',
    );
    const intersectionRate = rateBy(
      t =>
        t.spanAttributes['tenant.tier'] === 'enterprise' &&
        t.spanAttributes['cache.hit'] === 'false',
    );
    // Each single-axis rate is materially lower than the cross-tab — proves
    // the agent has to combine them to find the actual signal.
    expect(intersectionRate).toBeGreaterThan(enterpriseRate * 1.5);
    expect(intersectionRate).toBeGreaterThan(cacheMissRate * 1.5);
  });
});
