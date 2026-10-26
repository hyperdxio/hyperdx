import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const CYCLE_MS = 40_000,
  STALL_MS = 30_000,
  HEALTH_MS = 30_000;
const ARCHIVE_LEAD_MS = 21 * 60_000,
  ARCHIVE_RUN_MS = 8 * 60_000 + 11_000;
// Replay stalls behind each dashboard query until max_standby_streaming_delay cancels it, then catches up.
const lagAt = (t: number, onset: Date) => {
  if (t < onset.getTime()) return 0.2 + ((t / HEALTH_MS) % 3) / 10;
  const phase = (t - onset.getTime()) % CYCLE_MS;
  return phase < STALL_MS ? phase / 1000 : 0.3;
};

// The finance team's month-end dashboard refresh runs long queries on orders-db-replica-1. The replica
// pauses WAL replay for each one, so orders written moments ago are missing there, and shipping reads
// the order it is booking from that replica. orders and its primary are untouched.
export const replicaLag: Incident = {
  name: 'replica-lag',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    if (lagAt(t.getTime(), onset) < 1) return world;
    world.shipping.failIf = ctx => ({
      status: 500,
      message:
        'OrderNotFoundError: order not found in orders-db-replica-1 after 3 reads',
      durationMs: ctx.rng.gauss(318, 8),
      log: {
        severity: 'ERROR',
        every: 3,
        body: `OrderNotFoundError: order ord_${Math.floor(ctx.rng.next() * 0xffffff).toString(16)} not found in orders-db-replica-1 after 3 reads 100ms apart\n    at loadOrder (/app/shipping/orders-reader.js:31:13)\n    at bookShipment (/app/shipping/book.js:22:20)`,
      },
    });
    return world;
  },
  events(t, onset, stepMs) {
    const archive = onset.getTime() - ARCHIVE_LEAD_MS,
      attrs = { 'event.name': 'cron.job', 'job.name': 'orders-archive' };
    if (crossed(t, stepMs, archive))
      emitLog(
        'orders',
        'orders-2',
        OLD,
        archive,
        'INFO',
        'cron: orders-archive started on orders-2: moving orders older than 540 days from orders-db to s3://orders-archive in batches of 2,000',
        attrs,
      );
    if (crossed(t, stepMs, archive + ARCHIVE_RUN_MS))
      emitLog(
        'orders',
        'orders-2',
        OLD,
        archive + ARCHIVE_RUN_MS,
        'INFO',
        'cron: orders-archive finished on orders-2 in 8m11s, 61,204 orders archived, 0 failures',
        attrs,
      );
    const when = Math.floor(t.getTime() / HEALTH_MS) * HEALTH_MS;
    if (!crossed(t, stepMs, when)) return;
    const n = when / HEALTH_MS,
      pod = `orders-${1 + (n % 6)}`,
      lag = lagAt(when, onset);
    emitLog(
      'orders',
      pod,
      OLD,
      when,
      'INFO',
      `db health orders-db: primary connections ${40 + (n % 25)}/200, replica orders-db-replica-1 replay lag ${lag.toFixed(1)}s`,
      { 'event.name': 'db.health', 'server.address': 'orders-db' },
    );
    if (lag >= 5)
      emitLog(
        'orders',
        pod,
        OLD,
        when,
        'WARN',
        `orders-db-replica-1 WAL replay waiting ${lag.toFixed(0)}s on conflicting query: pid ${48812 + Math.floor((when - onset.getTime()) / CYCLE_MS)} user bi_readonly application_name finance-month-end-refresh (max_standby_streaming_delay 30s)`,
        {
          'event.name': 'db.replica.conflict',
          'server.address': 'orders-db-replica-1',
        },
      );
  },
};
