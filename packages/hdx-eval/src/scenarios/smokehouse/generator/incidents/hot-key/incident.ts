import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import { TENANTS } from '../../world';
import type { Incident } from '../index';

const HOT_KEY = 'price:sku-4411';
const SHARD = 'price-cache-0003-001.cache.internal:6379';
const PRODUCT = 'GET /product/{id}';
const RAMP_MS = 4 * 60_000,
  TAIL_MS = 40 * 60_000;
// Extra product views per tick at the peak; the base mix sends about 0.2 per tick.
const PEAK_EXTRA = 0.3;
const REPORT_MS = 20_000;
const CATALOG_NEW = '1.6.0',
  OLD = '1.4.2';
const catalogAt = (i: number, onset: Date) =>
  onset.getTime() - 3 * 60_000 + (i - 1) * 20_000;

// Clicks arrive over four minutes as the email lands, then tail off slowly.
function load(t: Date, onset: Date): number {
  const since = t.getTime() - onset.getTime();
  if (since < 0) return 0;
  return since < RAMP_MS
    ? since / RAMP_MS
    : Math.max(0.5, 1 - (since - RAMP_MS) / TAIL_MS);
}

// A marketing email sends every tenant to one product. Every quote for it reads one Redis key,
// so one price-cache shard saturates and times out for every key it holds. catalog ships a
// healthy build just before.
export const hotKey: Incident = {
  name: 'hot-key',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= catalogAt(i, onset))
        world.catalog.versions[`catalog-${i}`] = CATALOG_NEW;
    const f = load(t, onset);
    if (f === 0) return world;
    const hotShare = (PEAK_EXTRA * f) / (PEAK_EXTRA * f + 0.2);
    world.pricing.failIf = ctx => {
      const hot = ctx.route === PRODUCT && ctx.rng.next() < hotShare;
      // A sixth of the other keys hash to the same shard.
      if (!hot && ctx.rng.next() >= 1 / 6) return null;
      if (ctx.rng.next() >= 0.6 * f) return null;
      const key = hot
        ? HOT_KEY
        : `price:sku-${1000 + Math.floor(ctx.rng.next() * 9000)}`;
      return {
        status: 503,
        message: `TimeoutError: Command timed out after 250ms: GET ${key}`,
        durationMs: ctx.rng.gauss(262, 8),
        log: {
          severity: 'ERROR',
          every: 3,
          body: `TimeoutError: Command timed out after 250ms: GET ${key}\n    server ${SHARD}\n    at RedisClient.get (/app/node_modules/ioredis/built/Redis.js:312:21)\n    at quote (/app/pricing/quote.js:27:30)`,
        },
      };
    };
    return world;
  },
  surge(t, onset) {
    const f = load(t, onset);
    if (f === 0) return null;
    const s = Math.floor(t.getTime() / 1000);
    return {
      forced: {
        route: PRODUCT,
        bff: s % 5 < 3 ? 'mobile-bff' : 'web-bff',
        tenantId: TENANTS[s % TENANTS.length][0],
      },
      perTick: PEAK_EXTRA * f,
    };
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = catalogAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'catalog',
          `catalog-${i}`,
          CATALOG_NEW,
          when,
          'INFO',
          `deployment.rollout: catalog-${i} updated ${OLD} -> ${CATALOG_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': CATALOG_NEW,
          },
        );
    }
    const send = onset.getTime() - 60_000;
    if (crossed(t, stepMs, send))
      emitLog(
        'email-worker',
        'email-worker-2',
        OLD,
        send,
        'INFO',
        'campaign fall-drop-2026: 2,400,000 emails queued for subscribers of all tenants, primary link /product/sku-4411 ("48 hours only")',
        { 'event.name': 'campaign.send', 'campaign.id': 'fall-drop-2026' },
      );
    const f = load(t, onset);
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (f < 0.3 || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS,
      pod = `pricing-${1 + (n % 6)}`;
    emitLog(
      'pricing',
      pod,
      OLD,
      when,
      'WARN',
      `redis client on ${pod}: price-cache shard 0003 p99 ${235 + (n % 15)}ms, ${Math.round((120 + (n % 60)) * f)} command timeouts in the last 20s; shards 0001-0002 and 0004-0006 p99 under 2ms`,
      {
        'event.name': 'redis.client.stats',
        'db.system': 'redis',
        'server.address': SHARD,
      },
    );
  },
};
