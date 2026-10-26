import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import { TENANTS } from '../../world';
import type { Incident } from '../index';

const OLD = '1.4.2',
  NEW = '1.6.0';
const STEP_MS = 30_000,
  EXPIRY_MS = 6 * 60_000,
  EXTRA_PER_TICK = 0.4,
  SLOW_MS = 20_000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * STEP_MS;
// The CDN keeps serving pages it already cached, so origin traffic grows as those copies expire.
const load = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / EXPIRY_MS);

// web-bff 1.6.0 marks product pages private, no-store for a personalised badge. The CDN stops caching
// them, product page requests reach the origin several times over, and pricing-db slows under the reads.
export const cdnCacheBypass: Incident = {
  name: 'cdn-cache-bypass',
  defaultOnsetMs: -11 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world['web-bff'].versions[`web-bff-${i}`] = NEW;
    const f = load(t, onset);
    if (f === 0) return world;
    world.pricing.storeLatencyByName = {
      'pricing-db': { mean: 6 + 190 * f, sd: 3 + 80 * f },
      'price-cache': { mean: 6 + 14 * f, sd: 3 + 6 * f },
    };
    world.catalog.storeLatencyMs = { mean: 6 + 30 * f, sd: 3 + 12 * f };
    return world;
  },
  surge(t, onset) {
    const f = load(t, onset);
    if (f === 0) return null;
    const [tenantId] = TENANTS[Math.floor(t.getTime() / 1000) % TENANTS.length];
    return {
      forced: { route: 'GET /product/{id}', bff: 'web-bff', tenantId },
      perTick: EXTRA_PER_TICK * f,
    };
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = rolledAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'web-bff',
          `web-bff-${i}`,
          NEW,
          roll,
          'INFO',
          `deployment.rollout: web-bff-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
    const notes = onset.getTime() + 2000;
    if (crossed(t, stepMs, notes))
      emitLog(
        'web-bff',
        'web-bff-1',
        NEW,
        notes,
        'INFO',
        `release notes web-bff ${NEW} (WEB-902): product pages now send Cache-Control: private, no-store so the personalised price badge is never shared`,
        { 'event.name': 'release.notes' },
      );
    // pricing's own slow query warnings: a symptom of the extra reads, not a change on pricing.
    const slow = Math.floor(t.getTime() / SLOW_MS) * SLOW_MS;
    if (load(new Date(slow), onset) < 0.4 || !crossed(t, stepMs, slow)) return;
    const n = slow / SLOW_MS,
      pod = `pricing-${1 + (n % 6)}`;
    emitLog(
      'pricing',
      pod,
      OLD,
      slow,
      'WARN',
      `slow query on ${pod}: SELECT * FROM price_rules WHERE sku = $1 AND tenant_id = $2 took ${310 + (n % 400)}ms (pricing-db, ${40 + (n % 50)} active connections)`,
      { 'event.name': 'db.slow_query', 'server.address': 'pricing-db' },
    );
  },
};
