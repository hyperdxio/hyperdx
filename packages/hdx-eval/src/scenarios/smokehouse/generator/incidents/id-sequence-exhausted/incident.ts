import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  NEW = '1.7.1';
const MAX_ID = 2_147_483_647,
  IDS_PER_MIN = 120;
const SHIP_LEAD_MS = 35 * 60_000,
  WARN_LEAD_MS = 30 * 60_000,
  WARN_EVERY_MS = 5 * 60_000;
const shippedAt = (i: number, onset: Date) =>
  onset.getTime() - SHIP_LEAD_MS + (i - 1) * 40_000;

// orders.id is a serial int4 column; once orders_id_seq reaches the int4 maximum every insert fails,
// while orders.list reads and orders-db latency stay as they were.
export const idSequenceExhausted: Incident = {
  name: 'id-sequence-exhausted',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= shippedAt(i, onset))
        world.orders.versions[`orders-${i}`] = NEW;
    if (t < onset) return world;
    // Only POST /checkout reaches orders.create, the one handler that inserts.
    world.orders.failIf = ctx =>
      ctx.route !== 'POST /checkout'
        ? null
        : {
            status: 500,
            message:
              'error: nextval: reached maximum value of sequence "orders_id_seq" (2147483647)',
            log: {
              severity: 'ERROR',
              every: 2,
              body: 'error: nextval: reached maximum value of sequence "orders_id_seq" (2147483647)\n    at Parser.parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:287:98)\n    at insertOrder (/app/orders/create.js:31:15)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = shippedAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'orders',
          `orders-${i}`,
          NEW,
          roll,
          'INFO',
          `deployment.rollout: orders-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
    // A capacity check on orders counts down to the maximum; nobody owns it.
    const at = onset.getTime(),
      when = Math.floor(t.getTime() / WARN_EVERY_MS) * WARN_EVERY_MS;
    if (when < at - WARN_LEAD_MS || when >= at || !crossed(t, stepMs, when))
      return;
    const left = Math.round(((at - when) / 60_000) * IDS_PER_MIN);
    emitLog(
      'orders',
      `orders-${1 + ((when / WARN_EVERY_MS) % 6)}`,
      NEW,
      when,
      'WARN',
      `id capacity check: orders_id_seq on orders-db is at ${(MAX_ID - left).toLocaleString('en-US')} of ${MAX_ID.toLocaleString('en-US')}, ${left.toLocaleString('en-US')} ids left`,
      {
        'event.name': 'db.sequence.capacity',
        'db.sequence.name': 'orders_id_seq',
      },
    );
  },
};
