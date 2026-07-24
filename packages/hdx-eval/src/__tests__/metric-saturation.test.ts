import { buildSystemPrompt } from '@/harness/systemPrompt';
import { mulberry32 } from '@/rng/seeded';
import { metricSaturationScenario } from '@/scenarios/metric-saturation/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');
// 2% volume keeps the test cheap (~8K traces) while preserving every planted
// metric signal — metrics are fixed-volume and never scaled.
const TEST_VOLUME_FACTOR = 0.02;

const WINDOW_MS = 2 * 60 * 60 * 1000;
const LEAK_START_MS = NOW_MS - 90 * 60 * 1000;
const DEPLOY_MS = NOW_MS - 75 * 60 * 1000;
const WINDOW_START_MS = NOW_MS - WINDOW_MS;
const POD_COUNT = 3;
const SUBJECT = 'recommendation-service';
const TWIN = 'search-service';

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

  const oldGenHeap = (service: string) =>
    m
      .gauge!.filter(
        g =>
          g.metricName === 'process.runtime.jvm.memory.used' &&
          g.serviceName === service &&
          g.attributes?.['jvm.memory.pool.name'] === 'G1 Old Gen',
      )
      .map(g => ({
        t: g.timeUnixMs,
        mb: g.value / 1024 / 1024,
        pod: g.resourceAttributes?.['k8s.pod.name'],
      }));

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

  describe('discovery surface — realistic multi-service metric catalog', () => {
    it('emits gauges for all four services', () => {
      const services = new Set(m.gauge!.map(g => g.serviceName));
      expect(services).toEqual(
        new Set([SUBJECT, TWIN, 'frontend-proxy', 'inventory-service']),
      );
    });

    it('duplicates the latency-histogram metric name on frontend-proxy', () => {
      const services = new Set(
        m
          .histogram!.filter(
            h => h.metricName === 'http.server.request.duration',
          )
          .map(h => h.serviceName),
      );
      expect(services).toEqual(new Set([SUBJECT, 'frontend-proxy']));
    });

    it('duplicates the JVM metric names on the search-service twin', () => {
      const memServices = new Set(
        m
          .gauge!.filter(
            g => g.metricName === 'process.runtime.jvm.memory.used',
          )
          .map(g => g.serviceName),
      );
      expect(memServices).toEqual(new Set([SUBJECT, TWIN]));
      const pauseServices = new Set(
        m
          .exponentialHistogram!.filter(e => e.metricName === 'jvm.gc.pause')
          .map(e => e.serviceName),
      );
      expect(pauseServices).toEqual(new Set([SUBJECT, TWIN]));
    });
  });

  describe('gauge — heap leak sawtooth (load-bearing, per pod x per pool)', () => {
    const heap = oldGenHeap(SUBJECT);

    it('is flat at baseline before the leak starts', () => {
      const preLeak = heap.filter(p => p.t < LEAK_START_MS - 60_000);
      expect(preLeak.length).toBeGreaterThan(0);
      const maxPre = Math.max(...preLeak.map(p => p.mb));
      expect(maxPre).toBeLessThan(850); // baseline ~600 + young-gen jitter
    });

    it('climbs toward the limit then resets (sawtooth) on EVERY pod', () => {
      for (let pod = 0; pod < POD_COUNT; pod++) {
        const podName = `${SUBJECT}-pod-${pod}`;
        const inLeak = heap.filter(
          p => p.pod === podName && p.t >= LEAK_START_MS + 8 * 60_000 * pod,
        );
        const maxIn = Math.max(...inLeak.map(p => p.mb));
        const minIn = Math.min(...inLeak.map(p => p.mb));
        expect(maxIn).toBeGreaterThan(1800); // approaches the ~1950MB limit
        expect(minIn).toBeLessThan(900); // drops back to baseline after restart
      }
    });

    it('only the Old Gen pool leaks — other pools stay healthy', () => {
      const otherPools = m.gauge!.filter(
        g =>
          g.metricName === 'process.runtime.jvm.memory.used' &&
          g.serviceName === SUBJECT &&
          g.attributes?.['jvm.memory.pool.name'] !== 'G1 Old Gen',
      );
      expect(otherPools.length).toBeGreaterThan(0);
      for (const g of otherPools) {
        expect(g.value / 1024 / 1024).toBeLessThan(400);
      }
    });

    it('service-level pod average blurs the sawtooth (group-by required)', () => {
      // Once all pods are leaking, the per-pod signal spans nearly the whole
      // baseline->limit range, but the cross-pod average at each scrape is
      // compressed because the pods are out of phase.
      const steady = heap.filter(p => p.t >= NOW_MS - 60 * 60 * 1000);
      const byScrape = new Map<number, number[]>();
      for (const p of steady) {
        const arr = byScrape.get(p.t) ?? [];
        arr.push(p.mb);
        byScrape.set(p.t, arr);
      }
      const avgs = [...byScrape.values()]
        .filter(arr => arr.length === POD_COUNT)
        .map(arr => arr.reduce((a, b) => a + b, 0) / arr.length);
      expect(avgs.length).toBeGreaterThan(10);
      const avgRange = Math.max(...avgs) - Math.min(...avgs);
      const podRange =
        Math.max(...steady.map(p => p.mb)) - Math.min(...steady.map(p => p.mb));
      expect(podRange).toBeGreaterThan(1200); // per-pod sawtooth is full-range
      expect(avgRange).toBeLessThan(700); // aggregate is a compressed blur
    });

    it('the search-service JVM twin stays healthy all window', () => {
      const twin = oldGenHeap(TWIN);
      expect(twin.length).toBeGreaterThan(0);
      for (const p of twin) {
        expect(p.mb).toBeLessThan(520);
      }
    });
  });

  it('gauge — CPU utilization stays flat and healthy on every service', () => {
    const cpu = m.gauge!.filter(g => g.metricName === 'system.cpu.utilization');
    const services = new Set(cpu.map(c => c.serviceName));
    expect(services.size).toBe(4);
    for (const c of cpu) {
      expect(c.value).toBeGreaterThanOrEqual(0.15);
      expect(c.value).toBeLessThanOrEqual(0.45);
    }
  });

  it('gauge — thread count rises with heap pressure (correlated symptom)', () => {
    const threads = m
      .gauge!.filter(
        g =>
          g.metricName === 'jvm.threads.count' &&
          g.resourceAttributes?.['k8s.pod.name'] === `${SUBJECT}-pod-0`,
      )
      .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
    expect(threads.length).toBeGreaterThan(0);
    const preLeak = threads.filter(g => g.timeUnixMs < LEAK_START_MS - 60_000);
    for (const g of preLeak) expect(g.value).toBeLessThan(60);
    const maxIn = Math.max(
      ...threads.filter(g => g.timeUnixMs >= LEAK_START_MS).map(g => g.value),
    );
    expect(maxIn).toBeGreaterThan(100);
  });

  describe('sum — cumulative restart + GC counters (need a rate)', () => {
    it('k8s.pod.restarts is per-pod, monotonic, and staggered', () => {
      const firstRestartAt: number[] = [];
      for (let pod = 0; pod < POD_COUNT; pod++) {
        const podName = `${SUBJECT}-pod-${pod}`;
        const series = m
          .sum!.filter(
            s =>
              s.metricName === 'k8s.pod.restarts' &&
              s.resourceAttributes?.['k8s.pod.name'] === podName,
          )
          .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
        expect(series.length).toBeGreaterThan(0);
        for (let i = 1; i < series.length; i++) {
          expect(series[i].value).toBeGreaterThanOrEqual(series[i - 1].value);
        }
        expect(series[0].value).toBe(0);
        expect(series[series.length - 1].value).toBeGreaterThanOrEqual(3);
        const first = series.find(s => s.value > 0);
        expect(first).toBeDefined();
        firstRestartAt.push(first!.timeUnixMs);
      }
      // Pods restart out of phase — a restart storm, not a synchronized event.
      expect(new Set(firstRestartAt).size).toBe(POD_COUNT);
    });

    it('Old-Gen GC collections accelerate once the leak is underway', () => {
      const oldGc = m
        .sum!.filter(
          s =>
            s.metricName === 'jvm.gc.collections' &&
            s.serviceName === SUBJECT &&
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

    it("the twin's Old-Gen GC counter stays at baseline rate", () => {
      const twinOldGc = m
        .sum!.filter(
          s =>
            s.metricName === 'jvm.gc.collections' &&
            s.serviceName === TWIN &&
            s.attributes?.['gc.name'] === 'G1 Old Generation',
        )
        .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
      expect(twinOldGc.length).toBeGreaterThan(0);
      const total = twinOldGc[twinOldGc.length - 1].value - twinOldGc[0].value;
      // ~0.2/min over 2h ≈ 24 collections; the subject accumulates ~150+.
      expect(total).toBeLessThan(40);
    });
  });

  it('histogram — request-duration mass shifts into the slow buckets in-window', () => {
    const hist = m
      .histogram!.filter(
        h =>
          h.metricName === 'http.server.request.duration' &&
          h.serviceName === SUBJECT,
      )
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

  it('exponential histogram — GC-pause tail on the subject, not the twin', () => {
    const bySvc = (svc: string) =>
      m
        .exponentialHistogram!.filter(
          e => e.metricName === 'jvm.gc.pause' && e.serviceName === svc,
        )
        .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
    const exp = bySvc(SUBJECT);
    const early = exp.filter(e => e.timeUnixMs < LEAK_START_MS - 60_000);
    const late = exp.filter(e => e.timeUnixMs >= NOW_MS - 20 * 60 * 1000);
    const maxEarly = Math.max(...early.map(e => e.max ?? 0));
    const maxLate = Math.max(...late.map(e => e.max ?? 0));
    expect(maxEarly).toBeLessThan(100); // only small young-gen pauses pre-leak
    expect(maxLate).toBeGreaterThan(400); // full-GC pauses in the tail

    const twinMax = Math.max(...bySvc(TWIN).map(e => e.max ?? 0));
    expect(twinMax).toBeLessThan(100); // the twin never develops a tail
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

    it('subject trace latency is only mildly elevated (no obvious signal)', () => {
      const inWindow = result.traces.filter(
        t => t.serviceName === SUBJECT && t.timestampMs >= LEAK_START_MS,
      );
      const slow = inWindow.filter(t => t.durationNs / 1e6 > 500);
      const errors = inWindow.filter(t => t.statusCode === 'STATUS_CODE_ERROR');
      expect(slow.length / inWindow.length).toBeLessThan(0.15);
      expect(errors.length / inWindow.length).toBeLessThan(0.01);
    });
  });

  describe('blinded-entry localization path', () => {
    it('the agent prompt does not name the culprit service', () => {
      const prompt = metricSaturationScenario.agentPrompt;
      // Fully blinded: the prompt reports only the storefront symptom and
      // names none of the generated services.
      for (const service of [
        SUBJECT,
        TWIN,
        'frontend-proxy',
        'inventory-service',
      ]) {
        expect(prompt).not.toContain(service);
      }
      expect(prompt).toMatch(/recommendations/i);
    });

    it('seeds trace floors for all four services (localization haystack)', () => {
      const services = new Set(result.traces.map(t => t.serviceName));
      expect(services).toEqual(
        new Set([SUBJECT, TWIN, 'frontend-proxy', 'inventory-service']),
      );
    });

    it('plants proxy 503 access lines naming the failing upstream', () => {
      const planted = result.logs.filter(
        l =>
          l.serviceName === 'frontend-proxy' &&
          l.logAttributes?.['upstream.cluster'] === 'recommendation-service' &&
          l.logAttributes?.['http.status_code'] === '503',
      );
      expect(planted.length).toBeGreaterThan(5);
      for (const l of planted) {
        expect(l.timestampMs).toBeGreaterThanOrEqual(LEAK_START_MS);
        expect(l.body).toContain('recommendation-service');
        expect(l.body).toContain('503');
        // The line localizes the upstream but never mentions memory/GC.
        expect(/heap|memory|gc|jvm/i.test(l.body)).toBe(false);
      }
    });
  });

  describe('distractors', () => {
    it('plants a coincidental deploy 15 min AFTER the leak onset', () => {
      const deployLog = result.logs.find(l =>
        /rolled out: version 1\.43\.0 -> 1\.43\.1/.test(l.body),
      );
      expect(deployLog).toBeDefined();
      expect(deployLog!.timestampMs).toBe(DEPLOY_MS);
      // The leak was already underway before the deploy: pod-0's Old Gen heap
      // climbing above baseline before DEPLOY_MS proves the deploy isn't the
      // cause — but only by ~15 min, so the rule-out requires comparing
      // onsets, not eyeballing a huge gap.
      const heapBeforeDeploy = oldGenHeap(SUBJECT)
        .filter(
          p =>
            p.pod === `${SUBJECT}-pod-0` &&
            p.t >= LEAK_START_MS &&
            p.t < DEPLOY_MS,
        )
        .map(p => p.mb);
      expect(heapBeforeDeploy.length).toBeGreaterThan(0);
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
