import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const CDC_POD = 'orders-cdc-0';
const STALL_MS = -50 * 60_000;
const DISK_REPORT_MS = 5 * 60_000;

// The CDC connector reading orders-db's logical replication slot dies; Postgres keeps every WAL
// segment for the slot until the volume fills. Inserts then fail while reads carry on.
export const diskFull: Incident = {
  name: 'disk-full',
  defaultOnsetMs: -7 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.orders.failIf = ctx =>
      ctx.route !== 'POST /checkout'
        ? null
        : {
            status: 500,
            message:
              'error: could not extend file "base/16384/24601": No space left on device',
            durationMs: ctx.rng.gauss(14, 4),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'error: could not extend file "base/16384/24601": No space left on device\n    hint: Check free disk space.\n    at PgConnection.query (/app/node_modules/pg/lib/client.js:526:17)\n    at createOrder (/app/orders/create.js:48:19)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const stall = onset.getTime() + STALL_MS;
    if (crossed(t, stepMs, stall)) {
      emitLog(
        'orders',
        CDC_POD,
        '1.4.2',
        stall,
        'ERROR',
        'connector orders-cdc task 0 failed: TimeoutException: Topic orders.public.orders not present in metadata after 60000 ms; task stopped, no automatic restart',
        { 'event.name': 'cdc.task.failed' },
      );
    }
    const when = Math.floor(t.getTime() / DISK_REPORT_MS) * DISK_REPORT_MS;
    if (when <= stall || !crossed(t, stepMs, when)) return;
    const f = Math.min(1, (when - stall) / -STALL_MS);
    const pct = Math.min(100, Math.round(62 + 38 * f));
    emitLog(
      'orders',
      `orders-${1 + ((when / DISK_REPORT_MS) % 6)}`,
      '1.4.2',
      when,
      pct >= 90 ? 'WARN' : 'INFO',
      `db health: orders-db volume ${pct}% used, pg_wal ${Math.round(4 + 60 * f)} GiB retained for inactive replication slot orders_cdc`,
      { 'event.name': 'db.health', 'server.address': 'orders-db' },
    );
  },
};
