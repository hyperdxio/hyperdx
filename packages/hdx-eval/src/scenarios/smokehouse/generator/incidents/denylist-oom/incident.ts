import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  PROMO_NEW = '1.4.5';
const PICKUP_STEP_MS = 45_000,
  LOAD_MS = 40_000,
  MAX_BACKOFF_MS = 300_000,
  CYCLES = 40,
  REPORT_MS = 30_000;
const ROLL_LEAD_MS = 12 * 60_000,
  ROLL_STEP_MS = 30_000;
const pickedAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * PICKUP_STEP_MS;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;

// Each load starts the pod (or its refresh) and ends in an OOMKill; kubelet then waits out the crashloop backoff.
function cycles(i: number, onset: Date): Array<{ load: number; kill: number }> {
  const out: Array<{ load: number; kill: number }> = [];
  for (let k = 0, at = pickedAt(i, onset); k < CYCLES; k++) {
    out.push({ load: at, kill: at + LOAD_MS });
    at += LOAD_MS + Math.min(MAX_BACKOFF_MS, 10_000 * 2 ** k);
  }
  return out;
}
const loading = (i: number, t: number, onset: Date) =>
  cycles(i, onset).some(c => t >= c.load && t < c.kill);

// trust-safety publishes a denylist twenty times the usual size. Each fraud pod picks it up on its
// refresh, runs out of memory building the index, and crashloops; while a pod loads, its TCP readiness
// probe passes and it answers 503. The share fails in bursts that thin out as the backoff grows.
export const denylistOom: Incident = {
  name: 'denylist-oom',
  defaultOnsetMs: -16 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.promo.versions[`promo-${i}`] = PROMO_NEW;
    if (t < onset) return world;
    const down = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => loading(i, t.getTime(), onset))
        .map(i => `fraud-${i}`),
    );
    if (down.size === 0) return world;
    world.fraud.failIf = ctx =>
      !down.has(ctx.pod)
        ? null
        : {
            status: 503,
            message: 'fraud not ready: denylist ts-denylist v412 still loading',
            durationMs: ctx.rng.gauss(3, 1),
            log: {
              severity: 'WARN',
              every: 6,
              body: `fraud not ready on ${ctx.pod}: denylist ts-denylist v412 still loading, answering 503`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = rolledAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'promo',
          `promo-${i}`,
          PROMO_NEW,
          roll,
          'INFO',
          `deployment.rollout: promo-${i} updated ${OLD} -> ${PROMO_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': PROMO_NEW,
          },
        );
      const pod = `fraud-${i}`;
      cycles(i, onset).forEach((c, k) => {
        if (crossed(t, stepMs, c.load))
          emitLog(
            'fraud',
            pod,
            OLD,
            c.load,
            'INFO',
            k === 0
              ? `denylist refresh on ${pod}: fetched ts-denylist v412 from s3://trust-safety-lists (2,140,000 entries, was v411 with 91,377), building in-memory index`
              : `fraud ${OLD} starting on ${pod}: loading denylist ts-denylist v412 (2,140,000 entries)`,
            { 'event.name': 'fraud.denylist.load', 'denylist.version': 'v412' },
          );
        if (crossed(t, stepMs, c.kill))
          emitLog(
            'fraud',
            pod,
            OLD,
            c.kill,
            'WARN',
            `container fraud on ${pod} restarted: last state OOMKilled (exit code 137), memory limit 1536Mi, restart count ${k + 1}`,
            { 'event.name': 'k8s.container.restart' },
          );
      });
    }
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (when <= onset.getTime() || !crossed(t, stepMs, when)) return;
    const down = [1, 2, 3, 4, 5, 6].filter(i => loading(i, when, onset)).length;
    if (down === 0) return;
    const n = when / REPORT_MS;
    emitLog(
      'checkout',
      `checkout-${1 + (n % 6)}`,
      OLD,
      when,
      'WARN',
      `checkout-${1 + (n % 6)}: ${down * (1 + (n % 3))} fraud.score calls answered 503 in the last 30s, orders not placed`,
      { 'event.name': 'upstream.errors' },
    );
  },
};
