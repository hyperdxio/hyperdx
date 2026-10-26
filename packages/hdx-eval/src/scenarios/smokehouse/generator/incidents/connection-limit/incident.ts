import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const REPORT_MS = 15_000;
const CAMPAIGN_MS = 3 * 60_000,
  CAMPAIGN_LEN_MS = 10 * 60_000;

// The data-platform team lowers max_client_conn on the pgbouncer in front of cart-db from 200 to
// 40, below the 60 connections six cart pods hold. Pods wait on their own pool and a share of
// requests fail to connect. A push campaign adds a little /cart traffic three minutes later.
export const connectionLimit: Incident = {
  name: 'connection-limit',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.cart.latencyMs = { mean: 70, sd: 30 };
    world.cart.failIf = ctx =>
      ctx.rng.next() >= 0.15
        ? null
        : {
            status: 503,
            message: 'error: no more connections allowed (max_client_conn)',
            durationMs: ctx.rng.gauss(14, 4),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'error: no more connections allowed (max_client_conn)\n    server cart-db-pooler.data.svc:6432\n    at Pool.connect (/app/node_modules/pg-pool/index.js:45:11)\n    at loadCart (/app/cart/load.js:18:24)',
            },
          };
    return world;
  },
  surge(t, onset) {
    const since = t.getTime() - onset.getTime();
    return since < CAMPAIGN_MS || since >= CAMPAIGN_MS + CAMPAIGN_LEN_MS
      ? null
      : {
          forced: { route: 'GET /cart', bff: 'mobile-bff', tenantId: 'wonka' },
          perTick: 0.03,
        };
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'cart',
        'cart-1',
        '1.4.2',
        at,
        'INFO',
        'db.config.change: pgbouncer cart-db-pooler max_client_conn 200 -> 40, reloaded (change DBA-2291 by data-platform, "right-size poolers")',
        {
          'event.name': 'db.config.change',
          'server.address': 'cart-db-pooler.data.svc',
        },
      );
    if (crossed(t, stepMs, at + CAMPAIGN_MS))
      emitLog(
        'notification',
        'notification-1',
        '1.4.2',
        at + CAMPAIGN_MS,
        'INFO',
        'campaign flash-sale-wonka: push sent to 180,000 devices for tenant wonka, deep link /cart',
        { 'event.name': 'campaign.send', 'tenant.id': 'wonka' },
      );
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (when <= at || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS,
      pod = `cart-${1 + (n % 6)}`;
    emitLog(
      'cart',
      pod,
      '1.4.2',
      when,
      'WARN',
      `pool cart-db on ${pod}: ${3 + (n % 3)} of 10 connections open, ${4 + (n % 7)} new connections refused by cart-db-pooler in the last 15s`,
      { 'event.name': 'db.pool.refused', 'db.pool.name': 'cart-db' },
    );
  },
};
