import { mulberry32 } from '@/rng/seeded';
import { quietSaturationScenario } from '@/scenarios/quiet-saturation/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-06-01T12:00:00.000Z');
// 2% volume keeps the test cheap while preserving every planted signal —
// metrics are fixed-volume and never scaled.
const TEST_VOLUME_FACTOR = 0.02;

const WINDOW_MS = 3 * 60 * 60 * 1000;
const WINDOW_START_MS = NOW_MS - WINDOW_MS;
const FLAG_FLIP_MS = NOW_MS - 90 * 60 * 1000;
const NOTIFY_DEPLOY_MS = NOW_MS - 40 * 60 * 1000;
const TIMEOUT_WINDOW_START_MS = NOW_MS - 12 * 60 * 1000;
const LAST_SATURATION_MS = NOW_MS - 27 * 60 * 1000;
const POOL_MAX = 40;
const SUBJECT = 'order-api';
const TWIN = 'catalog-api';

function run(seed: number, factor = TEST_VOLUME_FACTOR) {
  return collectScenario(
    quietSaturationScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: factor,
    }),
  );
}

describe('quiet-saturation scenario', () => {
  const result = run(42);
  const m = result.metrics!;

  const poolUsedSeries = (service: string) =>
    m
      .gauge!.filter(
        g =>
          g.metricName === 'db.client.connections.usage' &&
          g.serviceName === service &&
          g.attributes?.state === 'used',
      )
      .map(g => ({
        t: g.timeUnixMs,
        value: g.value,
        pod: g.resourceAttributes?.['k8s.pod.name'],
      }));

  it('emits gauge, sum, and histogram metrics', () => {
    expect(m).toBeDefined();
    expect(m.gauge!.length).toBeGreaterThan(0);
    expect(m.sum!.length).toBeGreaterThan(0);
    expect(m.histogram!.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed (traces + metrics)', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(b.logs.length).toBe(result.logs.length);
    expect(b.traces[10]?.spanId).toBe(result.traces[10]?.spanId);
    expect(JSON.stringify(b.metrics)).toBe(JSON.stringify(m));
  });

  it('anchors every metric point at or before now, within the window', () => {
    const all = [...m.gauge!, ...m.sum!, ...m.histogram!];
    for (const pt of all) {
      expect(pt.timeUnixMs).toBeLessThanOrEqual(NOW_MS);
      expect(pt.timeUnixMs).toBeGreaterThanOrEqual(WINDOW_START_MS);
    }
  });

  describe('pool gauges — the load-bearing signal', () => {
    const used = poolUsedSeries(SUBJECT);
    const pods = [...new Set(used.map(p => p.pod))];

    it('tracks 4 order-api pods', () => {
      expect(pods).toHaveLength(4);
    });

    it('is flat at baseline before the flag flip, on every pod', () => {
      for (const pod of pods) {
        const pre = used.filter(p => p.pod === pod && p.t < FLAG_FLIP_MS);
        expect(pre.length).toBeGreaterThan(0);
        for (const p of pre) expect(p.value).toBe(8);
      }
    });

    it('climbs MONOTONICALLY after the flip (a leak never dips)', () => {
      for (const pod of pods) {
        const series = used
          .filter(p => p.pod === pod)
          .sort((a, b) => a.t - b.t);
        for (let i = 1; i < series.length; i++) {
          expect(series[i].value).toBeGreaterThanOrEqual(series[i - 1].value);
        }
      }
    });

    it('pins every pod at the 40-connection cap before now', () => {
      for (const pod of pods) {
        const tail = used.filter(
          p => p.pod === pod && p.t >= LAST_SATURATION_MS,
        );
        expect(tail.length).toBeGreaterThan(0);
        for (const p of tail) expect(p.value).toBe(POOL_MAX);
      }
    });

    it('publishes the ceiling as db.client.connections.max = 40', () => {
      const maxes = m.gauge!.filter(
        g =>
          g.metricName === 'db.client.connections.max' &&
          g.serviceName === SUBJECT,
      );
      expect(maxes.length).toBeGreaterThan(0);
      for (const g of maxes) expect(g.value).toBe(POOL_MAX);
    });

    it('lifts pending_requests off zero only after saturation', () => {
      const pending = m.gauge!.filter(
        g =>
          g.metricName === 'db.client.connections.pending_requests' &&
          g.serviceName === SUBJECT,
      );
      const before = pending.filter(g => g.timeUnixMs < FLAG_FLIP_MS);
      expect(Math.max(...before.map(g => g.value))).toBeLessThanOrEqual(1);
      const tail = pending.filter(g => g.timeUnixMs >= NOW_MS - 5 * 60 * 1000);
      expect(Math.max(...tail.map(g => g.value))).toBeGreaterThan(10);
    });

    it('keeps the catalog-api twin healthy (same metric names, ~8/40)', () => {
      const twin = poolUsedSeries(TWIN);
      expect(twin.length).toBeGreaterThan(0);
      for (const p of twin) expect(p.value).toBeLessThanOrEqual(11);
    });
  });

  describe('leak-vs-load discriminator', () => {
    it('keeps the request-count slope perfectly flat', () => {
      const counts = m
        .sum!.filter(
          s =>
            s.metricName === 'http.server.request.count' &&
            s.serviceName === SUBJECT,
        )
        .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
      expect(counts.length).toBeGreaterThan(10);
      const deltas = new Set<number>();
      for (let i = 1; i < counts.length; i++) {
        deltas.add(counts[i].value - counts[i - 1].value);
      }
      expect(deltas.size).toBe(1); // constant increments — traffic never moves
    });

    it('keeps order-api cpu/memory flat (rules out infra)', () => {
      const cpu = m.gauge!.filter(
        g =>
          g.metricName === 'system.cpu.utilization' &&
          g.serviceName === SUBJECT,
      );
      for (const g of cpu) expect(g.value).toBeLessThan(0.35);
    });
  });

  describe('traces — the slow-but-viable path', () => {
    const orderRoots = result.traces.filter(
      t => t.serviceName === SUBJECT && t.spanKind === 'SPAN_KIND_SERVER',
    );
    const acquires = result.traces.filter(
      t => t.spanName === 'db.pool.acquire',
    );
    const queries = result.traces.filter(
      t => t.spanName === 'INSERT orders' || t.spanName === 'SELECT orders',
    );

    it('slows ALL routes together after saturation (uniform creep)', () => {
      const routes = ['/api/orders', '/api/orders/{orderId}', '/api/cart'];
      for (const route of routes) {
        const of = (rows: typeof orderRoots) =>
          rows.length
            ? rows.reduce((a, r) => a + r.durationNs, 0) / rows.length / 1e6
            : 0;
        const early = orderRoots.filter(
          r =>
            r.spanAttributes?.['http.route'] === route &&
            r.timestampMs < FLAG_FLIP_MS,
        );
        const late = orderRoots.filter(
          r =>
            r.spanAttributes?.['http.route'] === route &&
            r.timestampMs >= NOW_MS - 10 * 60 * 1000 &&
            r.spanAttributes?.['http.response.status_code'] === '200',
        );
        expect(early.length).toBeGreaterThan(0);
        expect(late.length).toBeGreaterThan(0);
        expect(of(late)).toBeGreaterThan(of(early) + 300); // every route grew
      }
    });

    it('grows db.pool.acquire while db.query stays fast (client-side wait)', () => {
      const lateAcquires = acquires.filter(
        a =>
          a.timestampMs >= NOW_MS - 10 * 60 * 1000 &&
          a.statusCode !== 'STATUS_CODE_ERROR',
      );
      const meanMs =
        lateAcquires.reduce((s, a) => s + a.durationNs, 0) /
        lateAcquires.length /
        1e6;
      expect(meanMs).toBeGreaterThan(300);
      for (const q of queries) {
        expect(q.durationNs / 1e6).toBeLessThanOrEqual(25.5); // the DB never slows
      }
    });

    it('confines 503 acquire-timeouts to the final window, ~30s durations', () => {
      const failures = orderRoots.filter(
        r => r.statusCode === 'STATUS_CODE_ERROR',
      );
      expect(failures.length).toBeGreaterThan(0);
      for (const f of failures) {
        expect(f.timestampMs).toBeGreaterThanOrEqual(TIMEOUT_WINDOW_START_MS);
        expect(f.durationNs / 1e6).toBeGreaterThanOrEqual(30_000);
        expect(f.spanAttributes?.['http.response.status_code']).toBe('503');
      }
    });

    it('introduces invoice.render_async only after the flag flip', () => {
      const invoices = result.traces.filter(
        t => t.spanName === 'invoice.render_async',
      );
      expect(invoices.length).toBeGreaterThan(0);
      for (const inv of invoices) {
        expect(inv.timestampMs).toBeGreaterThanOrEqual(FLAG_FLIP_MS);
      }
    });
  });

  describe('planted events + distractors', () => {
    it('plants exactly one feature-flag flip event at T-90m', () => {
      const flips = result.logs.filter(
        l => l.logAttributes?.['event.name'] === 'feature_flag.update',
      );
      expect(flips).toHaveLength(1);
      expect(flips[0].timestampMs).toBe(FLAG_FLIP_MS);
      expect(flips[0].body).toContain('orders.async-invoice');
    });

    it('plants the innocent notification-service rollout near the visible onset', () => {
      const rollouts = result.logs.filter(
        l =>
          l.logAttributes?.['event.name'] === 'deployment.rollout' &&
          l.serviceName === 'notification-service',
      );
      expect(rollouts.length).toBe(5); // start + 3 pods + complete
      for (const r of rollouts) {
        expect(r.timestampMs).toBeGreaterThanOrEqual(NOTIFY_DEPLOY_MS);
        expect(r.timestampMs).toBeGreaterThan(FLAG_FLIP_MS); // after the leak began
      }
    });

    it('emits pool-timeout ERROR logs only in the final window, with pool stats', () => {
      const timeouts = result.logs.filter(
        l => l.logAttributes?.['event.name'] === 'db.pool.acquire_timeout',
      );
      expect(timeouts.length).toBeGreaterThan(0);
      for (const l of timeouts) {
        expect(l.timestampMs).toBeGreaterThanOrEqual(TIMEOUT_WINDOW_START_MS);
        expect(l.body).toContain("pool 'orders-pg'");
        expect(l.body).toContain('pool size 40, in use 40');
        expect(l.traceId).toBeTruthy(); // trace-correlated
      }
    });

    it('spikes inventory-service CPU only during the batch window', () => {
      const cpu = m.gauge!.filter(
        g =>
          g.metricName === 'system.cpu.utilization' &&
          g.serviceName === 'inventory-service',
      );
      const inBatch = cpu.filter(
        g =>
          g.timeUnixMs >= NOW_MS - 60 * 60 * 1000 &&
          g.timeUnixMs <= NOW_MS - 45 * 60 * 1000,
      );
      const outside = cpu.filter(
        g =>
          g.timeUnixMs < NOW_MS - 60 * 60 * 1000 ||
          g.timeUnixMs > NOW_MS - 45 * 60 * 1000,
      );
      expect(Math.min(...inBatch.map(g => g.value))).toBeGreaterThan(0.8);
      expect(Math.max(...outside.map(g => g.value))).toBeLessThan(0.35);
    });
  });

  describe('volume scaling', () => {
    it('scales trace/log floors but keeps planted metric volume fixed', () => {
      const tiny = run(42, 0.005);
      expect(tiny.traces.length).toBeLessThan(result.traces.length);
      expect(JSON.stringify(tiny.metrics!.gauge!.length)).toBe(
        JSON.stringify(m.gauge!.length),
      );
      // Fixed-volume planted events survive any factor.
      const flips = tiny.logs.filter(
        l => l.logAttributes?.['event.name'] === 'feature_flag.update',
      );
      expect(flips).toHaveLength(1);
    });
  });
});
