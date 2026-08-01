import { mulberry32 } from '@/rng/seeded';
import { serviceHealthCheckScenario } from '@/scenarios/service-health-check/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');

// 1% volume keeps the test cheap (~120K traces, ~240K logs) while preserving
// the planted-signal invariants. The blip count (~250 errors / minute) is
// derived from baseline traffic density × 1% volume, so it stays
// proportional to TEST_VOLUME_FACTOR.
const TEST_VOLUME_FACTOR = 0.01;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const REPORT_START_MS = NOW_MS - ONE_HOUR_MS;
const BASELINE_START_MS = NOW_MS - FOUR_HOURS_MS;
const BLIP_START_MS = REPORT_START_MS + 3 * 60 * 1000;
const BLIP_END_MS = BLIP_START_MS + 60 * 1000;
const NEW_TEMPLATE_START_MS = NOW_MS - 70 * 60 * 1000;

function run(seed: number) {
  return collectScenario(
    serviceHealthCheckScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: TEST_VOLUME_FACTOR,
    }),
  );
}

describe('service-health-check scenario', () => {
  const result = run(42);
  const apiTraces = result.traces;
  const apiLogs = result.logs;

  it('produces traces and logs over the 4-hour window', () => {
    // 12M × 0.01 = 120K traces target; 24M × 0.01 = 240K logs.
    expect(apiTraces.length).toBeGreaterThan(100_000);
    expect(apiTraces.length).toBeLessThan(140_000);
    expect(apiLogs.length).toBeGreaterThan(220_000);
    expect(apiLogs.length).toBeLessThan(260_000);
    // All rows belong to api-server.
    expect(apiTraces.every(t => t.serviceName === 'api-server')).toBe(true);
    expect(apiLogs.every(l => l.serviceName === 'api-server')).toBe(true);
  });

  it('covers the full 4-hour window with the report window at the end', () => {
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const t of apiTraces) {
      if (t.timestampMs < minTs) minTs = t.timestampMs;
      if (t.timestampMs > maxTs) maxTs = t.timestampMs;
    }
    // First sample within 1 min of baseline start; last within 1 min of now.
    expect(minTs - BASELINE_START_MS).toBeLessThan(60_000);
    expect(NOW_MS - maxTs).toBeLessThan(60_000);
  });

  it('is deterministic for a fixed seed', () => {
    const b = run(42);
    expect(b.traces.length).toBe(apiTraces.length);
    expect(b.logs.length).toBe(apiLogs.length);
    expect(b.traces[100].spanId).toBe(apiTraces[100].spanId);
    expect(b.logs[100].body).toBe(apiLogs[100].body);
  });

  describe('baseline characteristics', () => {
    it('error rate is ~0.5% outside the blip window', () => {
      const nonBlip = apiTraces.filter(
        t => !(t.timestampMs >= BLIP_START_MS && t.timestampMs < BLIP_END_MS),
      );
      const errors = nonBlip.filter(
        t => t.statusCode === 'STATUS_CODE_ERROR',
      ).length;
      const rate = errors / nonBlip.length;
      expect(rate).toBeGreaterThan(0.002);
      expect(rate).toBeLessThan(0.008);
    });

    it('log Body cardinality is high — naive GROUP BY Body is useless', () => {
      // Sample 5K logs and check unique-body ratio. >= 90% unique means
      // GROUP BY Body returns ~1 row per log row, so the agent must use
      // hyperdx_log_patterns (Drain) to find templates.
      const sample = apiLogs.slice(0, 5000);
      const uniqueBodies = new Set(sample.map(l => l.body));
      expect(uniqueBodies.size / sample.length).toBeGreaterThan(0.9);
    });
  });

  describe('planted signal: new log template', () => {
    it('feature-flag template appears ONLY in the planted window (~last 70 min)', () => {
      const planted = apiLogs.filter(l =>
        /feature_flag\.new_recommendation_engine/.test(l.body),
      );
      expect(planted.length).toBeGreaterThan(0);
      // None in the baseline (the first 170 minutes of the dataset).
      const baselinePlanted = planted.filter(
        l => l.timestampMs < NEW_TEMPLATE_START_MS,
      );
      expect(baselinePlanted.length).toBe(0);
      // Approximately 0.1% of total log volume. At 1% volume that's ~240
      // logs; relax to a generous band to absorb sampling noise.
      expect(planted.length).toBeGreaterThan(50);
      expect(planted.length).toBeLessThan(600);
    });
  });

  describe('planted signal: v2 endpoint rollout', () => {
    it('GET /api/v2/products appears ONLY in the report window and ramps up', () => {
      const v2 = apiTraces.filter(t => t.spanName === 'GET /api/v2/products');
      expect(v2.length).toBeGreaterThan(0);
      // None in the baseline.
      const baselineV2 = v2.filter(t => t.timestampMs < REPORT_START_MS);
      expect(baselineV2.length).toBe(0);
      // Ramp check: more v2 in the second half of the report window than
      // the first half. (The ramp is linear so 2nd half should be ~3× 1st.)
      const halfMs = REPORT_START_MS + ONE_HOUR_MS / 2;
      const firstHalf = v2.filter(t => t.timestampMs < halfMs).length;
      const secondHalf = v2.filter(t => t.timestampMs >= halfMs).length;
      expect(secondHalf).toBeGreaterThan(firstHalf);
    });
  });

  describe('planted signal: latency drift', () => {
    it('p99 in the last 10 min of report > p99 in the first 10 min of report', () => {
      const firstMinMs = REPORT_START_MS;
      const firstMaxMs = REPORT_START_MS + 10 * 60 * 1000;
      const lastMinMs = NOW_MS - 10 * 60 * 1000;
      const firstSlice = apiTraces
        .filter(t => t.timestampMs >= firstMinMs && t.timestampMs < firstMaxMs)
        .map(t => t.durationNs / 1e6);
      const lastSlice = apiTraces
        .filter(t => t.timestampMs >= lastMinMs && t.timestampMs <= NOW_MS)
        .map(t => t.durationNs / 1e6);
      const p99 = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.99)] ?? 0;
      };
      const p99First = p99(firstSlice);
      const p99Last = p99(lastSlice);
      // Drift should be visible: last p99 > first p99. At low volume the
      // tail is noisy so we only require a positive direction with a
      // moderate floor.
      expect(p99Last).toBeGreaterThan(p99First);
      expect(p99Last - p99First).toBeGreaterThan(10);
    });
  });

  describe('planted signal: brief error blip', () => {
    it('blip minute has ~5% error rate, ~10× baseline', () => {
      const blip = apiTraces.filter(
        t => t.timestampMs >= BLIP_START_MS && t.timestampMs < BLIP_END_MS,
      );
      expect(blip.length).toBeGreaterThan(100);
      const blipErrors = blip.filter(
        t => t.statusCode === 'STATUS_CODE_ERROR',
      ).length;
      const blipRate = blipErrors / blip.length;
      expect(blipRate).toBeGreaterThan(0.025);
      expect(blipRate).toBeLessThan(0.1);
    });

    it('all blip errors use the "upstream connect timeout" message', () => {
      const blipErrors = apiTraces.filter(
        t =>
          t.timestampMs >= BLIP_START_MS &&
          t.timestampMs < BLIP_END_MS &&
          t.statusCode === 'STATUS_CODE_ERROR',
      );
      const timeoutErrors = blipErrors.filter(
        t => t.statusMessage === 'upstream connect timeout',
      );
      expect(timeoutErrors.length).toBe(blipErrors.length);
    });
  });

  describe('distractor: recurring batch-sync spikes', () => {
    it('appears in BOTH the baseline window and the report window', () => {
      const batch = apiTraces.filter(
        t => t.spanName === 'POST /api/internal/batch-sync',
      );
      expect(batch.length).toBeGreaterThan(0);
      const inBaseline = batch.filter(
        t => t.timestampMs < REPORT_START_MS,
      ).length;
      const inReport = batch.filter(
        t => t.timestampMs >= REPORT_START_MS,
      ).length;
      // 3 hours of baseline vs 1 hour of report → roughly 3:1 ratio.
      expect(inBaseline).toBeGreaterThan(inReport); // present in both
      expect(inReport).toBeGreaterThan(0);
    });

    it('repeats on a ~15-minute cadence (16 spike-windows across 4 hours)', () => {
      const batch = apiTraces.filter(
        t => t.spanName === 'POST /api/internal/batch-sync',
      );
      // Bucket batch-sync spans by 15-minute cycle and count occupied buckets.
      // We expect 16 buckets to each have at least some spans (one per cycle).
      const occupied = new Set<number>();
      for (const t of batch) {
        const offset = t.timestampMs - BASELINE_START_MS;
        occupied.add(Math.floor(offset / (15 * 60 * 1000)));
      }
      expect(occupied.size).toBeGreaterThanOrEqual(15);
    });
  });
});
