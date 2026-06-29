import { normalizeSeverityText } from '@/generators/templates';
import { mulberry32 } from '@/rng/seeded';
import { dashboardBuildScenario } from '@/scenarios/dashboard-build/generate';
import { collectScenario } from '@/scenarios/types';

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
    it('has all seven services (3 primary + 4 distractors)', () => {
      const services = new Set(result.traces.map(t => t.serviceName));
      expect(services).toContain('web-gateway');
      expect(services).toContain('order-service');
      expect(services).toContain('inventory-service');
      expect(services).toContain('health-checker');
      expect(services).toContain('cron-scheduler');
      expect(services).toContain('internal-metrics');
      expect(services).toContain('debug-proxy');
      expect(services.size).toBe(7);
    });

    it('web-gateway has the most traffic (~40%)', () => {
      const webGateway = result.traces.filter(
        t => t.serviceName === 'web-gateway',
      ).length;
      const ratio = webGateway / result.traces.length;
      expect(ratio).toBeGreaterThan(0.33);
      expect(ratio).toBeLessThan(0.47);
    });

    it('distractor services collectively have ~32% of traffic', () => {
      const distractors = result.traces.filter(t =>
        [
          'health-checker',
          'cron-scheduler',
          'internal-metrics',
          'debug-proxy',
        ].includes(t.serviceName),
      ).length;
      const ratio = distractors / result.traces.length;
      expect(ratio).toBeGreaterThan(0.25);
      expect(ratio).toBeLessThan(0.4);
    });

    it('debug-proxy has elevated error rate (~15%)', () => {
      const debugTraces = result.traces.filter(
        t => t.serviceName === 'debug-proxy',
      );
      const debugErrors = debugTraces.filter(
        t => t.statusCode === 'STATUS_CODE_ERROR',
      ).length;
      const rate = debugErrors / debugTraces.length;
      expect(rate).toBeGreaterThan(0.1);
      expect(rate).toBeLessThan(0.22);
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
    it('covers all severity families once normalized', () => {
      const families = new Set(
        result.logs.map(l => normalizeSeverityText(l.severityText)),
      );
      expect(families).toContain('INFO');
      expect(families).toContain('DEBUG');
      expect(families).toContain('WARN');
      expect(families).toContain('ERROR');
    });

    it('INFO family is the most common (~50%) once normalized', () => {
      const infoLogs = result.logs.filter(
        l => normalizeSeverityText(l.severityText) === 'INFO',
      ).length;
      const ratio = infoLogs / result.logs.length;
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });

    // ── Misleading-data trap: messy severity casing/aliases ──────────
    it('stores SeverityText with mixed case + OTel aliases (verbatim)', () => {
      const raw = new Set(result.logs.map(l => l.severityText));
      // Lowercase variants must be present (naive ERROR exact-match misses these)
      expect(raw).toContain('error');
      expect(raw).toContain('info');
      // The canonical uppercase variants also appear (collector inconsistency)
      expect([...raw].some(s => s === 'ERROR')).toBe(true);
      // Aliases like `fatal`/`warning`/`information` appear in the error/warn/info families
      const hasAlias = [...raw].some(s =>
        ['fatal', 'warning', 'information'].includes(s),
      );
      expect(hasAlias).toBe(true);
    });

    it('a naive exact-match SeverityText=ERROR under-counts error rows', () => {
      const errorFamily = result.logs.filter(
        l => normalizeSeverityText(l.severityText) === 'ERROR',
      ).length;
      const exactUppercaseOnly = result.logs.filter(
        l => l.severityText === 'ERROR',
      ).length;
      // Exact uppercase match should miss a meaningful fraction of real errors.
      expect(exactUppercaseOnly).toBeLessThan(errorFamily);
      expect(exactUppercaseOnly / errorFamily).toBeLessThan(0.6);
    });

    it('severityNumber is the true OTel number for the (messy) text', () => {
      // Each variant carries its real OTel severity number — including
      // `fatal` (21), which normalizes to the ERROR text family but keeps a
      // distinct number. This is exactly the kind of inconsistency a robust
      // dashboard must tolerate.
      const expectedByText: Record<string, number> = {
        trace: 1,
        TRACE: 1,
        debug: 5,
        DEBUG: 5,
        info: 9,
        INFO: 9,
        information: 9,
        warn: 13,
        WARN: 13,
        warning: 13,
        error: 17,
        ERROR: 17,
        fatal: 21,
        FATAL: 21,
      };
      for (const l of result.logs.slice(0, 500)) {
        expect(l.severityNumber).toBe(expectedByText[l.severityText]);
      }
    });
  });

  describe('latency red herring', () => {
    it('inventory-service aggregate P95 is dominated by the admin endpoint', () => {
      const inv = result.traces.filter(
        t => t.serviceName === 'inventory-service',
      );
      const levels = inv.filter(t => t.spanName === 'GET /inventory/levels');
      const userPaths = inv.filter(t => t.spanName !== 'GET /inventory/levels');

      const p95 = (rows: typeof inv) => {
        const sorted = rows.map(t => t.durationNs).sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      };

      // The admin endpoint is much slower than the user-facing paths.
      expect(levels.length).toBeGreaterThan(0);
      const levelsP95 = p95(levels);
      const userP95 = p95(userPaths);
      // Admin export P95 is in the multi-second range (>= ~2s in ns).
      expect(levelsP95).toBeGreaterThan(2_000_000_000);
      // User paths stay sub-second.
      expect(userP95).toBeLessThan(1_000_000_000);
      // Aggregate P95 is pulled up well above the user-path P95.
      expect(p95(inv)).toBeGreaterThan(userP95);
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

    it('has a ground truth with rubric and 2-dashboard spec', () => {
      const gt = dashboardBuildScenario.groundTruth as {
        expected?: { totalTileCount?: number; dashboardCount?: number };
        rubric?: { programmatic?: unknown[]; judge?: { criteria?: unknown[] } };
      };
      expect(gt.expected?.dashboardCount).toBe(2);
      expect(gt.rubric).toBeDefined();
      expect(gt.rubric?.programmatic).toBeDefined();
      expect(gt.rubric?.judge?.criteria).toBeDefined();
      expect(gt.rubric!.programmatic!.length).toBeGreaterThan(15);
      expect(gt.rubric!.judge!.criteria!.length).toBeGreaterThanOrEqual(7);
    });
  });
});
