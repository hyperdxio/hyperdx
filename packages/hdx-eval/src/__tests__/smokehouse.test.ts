import { loadScenarioRubric } from '@/grading/rubric';
import { mulberry32 } from '@/rng/seeded';
import { SCENARIOS } from '@/scenarios';
import { INCIDENTS } from '@/scenarios/smokehouse/generator/incidents';
import { GROUND_TRUTH } from '@/scenarios/smokehouse/groundTruth';
import {
  SMOKEHOUSE_PREFIX,
  SMOKEHOUSE_SCENARIOS,
  smokehouseGroundTruth,
} from '@/scenarios/smokehouse/scenario';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-08T12:00:00.000Z');
const VOLUME = 0.05;

function run(seed: number) {
  return SMOKEHOUSE_SCENARIOS['sh-cache-stampede'].generate({
    rng: mulberry32(seed),
    nowMs: NOW_MS,
    volumeFactor: VOLUME,
  });
}

describe('smokehouse scenario family', () => {
  const result = collectScenario(run(42));
  const onsetMs = NOW_MS - 18 * 60_000;

  it('registers every incident under the sh- prefix', () => {
    expect(SMOKEHOUSE_SCENARIOS['sh-cache-stampede']).toBeDefined();
    const names = Object.keys(SMOKEHOUSE_SCENARIOS);
    expect(names.length).toBeGreaterThanOrEqual(80);
    expect(names.every(n => n.startsWith(SMOKEHOUSE_PREFIX))).toBe(true);
    expect(SCENARIOS['sh-cache-stampede']).toBe(
      SMOKEHOUSE_SCENARIOS['sh-cache-stampede'],
    );
  });

  it('emits gateway server spans and cart-db client spans', () => {
    expect(
      result.traces.some(
        t =>
          t.serviceName === 'edge-gateway' && t.spanKind === 'SPAN_KIND_SERVER',
      ),
    ).toBe(true);
    expect(
      result.traces.some(
        t =>
          t.serviceName === 'cart' &&
          t.spanKind === 'SPAN_KIND_CLIENT' &&
          t.spanAttributes['db.system'] === 'postgresql' &&
          t.spanAttributes['server.address'] === 'cart-db',
      ),
    ).toBe(true);
    expect(result.traces[0].resourceAttributes).toEqual(
      expect.objectContaining({
        'service.name': expect.any(String),
        'service.version': expect.any(String),
        'k8s.pod.name': expect.any(String),
      }),
    );
  });

  it('plants the failure at onset, above background noise', () => {
    const gateway = result.traces.filter(
      t =>
        t.serviceName === 'edge-gateway' && t.spanKind === 'SPAN_KIND_SERVER',
    );
    const rate = (rows: typeof gateway) =>
      rows.filter(t => t.statusCode === 'STATUS_CODE_ERROR').length /
      Math.max(rows.length, 1);
    const before = gateway.filter(t => t.timestampMs < onsetMs);
    const after = gateway.filter(t => t.timestampMs >= onsetMs);
    expect(rate(before)).toBeLessThan(0.01);
    expect(rate(after)).toBeGreaterThan(0.1);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = collectScenario(run(7)).traces[0].traceId;
    expect(collectScenario(run(7)).traces[0].traceId).toBe(a);
    expect(collectScenario(run(8)).traces[0].traceId).not.toBe(a);
  });

  it('batches rows to batchSize', () => {
    const sizes = [
      ...SMOKEHOUSE_SCENARIOS['sh-cache-stampede'].generate({
        rng: mulberry32(1),
        nowMs: NOW_MS,
        volumeFactor: 0.01,
        batchSize: 500,
      }),
    ].map(b => b.traces.length + b.logs.length);
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes.slice(0, -1).every(n => n >= 500)).toBe(true);
  });

  it('names the alerting service in the prompt', () => {
    const gt = smokehouseGroundTruth('sh-cache-stampede');
    expect(gt.expected.originService).toBe('cart');
    expect(SMOKEHOUSE_SCENARIOS['sh-cache-stampede'].agentPrompt).toContain(
      gt.expected.affectedService ?? gt.expected.originService,
    );
  });
});

describe('smokehouse registry', () => {
  it('has a ground truth for every incident', () => {
    for (const name of Object.keys(INCIDENTS)) {
      expect(GROUND_TRUTH[name]).toBeDefined();
    }
  });

  it('loads every rubric through the real loader', () => {
    for (const name of Object.keys(SMOKEHOUSE_SCENARIOS)) {
      expect(loadScenarioRubric(name).programmatic.length).toBeGreaterThan(0);
    }
  });
});
