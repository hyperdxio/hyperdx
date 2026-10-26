import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NODE = 'carts-redis-0001';
const RAMP_MS = 60_000,
  HOLD_MS = 10 * 60_000,
  EASE_MS = 25 * 60_000;
const PEAK_MS = 700,
  EASED_MS = 150;
const REPORT_MS = 20_000;

// cart-db read latency: overloaded by cache misses, easing only as the cache slowly refills.
function dbMean(t: Date, onset: Date): number | null {
  const since = t.getTime() - onset.getTime();
  if (since < 0) return null;
  if (since < RAMP_MS) return 6 + ((PEAK_MS - 6) * since) / RAMP_MS;
  if (since < HOLD_MS) return PEAK_MS;
  return Math.max(
    EASED_MS,
    PEAK_MS - ((PEAK_MS - EASED_MS) * (since - HOLD_MS)) / (EASE_MS - HOLD_MS),
  );
}
const hitRatio = (mean: number) =>
  Math.round(2 + (88 * (PEAK_MS - mean)) / (PEAK_MS - 6));

// The provider replaces the carts Redis node after a hardware fault and it comes back empty.
// Every cart read falls through to cart-db, which saturates; reads the caller has given up on
// are never written back, so the cache refills slowly. Nothing changed in cart.
export const cacheStampede: Incident = {
  name: 'cache-stampede',
  defaultOnsetMs: -18 * 60_000,
  apply(t, onset, world) {
    const mean = dbMean(t, onset);
    if (mean === null) return world;
    world.cart.storeLatencyByName = { 'cart-db': { mean, sd: mean * 0.35 } };
    const share = (0.05 * mean) / PEAK_MS;
    world.cart.failIf = ctx =>
      ctx.rng.next() >= share
        ? null
        : {
            status: 500,
            message: 'Error: timeout exceeded when trying to connect',
            durationMs: ctx.rng.gauss(300, 20),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'Error: timeout exceeded when trying to connect\n    pool cart-db (100 of 100 in use, 38 waiting)\n    at Pool.connect (/app/node_modules/pg-pool/index.js:45:11)\n    at loadCart (/app/cart/load.js:22:24)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'cart',
        'cart-1',
        '1.4.2',
        at,
        'WARN',
        `cloud.event: ElastiCache node ${NODE} replaced after host hardware failure; node recovered with an empty dataset (persistence disabled)`,
        { 'event.name': 'cache.node.replaced', 'server.address': NODE },
      );
    for (let i = 1; i <= 6; i++) {
      const when = at + 2_000 + i * 300;
      if (crossed(t, stepMs, when))
        emitLog(
          'cart',
          `cart-${i}`,
          '1.4.2',
          when,
          'WARN',
          `redis carts: connection reset by peer, reconnected to ${NODE} on cart-${i} (server uptime 4s, keys 0)`,
          { 'event.name': 'redis.reconnect', 'server.address': NODE },
        );
    }
    const mean = dbMean(t, onset);
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (mean === null || when <= at || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS,
      pod = `cart-${1 + (n % 6)}`;
    emitLog(
      'cart',
      pod,
      '1.4.2',
      when,
      'INFO',
      `cart cache on ${pod}: hit ratio ${hitRatio(mean)}% over ${1600 + (n % 400)} lookups`,
      { 'event.name': 'cache.stats', 'server.address': NODE },
    );
    emitLog(
      'cart',
      pod,
      '1.4.2',
      when + 500,
      'WARN',
      `slow query on ${pod}: SELECT * FROM cart_items WHERE cart_id = $1 took ${Math.round(mean + (n % 7) * 30)}ms (cart-db active connections ${Math.round(40 + (60 * mean) / PEAK_MS)} of 100)`,
      { 'event.name': 'db.slow_query', 'server.address': 'cart-db' },
    );
  },
};
