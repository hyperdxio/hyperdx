import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const LIMIT = 4096,
  BASE_FDS = 180;
// Descriptors leaked per minute on each pod; traffic and timeouts differ a little per pod.
const LEAK_PER_MIN = [60, 64, 48, 61, 58, 55];
// shipping-5 was rescheduled after a node drain, so its process starts fresh.
const RESCHEDULED_POD = 5,
  RESCHEDULED_MS = 45 * 60_000;
const STATS_MS = 60_000,
  CARRIER_MS = 15_000;
const ORDERS_NEW = '1.7.0',
  OLD = '1.4.2';
const ordersAt = (i: number, onset: Date) =>
  onset.getTime() + 62 * 60_000 + (i - 1) * 20_000;

function fds(i: number, t: Date, onset: Date): number {
  const moved = onset.getTime() + RESCHEDULED_MS;
  const start =
    i === RESCHEDULED_POD && t.getTime() >= moved ? moved : onset.getTime();
  const up = t.getTime() - start;
  return up < 0
    ? BASE_FDS
    : Math.min(
        LIMIT,
        Math.round(BASE_FDS + (LEAK_PER_MIN[i - 1] * up) / 60_000),
      );
}

// shipping leaks a socket whenever its background carrier rate refresh is aborted on timeout.
// The UPS rate API starts timing out, and an hour later pods reach the nofile limit one by one
// and fail bookings with EMFILE. orders ships a healthy build as the first pod runs out.
export const fdLeak: Incident = {
  name: 'fd-leak',
  defaultOnsetMs: -75 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= ordersAt(i, onset))
        world.orders.versions[`orders-${i}`] = ORDERS_NEW;
    if (t < onset) return world;
    world.shipping.failIf = ctx => {
      const i = Number(ctx.pod.split('-').pop());
      if (fds(i, t, onset) < LIMIT || ctx.rng.next() >= 0.9) return null;
      return {
        status: 500,
        message: 'Error: connect EMFILE: too many open files',
        log: {
          severity: 'ERROR',
          every: 3,
          body: `Error: connect EMFILE: too many open files\n    at internalConnect (node:net:1098:16)\n    at bookShipment (/app/shipping/book.js:44:21)\n    pod ${ctx.pod} nofile limit ${LIMIT}`,
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    for (let i = 1; i <= 6; i++) {
      const when = ordersAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'orders',
          `orders-${i}`,
          ORDERS_NEW,
          when,
          'INFO',
          `deployment.rollout: orders-${i} updated ${OLD} -> ${ORDERS_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': ORDERS_NEW,
          },
        );
    }
    const moved = at + RESCHEDULED_MS;
    if (crossed(t, stepMs, moved))
      emitLog(
        'shipping',
        `shipping-${RESCHEDULED_POD}`,
        OLD,
        moved,
        'INFO',
        `k8s.event: pod shipping-${RESCHEDULED_POD} rescheduled to node ip-10-0-9-12.ec2.internal after node drain (kernel patching), container started`,
        { 'event.name': 'k8s.pod.scheduled' },
      );
    const tick = Math.floor(t.getTime() / CARRIER_MS) * CARRIER_MS;
    if (tick > at && crossed(t, stepMs, tick)) {
      const pod = `shipping-${1 + ((tick / CARRIER_MS) % 6)}`;
      emitLog(
        'shipping',
        pod,
        OLD,
        tick,
        'WARN',
        `carrier rate refresh for ups aborted on ${pod} after 3000ms timeout (api.ups-rates.example.com), keeping cached rates`,
        { 'event.name': 'carrier.refresh', 'carrier.name': 'ups' },
      );
    }
    // Emitted before onset too, so the flat baseline is there to compare against.
    const stat = Math.floor(t.getTime() / STATS_MS) * STATS_MS;
    for (let i = 1; i <= 6; i++) {
      const when = stat + i * 1_000;
      if (!crossed(t, stepMs, when)) continue;
      const n = fds(i, new Date(when), onset) + ((when / STATS_MS) % 9);
      emitLog(
        'shipping',
        `shipping-${i}`,
        OLD,
        when,
        'INFO',
        `runtime stats on shipping-${i}: open fds ${Math.min(LIMIT, n)} of ${LIMIT}, rss ${140 + ((when / STATS_MS) % 20)} MiB, event loop lag ${2 + (i % 3)}ms`,
        { 'event.name': 'runtime.stats' },
      );
    }
  },
};
