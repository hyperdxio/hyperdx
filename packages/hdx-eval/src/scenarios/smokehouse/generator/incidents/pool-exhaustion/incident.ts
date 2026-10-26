import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const RAMP_MS = 8 * 60_000;
const REPORT_MS = 15_000;
const frac = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// Handlers queue for a connection before they touch the store, so the wait lands in orders'
// own span time while its pg client spans stay fast.
export const poolExhaustion: Incident = {
  name: 'pool-exhaustion',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    const f = frac(t, onset);
    if (f === 0) return world;
    world.orders.latencyMs = { mean: 12 + 500 * f, sd: 4 + 150 * f };
    world.orders.failIf = ctx =>
      ctx.rng.next() >= 0.1 * f
        ? null
        : {
            status: 503,
            message:
              'TimeoutError: timed out acquiring a connection from pool orders-db',
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'TimeoutError: timed out acquiring a connection from pool orders-db after 250ms (pool size 10, 10 in use)\n    at Pool.acquire (/app/node_modules/pg-pool/index.js:45:11)\n    at createOrder (/app/orders/create.js:23:28)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const f = frac(t, onset);
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (f === 0 || !crossed(t, stepMs, when)) return;
    const pod = `orders-${1 + ((when / REPORT_MS) % 6)}`;
    emitLog(
      'orders',
      pod,
      '1.4.2',
      when,
      'WARN',
      `pool orders-db on ${pod}: 10 of 10 connections in use, ${Math.round(40 * f)} waiting`,
      { 'event.name': 'db.pool.saturated', 'db.pool.name': 'orders-db' },
    );
  },
};
