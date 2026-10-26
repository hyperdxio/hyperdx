import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD_IP = '10.0.4.17',
  NEW_IP = '10.0.4.23';
// Minutes after the switchover that each inventory pod's cached DNS entry for inventory-db expires.
const HEAL_MIN = [9, 13, 18, 25, 31, 36];
const SHIPPING_MS = -3 * 60_000;
const SHIP_NEW = '1.5.1',
  OLD = '1.4.2';

const healedAt = (i: number, onset: Date) =>
  onset.getTime() + HEAL_MIN[i - 1] * 60_000;
const shippedAt = (i: number, onset: Date) =>
  onset.getTime() + SHIPPING_MS + (i - 1) * 20_000;

// A planned switchover demotes inventory-db-a to a read-only standby. inventory's resolver caches
// the old address for thirty minutes, so its pods reconnect to the standby and every reservation
// write fails until their cache entry expires. shipping ships a healthy build just before.
export const dbSwitchover: Incident = {
  name: 'db-switchover',
  defaultOnsetMs: -22 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= shippedAt(i, onset))
        world.shipping.versions[`shipping-${i}`] = SHIP_NEW;
    if (t < onset) return world;
    world.inventory.failIf = ctx =>
      t.getTime() >= healedAt(Number(ctx.pod.split('-').pop()), onset)
        ? null
        : {
            status: 500,
            message: 'error: cannot execute UPDATE in a read-only transaction',
            durationMs: ctx.rng.gauss(9, 3),
            log: {
              severity: 'ERROR',
              every: 3,
              body: `error: cannot execute UPDATE in a read-only transaction (SQLSTATE 25006, server ${OLD_IP} inventory-db-a)\n    at Connection.parseE (/app/node_modules/pg/lib/connection.js:614:13)\n    at reserveStock (/app/inventory/reserve.js:41:19)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = shippedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'shipping',
          `shipping-${i}`,
          SHIP_NEW,
          when,
          'INFO',
          `deployment.rollout: shipping-${i} updated ${OLD} -> ${SHIP_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': SHIP_NEW,
          },
        );
    }
    const at = onset.getTime();
    if (crossed(t, stepMs, at - 40_000))
      emitLog(
        'inventory',
        'inventory-1',
        OLD,
        at - 40_000,
        'INFO',
        'db.notice: inventory-db planned switchover for host maintenance MAINT-1184 starting: inventory-db-b will be promoted, inventory-db-a demoted to standby',
        { 'event.name': 'db.notice' },
      );
    for (let i = 1; i <= 6; i++) {
      const pod = `inventory-${i}`;
      if (crossed(t, stepMs, at + i * 250))
        emitLog(
          'inventory',
          pod,
          OLD,
          at + i * 250,
          'WARN',
          `pool inventory-db on ${pod}: connections terminated by administrator command, reconnecting to inventory-db.internal (${OLD_IP}, cached)`,
          { 'event.name': 'db.pool.reconnect', 'server.address': OLD_IP },
        );
      const healed = healedAt(i, onset);
      if (crossed(t, stepMs, healed))
        emitLog(
          'inventory',
          pod,
          OLD,
          healed,
          'INFO',
          `dns: inventory-db.internal re-resolved ${OLD_IP} -> ${NEW_IP} on ${pod} (cache ttl 1800s expired), pool reconnected`,
          { 'event.name': 'dns.refresh', 'server.address': NEW_IP },
        );
    }
  },
};
