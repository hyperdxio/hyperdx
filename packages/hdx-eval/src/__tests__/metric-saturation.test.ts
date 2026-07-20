import { buildSystemPrompt } from '@/harness/systemPrompt';
import { mulberry32 } from '@/rng/seeded';
import { metricSaturationScenario } from '@/scenarios/metric-saturation/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');
// 2% volume keeps the test cheap (~5K traces) while preserving every planted
// metric signal — metrics are fixed-volume and never scaled.
const TEST_VOLUME_FACTOR = 0.02;

const WINDOW_MS = 2 * 60 * 60 * 1000;
const LEAK_START_MS = NOW_MS - 90 * 60 * 1000;
const DEPLOY_MS = NOW_MS - 40 * 60 * 1000;
const WINDOW_START_MS = NOW_MS - WINDOW_MS;

function run(seed: number, factor = TEST_VOLUME_FACTOR) {
  return collectScenario(
    metricSaturationScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: factor,
    }),
  );
}

describe('metric-saturation scenario', () => {
  const result = run(42);
  const m = result.metrics!;

  it('emits all five OTel metric types', () => {
    expect(m).toBeDefined();
    expect(m.gauge!.length).toBeGreaterThan(0);
    expect(m.sum!.length).toBeGreaterThan(0);
    expect(m.histogram!.length).toBeGreaterThan(0);
    expect(m.exponentialHistogram!.length).toBeGreaterThan(0);
    expect(m.summary!.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed (traces + metrics)', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(b.logs.length).toBe(result.logs.length);
    expect(b.traces[10]?.spanId).toBe(result.traces[10]?.spanId);
    expect(JSON.stringify(b.metrics)).toBe(JSON.stringify(m));
  });

  it('anchors every metric point at or before now, within the window', () => {
    const all = [
      ...m.gauge!,
      ...m.sum!,
      ...m.histogram!,
      ...m.exponentialHistogram!,
      ...m.summary!,
    ];
    for (const pt of all) {
      expect(pt.timeUnixMs).toBeLessThanOrEqual(NOW_MS);
      expect(pt.timeUnixMs).toBeGreaterThanOrEqual(WINDOW_START_MS);
    }
  });

  describe('gauge — heap leak sawtooth (load-bearing)', () => {
    const heap = m
      .gauge!.filter(g => g.metricName === 'process.runtime.jvm.memory.used')
      .map(g => ({ t: g.timeUnixMs, mb: g.value / 1024 / 1024 }));

    it('is flat at baseline before the leak starts', () => {
      const preLeak = heap.filter(p => p.t < LEAK_START_MS - 60_000);
      expect(preLeak.length).toBeGreaterThan(0);
      const maxPre = Math.max(...preLeak.map(p => p.mb));
      expect(maxPre).toBeLessThan(850); // baseline ~600 + young-gen jitter
    });

    it('climbs toward the limit then resets (sawtooth) during the leak', () => {
      const inLeak = heap.filter(p => p.t >= LEAK_START_MS);
      const maxIn = Math.max(...inLeak.map(p => p.mb));
      const minIn = Math.min(...inLeak.map(p => p.mb));
      expect(maxIn).toBeGreaterThan(1800); // approaches the ~1950MB limit
      expect(minIn).toBeLessThan(900); // drops back to baseline after restart
    });
  });

  it('gauge — CPU utilization stays flat and healthy (rules out CPU)', () => {
    const cpu = m.gauge!.filter(g => g.metricName === 'system.cpu.utilization');
    expect(cpu.length).toBeGreaterThan(0);
    for (const c of cpu) {
      expect(c.value).toBeGreaterThanOrEqual(0.3);
      expect(c.value).toBeLessThanOrEqual(0.45);
    }
  });

  describe('sum — cumulative restart + GC counters (need a rate)', () => {
    it('k8s.pod.restarts is monotonic and shows a restart storm', () => {
      const restarts = m.sum!.filter(s => s.metricName === 'k8s.pod.restarts');
      for (let i = 1; i < restarts.length; i++) {
        expect(restarts[i].value).toBeGreaterThanOrEqual(restarts[i - 1].value);
      }
      expect(restarts[0].value).toBe(0);
      expect(restarts[restarts.length - 1].value).toBeGreaterThanOrEqual(3);
    });

    it('Old-Gen GC collections accelerate once the leak is underway', () => {
      const oldGc = m
        .sum!.filter(
          s =>
            s.metricName === 'jvm.gc.collections' &&
            s.attributes?.['gc.name'] === 'G1 Old Generation',
        )
        .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
      const rateOver = (from: number, to: number): number => {
        const pts = oldGc.filter(
          p => p.timeUnixMs >= from && p.timeUnixMs < to,
        );
        if (pts.length < 2) return 0;
        return pts[pts.length - 1].value - pts[0].value;
      };
      const preRate = rateOver(WINDOW_START_MS, LEAK_START_MS);
      const leakRate = rateOver(LEAK_START_MS, NOW_MS);
      expect(leakRate).toBeGreaterThan(preRate * 2);
    });
  });

  it('histogram — request-duration mass shifts into the slow buckets in-window', () => {
    const hist = m
      .histogram!.filter(h => h.metricName === 'http.server.request.duration')
      .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
    // Buckets 7+ correspond to > 500ms (bounds index 6 == 500).
    const slowFrac = (h: (typeof hist)[number]): number =>
      h.bucketCounts.slice(7).reduce((a, b) => a + b, 0) / h.count;
    const early = hist.filter(h => h.timeUnixMs < LEAK_START_MS - 60_000);
    const late = hist.filter(h => h.timeUnixMs >= NOW_MS - 20 * 60 * 1000);
    const earlyAvg = early.reduce((a, h) => a + slowFrac(h), 0) / early.length;
    const lateAvg = late.reduce((a, h) => a + slowFrac(h), 0) / late.length;
    expect(lateAvg).toBeGreaterThan(earlyAvg * 3);
  });

  it('exponential histogram — GC-pause distribution develops a heavy tail', () => {
    const exp = m
      .exponentialHistogram!.filter(e => e.metricName === 'jvm.gc.pause')
      .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
    const early = exp.filter(e => e.timeUnixMs < LEAK_START_MS - 60_000);
    const late = exp.filter(e => e.timeUnixMs >= NOW_MS - 20 * 60 * 1000);
    const maxEarly = Math.max(...early.map(e => e.max ?? 0));
    const maxLate = Math.max(...late.map(e => e.max ?? 0));
    expect(maxEarly).toBeLessThan(100); // only small young-gen pauses pre-leak
    expect(maxLate).toBeGreaterThan(400); // full-GC pauses in the tail
  });

  it('summary — neighbor db.client latency is a stable, unrelated decoy', () => {
    const sm = m.summary!.filter(
      s => s.metricName === 'db.client.operation.duration',
    );
    expect(sm.length).toBeGreaterThan(0);
    // It lives on a DIFFERENT service than the incident.
    for (const s of sm) expect(s.serviceName).toBe('inventory-service');
    // p99 is flat across the whole window (not correlated with the incident).
    const p99 = sm.map(s => s.quantiles[2].value);
    expect(Math.max(...p99) - Math.min(...p99)).toBeLessThan(20);
  });

  describe('load-bearing property — root cause is NOT in traces/logs', () => {
    it('no trace span carries memory/GC/heap attributes or messages', () => {
      const causeRe =
        /leak|out of memory|oomkill|heap|garbage|gc\.pause|jvm\./i;
      for (const t of result.traces) {
        expect(causeRe.test(JSON.stringify(t.spanAttributes))).toBe(false);
        expect(causeRe.test(t.statusMessage)).toBe(false);
      }
    });

    it('no log body reveals the leak/OOM diagnosis', () => {
      const diagnosticRe = /\bleak\b|out of memory|oomkilled|outofmemoryerror/i;
      for (const l of result.logs) {
        expect(diagnosticRe.test(l.body)).toBe(false);
      }
    });

    it('trace latency is only mildly elevated (no obvious signal)', () => {
      const inWindow = result.traces.filter(
        t => t.timestampMs >= LEAK_START_MS,
      );
      const slow = inWindow.filter(t => t.durationNs / 1e6 > 500);
      const errors = inWindow.filter(t => t.statusCode === 'STATUS_CODE_ERROR');
      expect(slow.length / inWindow.length).toBeLessThan(0.15);
      expect(errors.length / inWindow.length).toBeLessThan(0.01);
    });
  });

  describe('distractors', () => {
    it('plants a coincidental deploy that POSTDATES the leak', () => {
      const deployLog = result.logs.find(l =>
        /rolled out: version 1\.43\.0 -> 1\.43\.1/.test(l.body),
      );
      expect(deployLog).toBeDefined();
      expect(deployLog!.timestampMs).toBe(DEPLOY_MS);
      // The leak was already well underway before the deploy: heap climbing
      // above baseline before DEPLOY_MS proves the deploy isn't the cause.
      const heapBeforeDeploy = m
        .gauge!.filter(
          g =>
            g.metricName === 'process.runtime.jvm.memory.used' &&
            g.timeUnixMs >= LEAK_START_MS &&
            g.timeUnixMs < DEPLOY_MS,
        )
        .map(g => g.value / 1024 / 1024);
      expect(Math.max(...heapBeforeDeploy)).toBeGreaterThan(1000);
    });

    it('emits ambiguous restart-adjacent log lines (symptom, not cause)', () => {
      const restartLines = result.logs.filter(l =>
        /liveness probe failed|received sigterm|readiness probe failed|container recommendation-service restarted/i.test(
          l.body,
        ),
      );
      expect(restartLines.length).toBeGreaterThan(0);
    });
  });
});

describe('metric-saturation system prompt', () => {
  it('tells the agent a metric source is available', () => {
    const prompt = buildSystemPrompt(
      metricSaturationScenario,
      '2026-05-10T20:00:00.000Z',
    );
    expect(prompt).toMatch(/metric source is available/i);
    expect(prompt).toMatch(/exponential histogram/i);
    // Still the default SRE investigation framing.
    expect(prompt).toMatch(/You are an SRE/i);
  });
});
