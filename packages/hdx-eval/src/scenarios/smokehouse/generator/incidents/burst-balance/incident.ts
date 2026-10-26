import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  SHIP_NEW = '1.5.0';
const DRAIN_MS = 70 * 60_000,
  VACUUM_MS = 110 * 60_000,
  RAMP_MS = 2 * 60_000;
const HEALTH_MS = 30_000,
  WARN_MS = 2 * 60_000,
  ROLL_LEAD_MS = 8 * 60_000,
  ROLL_STEP_MS = 30_000;
const STORE = { mean: 140, sd: 70 };
const VOLUME = 'vol-0c3e7a';
const vacuumStart = (onset: Date) => onset.getTime() - DRAIN_MS;
const balance = (t: number, onset: Date) =>
  t < vacuumStart(onset)
    ? 100
    : Math.max(0, 100 * (1 - (t - vacuumStart(onset)) / DRAIN_MS));
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;

// An anti-wraparound autovacuum reads the whole orders table and drains the gp2 volume's burst
// credits over an hour. At zero the volume drops to its baseline IOPS and every orders-db query
// waits on disk. orders' code, connections and traffic do not change.
export const burstBalance: Incident = {
  name: 'burst-balance',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.shipping.versions[`shipping-${i}`] = SHIP_NEW;
    const f = ramp(t, onset);
    if (f === 0) return world;
    world.orders.storeLatencyMs = {
      mean: 6 + (STORE.mean - 6) * f,
      sd: 3 + (STORE.sd - 3) * f,
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
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
    if (crossed(t, stepMs, at))
      emitLog(
        'orders',
        'orders-1',
        OLD,
        at,
        'WARN',
        `orders-db storage burst balance exhausted on ${VOLUME}: volume throttled to 600 baseline IOPS while autovacuum on public.orders (to prevent wraparound) is still running`,
        {
          'event.name': 'db.storage.burst_exhausted',
          'server.address': 'orders-db',
        },
      );
    const health = Math.floor(t.getTime() / HEALTH_MS) * HEALTH_MS;
    if (crossed(t, stepMs, health)) {
      const n = health / HEALTH_MS,
        b = balance(health, onset),
        since = health - vacuumStart(onset);
      const vacuum =
        since < 0
          ? 'idle'
          : `public.orders (to prevent wraparound) ${Math.min(99, Math.floor((100 * since) / VACUUM_MS))}% scanned`;
      emitLog(
        'orders',
        `orders-${1 + (n % 6)}`,
        OLD,
        health,
        'INFO',
        `db health orders-db: storage burst balance ${Math.round(b)}% on ${VOLUME} (gp2, 3000 burst / 600 baseline IOPS), autovacuum ${vacuum}`,
        { 'event.name': 'db.health', 'server.address': 'orders-db' },
      );
    }
    const warn = Math.floor(t.getTime() / WARN_MS) * WARN_MS,
      b = balance(warn, onset);
    if (b > 30 || b === 0 || !crossed(t, stepMs, warn)) return;
    emitLog(
      'orders',
      `orders-${1 + ((warn / WARN_MS) % 6)}`,
      OLD,
      warn,
      'WARN',
      `orders-db storage burst balance ${Math.round(b)}% on ${VOLUME} and falling about 1.4% a minute; the volume drops to 600 baseline IOPS at 0%`,
      { 'event.name': 'db.storage.burst_low', 'server.address': 'orders-db' },
    );
  },
};
