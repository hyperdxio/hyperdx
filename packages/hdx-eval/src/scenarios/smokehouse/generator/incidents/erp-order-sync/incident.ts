import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 3 * 60_000,
  PER_TICK = 0.08,
  PAGE_MS = 20_000,
  SLOW_MS = 30_000,
  SMTP_MS = 30_000;
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// globex switches on an ERP connector that pages through all its orders 5,000 at a time. Each page is an
// expensive scan on orders-db, so every query there slows, including checkout's order inserts.
export const erpOrderSync: Incident = {
  name: 'erp-order-sync',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    const f = ramp(t, onset);
    if (f === 0) return world;
    world.orders.storeLatencyMs = { mean: 6 + 120 * f, sd: 3 + 50 * f };
    world.orders.delayMs = ctx =>
      ctx.attrs.tenantId === 'globex' && ctx.route === 'GET /orders'
        ? Math.max(0, ctx.rng.gauss(260, 80)) * f
        : 0;
    return world;
  },
  surge: (t, onset) =>
    t < onset
      ? null
      : {
          forced: { route: 'GET /orders', bff: 'web-bff', tenantId: 'globex' },
          perTick: PER_TICK,
        },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'orders',
        'orders-2',
        OLD,
        at,
        'INFO',
        'new api client seen on orders-2: globex-erp-connector/1.0 for tenant globex (token scope orders:read)',
        { 'event.name': 'api.client.first_seen' },
      );
    const page = Math.floor(t.getTime() / PAGE_MS) * PAGE_MS;
    if (page > at && crossed(t, stepMs, page)) {
      const n = page / PAGE_MS,
        pod = `orders-${1 + (n % 6)}`;
      emitLog(
        'orders',
        pod,
        OLD,
        page,
        'WARN',
        `orders.list on ${pod} returned 5000 rows for tenant globex (limit=5000, offset ${(n % 400) * 5000}, client globex-erp-connector/1.0), ${(3.8 + (n % 7) / 10).toFixed(1)} MB response`,
        { 'event.name': 'http.large_response' },
      );
    }
    const slow = Math.floor(t.getTime() / SLOW_MS) * SLOW_MS;
    if (ramp(new Date(slow), onset) >= 0.3 && crossed(t, stepMs, slow)) {
      const n = slow / SLOW_MS,
        pod = `orders-${1 + ((n + 3) % 6)}`;
      emitLog(
        'orders',
        pod,
        OLD,
        slow,
        'WARN',
        `slow query on ${pod}: SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5000 OFFSET $2 took ${1700 + (n % 900)}ms (orders-db cpu ${88 + (n % 11)}%)`,
        { 'event.name': 'db.slow_query', 'server.address': 'orders-db' },
      );
    }
    // Unrelated: the SMTP relay throttles email-worker, which retries later.
    const smtp = Math.floor(t.getTime() / SMTP_MS) * SMTP_MS;
    if (smtp >= at - 25 * 60_000 && crossed(t, stepMs, smtp)) {
      const n = smtp / SMTP_MS,
        pod = `email-worker-${1 + (n % 6)}`;
      emitLog(
        'email-worker',
        pod,
        OLD,
        smtp,
        'WARN',
        `smtp.example.com deferred ${3 + (n % 20)} messages from ${pod}: 421 4.7.0 too many concurrent connections, retrying in 60s`,
        { 'event.name': 'smtp.deferred' },
      );
    }
  },
};
