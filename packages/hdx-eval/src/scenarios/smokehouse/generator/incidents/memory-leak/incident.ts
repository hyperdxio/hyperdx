import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NEW = '1.5.0',
  OLD = '1.4.2';
const ROLL_STEP_MS = 15_000;
// Minutes from start to OOMKill for each pod; traffic differs a little per pod, so they fill unevenly.
const FILL_MIN = [38, 41, 43, 36, 46, 48];
const GC_REPORT_MS = 20_000;
const RESTART_MS = 10_000;
const DISTRACTOR_MS = 33 * 60_000;
const NOTIFY = '1.6.0';

const rolledAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * ROLL_STEP_MS;
const notifiedAt = (i: number, onset: Date) =>
  onset.getTime() + DISTRACTOR_MS + (i - 1) * 5_000;
// Heap fill in [0, 1) and restart count, for pod i at time t; null before it runs 1.5.0.
function heap(
  i: number,
  t: Date,
  onset: Date,
): { fill: number; restarts: number; sinceStart: number } | null {
  const up = t.getTime() - rolledAt(i, onset);
  if (up < 0) return null;
  const period = FILL_MIN[i - 1] * 60_000;
  return {
    fill: (up % period) / period,
    restarts: Math.floor(up / period),
    sinceStart: up % period,
  };
}
// GC pressure only bites once the heap is past half full, then grows fast.
const gc = (fill: number) => Math.max(0, (fill - 0.55) / 0.45) ** 2;

// cart 1.5.0 leaks heap. It serves cleanly for twenty minutes, then GC pauses grow until each
// pod is OOMKilled and starts over. notification ships a healthy build as the timeouts climb.
export const memoryLeak: Incident = {
  name: 'memory-leak',
  defaultOnsetMs: -45 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= notifiedAt(i, onset))
        world.notification.versions[`notification-${i}`] = NOTIFY;
    const podLatencyMs: Record<string, { mean: number; sd: number }> = {};
    const restarting = new Set<string>();
    for (let i = 1; i <= 6; i++) {
      const h = heap(i, t, onset);
      if (!h) continue;
      const pod = `cart-${i}`;
      world.cart.versions[pod] = NEW;
      const g = gc(h.fill);
      if (g > 0) podLatencyMs[pod] = { mean: 12 + 700 * g, sd: 4 + 380 * g };
      if (h.restarts > 0 && h.sinceStart < RESTART_MS) restarting.add(pod);
    }
    if (Object.keys(podLatencyMs).length)
      world.cart.podLatencyMs = podLatencyMs;
    if (restarting.size)
      world.cart.failIf = ctx =>
        !restarting.has(ctx.pod) || ctx.rng.next() >= 0.8
          ? null
          : {
              status: 503,
              message: `upstream connect error: connection reset by peer (${ctx.pod} restarting)`,
            };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'cart',
          `cart-${i}`,
          NEW,
          when,
          'INFO',
          `deployment.rollout: cart-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
      const h = heap(i, t, onset);
      if (!h) continue;
      const pod = `cart-${i}`;
      if (h.restarts > 0 && h.sinceStart < stepMs) {
        const at = t.getTime() - h.sinceStart;
        emitLog(
          'cart',
          pod,
          NEW,
          at - 5,
          'ERROR',
          'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
          { 'event.name': 'runtime.oom' },
        );
        emitLog(
          'cart',
          pod,
          NEW,
          at,
          'WARN',
          `k8s.event: container cart in ${pod} terminated, reason OOMKilled, exit code 137, restart count ${h.restarts}`,
          {
            'event.name': 'k8s.container.terminated',
            'k8s.container.restart_count': String(h.restarts),
          },
        );
      }
      const when2 =
        Math.floor(t.getTime() / GC_REPORT_MS) * GC_REPORT_MS + i * 1_000;
      if (gc(h.fill) > 0.05 && crossed(t, stepMs, when2)) {
        emitLog(
          'cart',
          pod,
          NEW,
          when2,
          'WARN',
          `gc: mark-compact pause ${Math.round(80 + 1400 * gc(h.fill))}ms on ${pod}, heap ${(0.4 + 1.44 * h.fill).toFixed(2)} GiB of 1.84 GiB limit`,
          { 'event.name': 'runtime.gc' },
        );
      }
    }
    for (let i = 1; i <= 6; i++) {
      const when = notifiedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'notification',
          `notification-${i}`,
          NOTIFY,
          when,
          'INFO',
          `deployment.rollout: notification-${i} updated ${OLD} -> ${NOTIFY} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NOTIFY,
          },
        );
    }
  },
};
