import { mulberry32 } from '../rng/seeded';
import { dashboardBuildScenario } from '../scenarios/dashboard-build/generate';
import { collectScenario } from '../scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');

// 1% volume keeps the test cheap (~20K traces, ~40K logs) while preserving
// the structural invariants.
const TEST_VOLUME_FACTOR = 0.01;

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const WINDOW_START_MS = NOW_MS - ONE_HOUR_MS;
const ERROR_SPIKE_START_MS = NOW_MS - FIFTEEN_MIN_MS;

function run(seed: number) {
  return collectScenario(
    dashboardBuildScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: TEST_VOLUME_FACTOR,
    }),
  );
}

describe('dashboard-build scenario', () => {
  const result = run(42);

  it('produces traces and logs over the 1-hour window', () => {
    // 2M × 0.01 = 20K traces target; 4M × 0.01 = 40K logs.
    expect(result.traces.length).toBeGreaterThan(15_000);
    expect(result.traces.length).toBeLessThan(25_000);
    expect(result.logs.length).toBeGreaterThan(35_000);
    expect(result.logs.length).toBeLessThan(45_000);
  });

  it('covers the full 1-hour window', () => {
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const t of result.traces) {
      if (t.timestampMs < minTs) minTs = t.timestampMs;
      if (t.timestampMs > maxTs) maxTs = t.timestampMs;
    }
    // First sample within 1 min of window start; last within 1 min of now.
    expect(minTs - WINDOW_START_MS).toBeLessThan(60_000);
    expect(NOW_MS - maxTs).toBeLessThan(60_000);
  });

  it('is deterministic for a fixed seed', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(b.logs.length).toBe(result.logs.length);
    expect(b.traces[100].spanId).toBe(result.traces[100].spanId);
    expect(b.logs[100].body).toBe(result.logs[100].body);
  });

  describe('service distribution', () => {
    it('has all three services', () => {
      const services = new Set(result.traces.map(t => t.serviceName));
      expect(services).toContain('web-gateway');
      expect(services).toContain('order-service');
      expect(services).toContain('inventory-service');
    });

    it('web-gateway has the most traffic (~60%)', () => {
      const webGateway = result.traces.filter(
        t => t.serviceName === 'web-gateway',
      ).length;
      const ratio = webGateway / result.traces.length;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(0.7);
    });

    it('order-service has mid traffic (~25%)', () => {
      const orderService = result.traces.filter(
        t => t.serviceName === 'order-service',
      ).length;
      const ratio = orderService / result.traces.length;
      expect(ratio).toBeGreaterThan(0.18);
      expect(ratio).toBeLessThan(0.32);
    });

    it('inventory-service has low traffic (~15%)', () => {
      const inventoryService = result.traces.filter(
        t => t.serviceName === 'inventory-service',
      ).length;
      const ratio = inventoryService / result.traces.length;
      expect(ratio).toBeGreaterThan(0.1);
      expect(ratio).toBeLessThan(0.22);
    });
  });

  describe('order-service error spike', () => {
    it('error rate is elevated in the last 15 minutes', () => {
      const spikeTraces = result.traces.filter(
        t =>
          t.serviceName === 'order-service' &&
          t.timestampMs >= ERROR_SPIKE_START_MS,
      );
      const spikeErrors = spikeTraces.filter(
        t => t.statusCode === 'STATUS_CODE_ERROR',
      ).length;
      const spikeRate = spikeErrors / spikeTraces.length;
      // Target is ~8% but there's also 0.3% background, so expect ~8-11%
      expect(spikeRate).toBeGreaterThan(0.05);
      expect(spikeRate).toBeLessThan(0.15);
    });

    it('error rate is low outside the spike window for order-service', () => {
      const normalTraces = result.traces.filter(
        t =>
          t.serviceName === 'order-service' &&
          t.timestampMs < ERROR_SPIKE_START_MS,
      );
      const normalErrors = normalTraces.filter(
        t => t.statusCode === 'STATUS_CODE_ERROR',
      ).length;
      const normalRate = normalErrors / normalTraces.length;
      // Should be ~0.3% background only
      expect(normalRate).toBeLessThan(0.02);
    });
  });

  describe('trace attributes', () => {
    it('traces have http.method and http.route span attributes', () => {
      const sample = result.traces.slice(0, 100);
      const withMethod = sample.filter(
        t => t.spanAttributes['http.method'],
      ).length;
      expect(withMethod).toBeGreaterThan(90);
    });

    it('traces have realistic endpoint names as spanName', () => {
      const spanNames = new Set(result.traces.map(t => t.spanName));
      expect(spanNames).toContain('GET /api/products');
      expect(spanNames).toContain('POST /api/orders');
      expect(spanNames).toContain('GET /inventory/check');
    });
  });

  describe('log distribution', () => {
    it('has all severity levels', () => {
      const severities = new Set(result.logs.map(l => l.severityText));
      expect(severities).toContain('INFO');
      expect(severities).toContain('DEBUG');
      expect(severities).toContain('WARN');
      expect(severities).toContain('ERROR');
    });

    it('INFO is the most common severity (~50%)', () => {
      const infoLogs = result.logs.filter(
        l => l.severityText === 'INFO',
      ).length;
      const ratio = infoLogs / result.logs.length;
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });
  });

  describe('scenario metadata', () => {
    it('has dashboard hooks configured', () => {
      expect(dashboardBuildScenario.buildSystemPrompt).toBeDefined();
      expect(dashboardBuildScenario.allowedToolPatterns).toBeDefined();
      expect(
        dashboardBuildScenario.allowedToolPatterns!.length,
      ).toBeGreaterThan(0);
      expect(dashboardBuildScenario.judgeSystemPreamble).toBeDefined();
      expect(dashboardBuildScenario.postRunInspection).toBeDefined();
    });

    it('has a ground truth with rubric', () => {
      const gt = dashboardBuildScenario.groundTruth as {
        rubric?: { programmatic?: unknown[]; judge?: { criteria?: unknown[] } };
      };
      expect(gt.rubric).toBeDefined();
      expect(gt.rubric?.programmatic).toBeDefined();
      expect(gt.rubric?.judge?.criteria).toBeDefined();
      expect(gt.rubric!.programmatic!.length).toBeGreaterThan(10);
      expect(gt.rubric!.judge!.criteria!.length).toBeGreaterThan(0);
    });
  });
});
