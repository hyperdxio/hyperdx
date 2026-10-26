import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const DRAIN_EVERY_MS = 4 * 60_000,
  UNREADY_MS = 25_000,
  READY_AFTER_MS = 40_000;
const NOISE_LEAD_MS = 6 * 60_000,
  NOISE_EVERY_MS = 30_000;
// Pod n of each of these services runs on node n; only auth has no preStop hook.
const ON_NODE = ['auth', 'catalog', 'cart', 'search'];
const node = (k: number, pool: string) =>
  `ip-10-0-${pool === 'general-v7' ? 4 : 5}-${10 + k}.ec2.internal`;
const drainedAt = (k: number, onset: Date) =>
  onset.getTime() + (k - 1) * DRAIN_EVERY_MS;

// A node pool upgrade drains one node every four minutes. auth closes its server on SIGTERM while
// its endpoint is still in rotation, so for about 25 s after each drain the evicted auth pod's
// share of requests is reset. Every other evicted pod sleeps in preStop first and drops nothing.
export const nodeDrain: Incident = {
  name: 'node-drain',
  defaultOnsetMs: -20 * 60_000,
  apply(t, onset, world) {
    const k = [1, 2, 3, 4, 5, 6].find(
      n =>
        t.getTime() >= drainedAt(n, onset) &&
        t.getTime() < drainedAt(n, onset) + UNREADY_MS,
    );
    if (!k) return world;
    world.auth.failIf = ctx =>
      ctx.pod !== `auth-${k}`
        ? null
        : {
            status: 503,
            message:
              'upstream connect error or disconnect/reset before headers. reset reason: connection termination',
            durationMs: ctx.rng.gauss(3, 1),
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let k = 1; k <= 6; k++) {
      const at = drainedAt(k, onset);
      for (const [n, svc] of ON_NODE.entries()) {
        const pod = `${svc}-${k}`,
          attrs = {
            'event.name': 'k8s.node.drain',
            'k8s.node.name': node(k, 'general-v7'),
          };
        if (crossed(t, stepMs, at + n * 100))
          emitLog(
            svc,
            pod,
            OLD,
            at + n * 100,
            'INFO',
            `node.drain: ${node(k, 'general-v7')} cordoned and draining for node pool upgrade general-v7 -> general-v8 (PLAT-5390), evicting ${pod}`,
            attrs,
          );
        const stop = at + 500 + n * 100;
        if (crossed(t, stepMs, stop))
          emitLog(
            svc,
            pod,
            OLD,
            stop,
            'INFO',
            svc === 'auth'
              ? `received SIGTERM on ${pod}, closing http server`
              : `preStop hook on ${pod}: sleeping 15s for endpoint removal before SIGTERM`,
            { 'event.name': 'process.shutdown' },
          );
        const up = at + READY_AFTER_MS + n * 100;
        if (crossed(t, stepMs, up))
          emitLog(
            svc,
            pod,
            OLD,
            up,
            'INFO',
            `${pod} ready on ${node(k, 'general-v8')} (pool general-v8)`,
            { 'event.name': 'process.ready' },
          );
      }
    }
    // Unrelated noise that starts shortly before the first drain.
    const when = Math.floor(t.getTime() / NOISE_EVERY_MS) * NOISE_EVERY_MS;
    if (when < onset.getTime() - NOISE_LEAD_MS || !crossed(t, stepMs, when))
      return;
    const n = when / NOISE_EVERY_MS;
    emitLog(
      'fraud',
      `fraud-${1 + (n % 6)}`,
      OLD,
      when,
      'WARN',
      `feature store lag ${30 + (n % 40)}s on fraud-${1 + (n % 6)}, scoring with stale velocity features`,
      { 'event.name': 'featurestore.lag' },
    );
  },
};
