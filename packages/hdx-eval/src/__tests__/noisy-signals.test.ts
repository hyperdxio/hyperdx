import { mulberry32 } from '../rng/seeded';
import { noisySignalsScenario } from '../scenarios/noisy-signals/generate';
import { collectScenario } from '../scenarios/types';

const NOW_MS = Date.parse('2026-05-08T12:00:00.000Z');
// Tests run at 1% volume (15M → 150K) to keep memory reasonable. Pattern
// shares are preserved by the volumeFactor scaling.
const TEST_VOLUME_FACTOR = 0.01;
const TARGET_TOTAL = 16_000_000;
const SCALED_TOTAL = TARGET_TOTAL * TEST_VOLUME_FACTOR; // ~160K

function run(seed: number) {
  return collectScenario(
    noisySignalsScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: TEST_VOLUME_FACTOR,
    }),
  );
}

describe('noisy-signals scenario v6 (composite cells)', () => {
  const result = run(42);

  it(`emits ~${SCALED_TOTAL.toLocaleString()} logs at volumeFactor ${TEST_VOLUME_FACTOR} (target ${TARGET_TOTAL.toLocaleString()} at full scale)`, () => {
    // Allow 5% slack since each phase rounds independently.
    expect(result.logs.length).toBeGreaterThan(SCALED_TOTAL * 0.95);
    expect(result.logs.length).toBeLessThan(SCALED_TOTAL * 1.05);
  });

  it('is deterministic for a fixed seed and now', () => {
    const b = run(42);
    expect(b.logs.length).toBe(result.logs.length);
    for (const i of [0, 1000, result.logs.length - 1]) {
      expect(result.logs[i].body).toBe(b.logs[i].body);
      expect(result.logs[i].timestampMs).toBe(b.logs[i].timestampMs);
    }
  });

  // ─── Per-pattern shares ────────────────────────────────────────────────

  function shareByEvent(eventName: string): number {
    return (
      result.logs.filter(l => l.logAttributes['event.name'] === eventName)
        .length / result.logs.length
    );
  }

  it('cell 1: notification-service × DEBUG carries BOTH cache.hit (~6.7%) AND notification.delivery (~6.7%)', () => {
    expect(shareByEvent('cache.hit')).toBeCloseTo(0.067, 1);
    expect(shareByEvent('notification.delivery')).toBeCloseTo(0.067, 1);
  });

  it('cell 2: billing-service × INFO carries BOTH subscription metric-as-log (~6.7%) AND legit financial events (~6.7%)', () => {
    expect(shareByEvent('subscription.metric.calculated')).toBeCloseTo(
      0.067,
      1,
    );
    const billingEvents = [
      'invoice.charged',
      'invoice.refunded',
      'subscription.activated',
      'subscription.cancelled',
      'payment.failed',
    ];
    const share =
      result.logs.filter(l =>
        billingEvents.includes(l.logAttributes['event.name'] ?? ''),
      ).length / result.logs.length;
    expect(share).toBeCloseTo(0.067, 1);
  });

  it('cell 3: worker × ERROR carries BOTH NonFatalRetryableError caught (~2.7%) AND job.failed.permanent (~2.7%)', () => {
    expect(shareByEvent('job.caught_exception')).toBeCloseTo(0.027, 1);
    expect(shareByEvent('job.failed.permanent')).toBeCloseTo(0.027, 1);
  });

  it('cell 4: 4-service × DEBUG carries BOTH health.check (~13.3%) AND legit per-service ops debug (~13.3%)', () => {
    expect(shareByEvent('health.check')).toBeCloseTo(0.133, 1);
    const opsEvents = [
      'inventory.stock_lookup',
      'pricing.calculation',
      'shipping.rate.quote',
      'recommendation.score',
    ];
    const share =
      result.logs.filter(l =>
        opsEvents.includes(l.logAttributes['event.name'] ?? ''),
      ).length / result.logs.length;
    expect(share).toBeCloseTo(0.133, 1);
  });

  it('cell 5: frontend-proxy × INFO carries BOTH lb.health.probe (~6.7%) AND proxy.access (~6.7%)', () => {
    expect(shareByEvent('lb.health.probe')).toBeCloseTo(0.067, 1);
    expect(shareByEvent('proxy.access')).toBeCloseTo(0.067, 1);
  });

  it('cell 6: frontend × INFO carries BOTH console.log_dump (~5.3%) AND page.render (~5.3%)', () => {
    expect(shareByEvent('frontend.console.log_dump')).toBeCloseTo(0.053, 1);
    expect(shareByEvent('page.render')).toBeCloseTo(0.053, 1);
  });

  it('cell 7: search-service × INFO carries BOTH search.cache.miss (~4%) AND index.shard.flush (~4%)', () => {
    expect(shareByEvent('search.cache.miss')).toBeCloseTo(0.04, 1);
    expect(shareByEvent('index.shard.flush')).toBeCloseTo(0.04, 1);
  });

  // ─── The whole point: GROUP BY (Service, Severity) does NOT separate
  //     noise from load-bearing — the cells are composite. ───────────────

  it('inside notification-service × DEBUG, cache.hit and notification.delivery are within 30% of each other in volume', () => {
    const cell = result.logs.filter(
      l =>
        l.serviceName === 'notification-service' && l.severityText === 'DEBUG',
    );
    const cacheHits = cell.filter(
      l => l.logAttributes['event.name'] === 'cache.hit',
    ).length;
    const deliveries = cell.filter(
      l => l.logAttributes['event.name'] === 'notification.delivery',
    ).length;
    const ratio =
      Math.min(cacheHits, deliveries) / Math.max(cacheHits, deliveries);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('inside billing-service × INFO, subscription metric-as-log and financial events are within 30% of each other', () => {
    const cell = result.logs.filter(
      l => l.serviceName === 'billing-service' && l.severityText === 'INFO',
    );
    const subs = cell.filter(
      l => l.logAttributes['event.name'] === 'subscription.metric.calculated',
    ).length;
    const billingEventsList = [
      'invoice.charged',
      'invoice.refunded',
      'subscription.activated',
      'subscription.cancelled',
      'payment.failed',
    ];
    const fin = cell.filter(l =>
      billingEventsList.includes(l.logAttributes['event.name'] ?? ''),
    ).length;
    const ratio = Math.min(subs, fin) / Math.max(subs, fin);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('inside worker × ERROR, caught-exception and permanent-failure are within 30% of each other', () => {
    const cell = result.logs.filter(
      l => l.serviceName === 'worker' && l.severityText === 'ERROR',
    );
    const caught = cell.filter(
      l => l.logAttributes['event.name'] === 'job.caught_exception',
    ).length;
    const perm = cell.filter(
      l => l.logAttributes['event.name'] === 'job.failed.permanent',
    ).length;
    const ratio = Math.min(caught, perm) / Math.max(caught, perm);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('inside frontend-proxy × INFO, lb.health.probe and proxy.access are within 30% of each other', () => {
    const cell = result.logs.filter(
      l => l.serviceName === 'frontend-proxy' && l.severityText === 'INFO',
    );
    const probes = cell.filter(
      l => l.logAttributes['event.name'] === 'lb.health.probe',
    ).length;
    const access = cell.filter(
      l => l.logAttributes['event.name'] === 'proxy.access',
    ).length;
    const ratio = Math.min(probes, access) / Math.max(probes, access);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('inside inventory-service × DEBUG, heartbeats and stock_lookups are within 30% of each other (sample cell)', () => {
    const cell = result.logs.filter(
      l => l.serviceName === 'inventory-service' && l.severityText === 'DEBUG',
    );
    const heart = cell.filter(
      l => l.logAttributes['event.name'] === 'health.check',
    ).length;
    const ops = cell.filter(
      l => l.logAttributes['event.name'] === 'inventory.stock_lookup',
    ).length;
    const ratio = Math.min(heart, ops) / Math.max(heart, ops);
    expect(ratio).toBeGreaterThan(0.7);
  });

  // ─── Body cardinality + attribute discoverability ──────────────────────

  it('heartbeat / cache.hit / notification.delivery — each has variable bodies (>50% unique in 500-row sample)', () => {
    for (const ev of ['health.check', 'cache.hit', 'notification.delivery']) {
      const sample = result.logs
        .filter(l => l.logAttributes['event.name'] === ev)
        .slice(0, 500);
      const unique = new Set(sample.map(l => l.body));
      expect(unique.size / sample.length).toBeGreaterThan(0.5);
    }
  });

  it('subscription metric-as-log keeps metric.kind=gauge attribute (the conversion signal)', () => {
    const subs = result.logs.filter(
      l => l.logAttributes['metric.name'] === 'subscription_mrr',
    );
    expect(subs.length).toBeGreaterThan(0);
    expect(subs[0].logAttributes['metric.kind']).toBe('gauge');
  });

  it('NonFatalRetryableError caught-exception has stable error.kind attr; permanent has different error.kind', () => {
    const caught = result.logs.filter(
      l =>
        l.logAttributes['event.name'] === 'job.caught_exception' &&
        l.logAttributes['error.kind'] === 'NonFatalRetryableError',
    );
    expect(caught.length).toBeGreaterThan(0);
    const perm = result.logs.filter(
      l => l.logAttributes['event.name'] === 'job.failed.permanent',
    );
    expect(perm.length).toBeGreaterThan(0);
    // The two patterns share serviceName + severityText but must be
    // distinguishable by event.name (and have different error.kind).
    const permKinds = new Set(perm.map(l => l.logAttributes['error.kind']));
    expect(permKinds.has('NonFatalRetryableError')).toBe(false);
  });

  it('lb.health.probe uses kube-probe user-agent (the signal that it is a probe)', () => {
    const probes = result.logs.filter(
      l => l.logAttributes['event.name'] === 'lb.health.probe',
    );
    expect(probes.length).toBeGreaterThan(0);
    expect(probes[0].logAttributes['user_agent.original']).toContain(
      'kube-probe',
    );
  });

  it('background variety (~9.3%) emits many distinct body templates across many services', () => {
    const bg = result.logs.filter(
      l => l.logAttributes['event.name'] === 'app.background',
    );
    expect(bg.length / result.logs.length).toBeCloseTo(0.093, 1);
    const services = new Set(bg.slice(0, 5000).map(l => l.serviceName));
    expect(services.size).toBeGreaterThan(8);
    const bodies = new Set(bg.slice(0, 5000).map(l => l.body));
    expect(bodies.size).toBeGreaterThan(500);
  });

  it('severity is messy (lowercase + alias variants present in _severity_raw attr)', () => {
    const rawSevs = new Set(
      result.logs
        .map(l => l.logAttributes._severity_raw)
        .filter(Boolean) as string[],
    );
    expect(rawSevs.has('info')).toBe(true);
    expect(rawSevs.size).toBeGreaterThanOrEqual(3);
  });

  it('every log has rich resource attributes (k8s + service.* keys)', () => {
    const sample = result.logs.slice(0, 500);
    for (const l of sample) {
      expect(l.resourceAttributes['service.name']).toBeDefined();
      expect(l.resourceAttributes['k8s.pod.name']).toBeDefined();
      expect(l.resourceAttributes['cloud.region']).toBeDefined();
    }
  });

  it('overall body cardinality is high (>50% unique in a 5K sample)', () => {
    const sample = result.logs.slice(0, 5000);
    const unique = new Set(sample.map(l => l.body));
    const ratio = unique.size / sample.length;
    expect(ratio).toBeGreaterThan(0.5);
  });
});
