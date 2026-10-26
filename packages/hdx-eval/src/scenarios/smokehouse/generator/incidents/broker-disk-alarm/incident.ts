import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const BLOCKED_SHARE = 0.5,
  BLOCKED_REPORT_MS = 30_000;
const SYNC_LEAD_MS = 3 * 60_000,
  SYNC_MS = 9 * 60_000,
  SYNC_TOTAL = 48_210;

// rabbitmq-0 crossed its disk free limit and blocks every publishing connection. orders spreads its
// publishers over rabbitmq-0 and rabbitmq-1, so about half of orders.create calls wait on a publish that never returns.
export const brokerDiskAlarm: Incident = {
  name: 'broker-disk-alarm',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.orders.failIf = ctx =>
      ctx.route !== 'POST /checkout' || ctx.rng.next() >= BLOCKED_SHARE
        ? null
        : {
            status: 503,
            message:
              'PublishTimeoutError: order-events publish waited 2000ms on a blocked connection to rabbitmq-0',
            durationMs: ctx.rng.gauss(2010, 10),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'PublishTimeoutError: order-events publish waited 2000ms on a blocked connection to rabbitmq-0\n    at ConfirmChannel.publishAsync (/app/orders/outbox.js:57:15)\n    at createOrder (/app/orders/create.js:41:11)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime(),
      amqp = {
        'event.name': 'amqp.connection',
        'server.address': 'rabbitmq-0',
      };
    for (let i = 1; i <= 6; i++) {
      const when = at + i * 1000;
      if (crossed(t, stepMs, when))
        emitLog(
          'orders',
          `orders-${i}`,
          OLD,
          when,
          'WARN',
          `amqp: connection.blocked received from rabbitmq-0 on orders-${i}: low on disk (free 1.9 GiB, disk_free_limit 2 GiB), publishes on this connection will wait`,
          amqp,
        );
    }
    const report =
      Math.floor(t.getTime() / BLOCKED_REPORT_MS) * BLOCKED_REPORT_MS;
    if (report > at + 6000 && crossed(t, stepMs, report)) {
      const n = report / BLOCKED_REPORT_MS,
        pod = `orders-${1 + (n % 6)}`;
      emitLog(
        'orders',
        pod,
        OLD,
        report,
        'WARN',
        `amqp: publisher on ${pod} blocked for ${Math.round((report - at) / 1000)}s by rabbitmq-0 (resource alarm: disk), ${12 + (n % 30)} publishes waiting`,
        amqp,
      );
    }
    // Unrelated: email-worker's suppression list sync, which only reads from the ESP and writes its own table.
    const start = at - SYNC_LEAD_MS,
      job = { 'event.name': 'cron.job', 'job.name': 'suppression-list-sync' };
    if (crossed(t, stepMs, start))
      emitLog(
        'email-worker',
        'email-worker-2',
        OLD,
        start,
        'INFO',
        `suppression list sync job started on email-worker-2: ${SYNC_TOTAL.toLocaleString('en-US')} addresses from esp.example.com`,
        job,
      );
    const tick = start + Math.floor((t.getTime() - start) / 60_000) * 60_000;
    if (tick > start && tick <= start + SYNC_MS && crossed(t, stepMs, tick)) {
      const done = Math.min(
        SYNC_TOTAL,
        Math.round(((tick - start) / SYNC_MS) * SYNC_TOTAL),
      );
      emitLog(
        'email-worker',
        'email-worker-2',
        OLD,
        tick,
        'INFO',
        `suppression list sync job: ${done.toLocaleString('en-US')} of ${SYNC_TOTAL.toLocaleString('en-US')} addresses merged`,
        job,
      );
    }
  },
};
