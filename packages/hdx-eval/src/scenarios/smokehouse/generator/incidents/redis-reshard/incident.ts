import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  CATALOG_NEW = '1.8.3';
const MIGRATE_MS = 30 * 60_000,
  MOVING = 4096,
  SLOTS = 16384,
  PROGRESS_MS = 60_000;
const SHARD = 'carts-0004-001',
  SHARD_IP = '10.0.12.44';
const migrated = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / MIGRATE_MS);
const catalogAt = (i: number, onset: Date) =>
  onset.getTime() - 8 * 60_000 + (i - 1) * 40_000;

// The platform team reshards the carts Redis cluster online. cart's client has redirects turned off,
// so every key whose slot has already moved answers MOVED and cart fails the read.
export const redisReshard: Incident = {
  name: 'redis-reshard',
  defaultOnsetMs: -15 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= catalogAt(i, onset))
        world.catalog.versions[`catalog-${i}`] = CATALOG_NEW;
    const f = migrated(t, onset);
    if (f === 0) return world;
    world.cart.failIf = ctx => {
      if (ctx.rng.next() >= (MOVING / SLOTS) * f) return null;
      const slot = SLOTS - MOVING + Math.floor(ctx.rng.next() * MOVING * f);
      return {
        status: 500,
        message: `Too many Cluster redirections. Last error: ReplyError: MOVED to ${SHARD_IP}:6379`,
        durationMs: ctx.rng.gauss(5, 2),
        log: {
          severity: 'ERROR',
          every: 3,
          body: `ReplyError: MOVED ${slot} ${SHARD_IP}:6379 reading cart:${ctx.attrs.tenantId}:${Math.floor(ctx.rng.next() * 1e6)} (maxRedirections 0)\n    at Cluster.handleError (/app/node_modules/ioredis/built/cluster/index.js:612:23)\n    at getCart (/app/cart/get.js:31:17)`,
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = catalogAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'catalog',
          `catalog-${i}`,
          CATALOG_NEW,
          roll,
          'INFO',
          `deployment.rollout: catalog-${i} updated ${OLD} -> ${CATALOG_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': CATALOG_NEW,
          },
        );
    }
    const at = onset.getTime(),
      attrs = {
        'event.name': 'cache.cluster.reshard',
        'server.address': 'carts',
      };
    if (crossed(t, stepMs, at))
      emitLog(
        'cart',
        'cart-2',
        OLD,
        at,
        'INFO',
        `cloud.event: online resharding of ElastiCache replication group carts started by platform (PLAT-6120): 3 -> 4 shards, ${MOVING.toLocaleString('en-US')} hash slots moving to ${SHARD} (${SHARD_IP})`,
        attrs,
      );
    const when = Math.floor(t.getTime() / PROGRESS_MS) * PROGRESS_MS;
    if (when > at && crossed(t, stepMs, when)) {
      emitLog(
        'cart',
        'cart-2',
        OLD,
        when,
        'INFO',
        `cloud.event: carts resharding PLAT-6120 in progress: ${Math.round(MOVING * migrated(new Date(when), onset))} of ${MOVING.toLocaleString('en-US')} slots moved to ${SHARD}`,
        attrs,
      );
    }
  },
};
