import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const PARTITION_MS = 40_000;
// The broker hits its memory watermark this long after the partition, once enough unacked messages pile up.
const ALARM_MS = 11 * 60_000;
const RAMP_MS = 8 * 60_000;
const STATS_MS = 30_000,
  BLOCKED_MS = 20_000;
const VACUUM_MS = 9 * 60_000;
// Messages email-worker has been delivered but never acked, as its own client counts them.
const awaiting = (since: number) =>
  since < PARTITION_MS ? 0 : Math.round(((since - PARTITION_MS) / 1000) * 290);

function blockedShare(t: Date, onset: Date): number {
  const since = t.getTime() - onset.getTime() - ALARM_MS;
  return since < 0 ? 0 : Math.min(0.65, 0.25 + (0.4 * since) / RAMP_MS);
}

// A short network partition drops email-worker's broker connection. After it reconnects it keeps
// consuming and sending mail, but its acks go to the dead channel, so the broker holds every message
// until its memory alarm blocks publishers and orders can no longer publish order events.
export const queueBackpressure: Incident = {
  name: 'queue-backpressure',
  defaultOnsetMs: -20 * 60_000,
  apply(t, onset, world) {
    const share = blockedShare(t, onset);
    if (share === 0) return world;
    world.orders.failIf = ctx =>
      ctx.route !== 'POST /checkout' || ctx.rng.next() >= share
        ? null
        : {
            status: 503,
            message:
              'AmqpPublishTimeout: publish to exchange orders.events not confirmed within 1000ms (connection blocked: low on memory)',
            durationMs: ctx.rng.gauss(1010, 15),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'AmqpPublishTimeout: publish to exchange orders.events not confirmed within 1000ms\n    connection blocked by broker rabbitmq-0.mq.svc: low on memory\n    at ConfirmChannel.publishConfirmed (/app/orders/events.js:58:17)\n    at createOrder (/app/orders/create.js:73:11)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    for (let i = 1; i <= 6; i++) {
      const pod = `email-worker-${i}`;
      if (crossed(t, stepMs, at + i * 300))
        emitLog(
          'email-worker',
          pod,
          OLD,
          at + i * 300,
          'WARN',
          `amqp connection to rabbitmq-1.mq.svc:5672 lost on ${pod}: heartbeat timeout (ETIMEDOUT)`,
          { 'event.name': 'amqp.connection.lost' },
        );
      const back = at + PARTITION_MS + i * 300;
      if (crossed(t, stepMs, back))
        emitLog(
          'email-worker',
          pod,
          OLD,
          back,
          'INFO',
          `amqp reconnected on ${pod} to rabbitmq-0.mq.svc:5672, channel recovered, consumer order-events resumed (prefetch 0, manual ack)`,
          { 'event.name': 'amqp.connection.recovered' },
        );
      const alarm = at + ALARM_MS + i * 400;
      if (crossed(t, stepMs, alarm))
        emitLog(
          'orders',
          `orders-${i}`,
          OLD,
          alarm,
          'WARN',
          `amqp connection on orders-${i} blocked by broker rabbitmq-0.mq.svc: low on memory (connection.blocked)`,
          { 'event.name': 'amqp.connection.blocked' },
        );
    }
    const vacuum = at + VACUUM_MS;
    if (crossed(t, stepMs, vacuum))
      emitLog(
        'orders',
        'orders-2',
        OLD,
        vacuum,
        'WARN',
        'pg notice from orders-db: automatic vacuum of table public.orders to prevent wraparound started, estimated 25 minutes, expect elevated IO',
        { 'event.name': 'db.notice', 'server.address': 'orders-db' },
      );
    // Emitted before onset too, so the healthy ack counts are there to compare against.
    const stat = Math.floor(t.getTime() / STATS_MS) * STATS_MS;
    if (crossed(t, stepMs, stat)) {
      const n = stat / STATS_MS,
        pod = `email-worker-${1 + (n % 6)}`,
        since = stat - at;
      const delivered = 180 + (n % 60),
        acked = since >= PARTITION_MS ? 0 : delivered;
      emitLog(
        'email-worker',
        pod,
        OLD,
        stat,
        'INFO',
        `order-events consumer on ${pod}: ${delivered} delivered, ${delivered} mailed, ${acked} acked in the last 30s; ${awaiting(since).toLocaleString('en-US')} deliveries awaiting ack`,
        { 'event.name': 'amqp.consumer.stats' },
      );
    }
    const blocked = Math.floor(t.getTime() / BLOCKED_MS) * BLOCKED_MS;
    if (
      blockedShare(new Date(blocked), onset) > 0 &&
      crossed(t, stepMs, blocked)
    ) {
      const n = blocked / BLOCKED_MS;
      emitLog(
        'orders',
        `orders-${1 + (n % 6)}`,
        OLD,
        blocked,
        'WARN',
        `publisher orders.events on orders-${1 + (n % 6)}: connection blocked ${12 + (n % 8)}s of the last 20s, ${20 + (n % 30)} publishes waiting for confirm`,
        { 'event.name': 'amqp.publisher.stats' },
      );
    }
  },
};
